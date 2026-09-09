import crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_DIRECT_MESSAGE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_TASK_LENGTH = 100_000;
const TERMINAL_TASK_STATES = new Set(["completed", "failed", "timed_out", "cancelled"]);

function normalizeWorkerUrl(value) {
  const url = new URL(String(value || "").trim());
  if (!["ws:", "wss:", "http:", "https:"].includes(url.protocol)) throw new Error("Worker URLs must use WS or WSS.");
  if (url.username || url.password) throw new Error("Worker URLs cannot contain credentials.");
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
  if (url.hostname === "[::]") url.hostname = "[::1]";
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

function normalizeSubAgentWorkers(value = []) {
  const names = new Set();
  return (Array.isArray(value) ? value : []).map((worker) => {
    const name = String(worker?.name || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,99}$/.test(name)) throw new Error(`Invalid sub-agent name: ${name || "(empty)"}`);
    if (names.has(name)) throw new Error(`Duplicate sub-agent name: ${name}`);
    names.add(name);
    const capabilities = worker?.capabilities && typeof worker.capabilities === "object" ? {
      skills: (Array.isArray(worker.capabilities.skills) ? worker.capabilities.skills : []).map((skill) => ({
        id: String(skill?.id || ""), name: String(skill?.name || ""), description: String(skill?.description || ""),
      })),
      tools: (Array.isArray(worker.capabilities.tools) ? worker.capabilities.tools : []).map(String),
      mcp: worker.capabilities.mcp === true,
      workspaceArtifacts: worker.capabilities.workspaceArtifacts === true,
    } : { skills: [], tools: [], mcp: false, workspaceArtifacts: false };
    const model = worker?.model && typeof worker.model === "object" ? {
      provider: String(worker.model.provider || ""), name: String(worker.model.name || ""), url: String(worker.model.url || ""),
    } : null;
    return { name, description: String(worker?.description || ""), url: normalizeWorkerUrl(worker?.url), capabilities, ...(model ? { model } : {}) };
  });
}

function messageText(payload) {
  return (Array.isArray(payload?.message?.parts) ? payload.message.parts : [])
    .filter((part) => part?.kind === "text" && typeof part.text === "string")
    .map((part) => part.text).join("\n");
}

function normalizeArtifacts(payload, workerUrl) {
  if (payload?.artifacts === undefined) return [];
  if (!Array.isArray(payload.artifacts)) throw new Error("Worker artifacts must be an array.");
  const base = new URL(workerUrl);
  if (base.protocol === "ws:") base.protocol = "http:";
  if (base.protocol === "wss:") base.protocol = "https:";
  return payload.artifacts.map((artifact, artifactIndex) => {
    if (!artifact || typeof artifact !== "object") throw new Error(`Artifact ${artifactIndex + 1} must be an object.`);
    const parts = (Array.isArray(artifact.parts) ? artifact.parts : []).map((part, partIndex) => {
      if (part?.kind !== "file" || !part.file || typeof part.file !== "object") throw new Error(`Artifact ${artifactIndex + 1} part ${partIndex + 1} must be a file.`);
      const uri = new URL(String(part.file.uri || ""), base).href;
      if (!uri.startsWith("http://") && !uri.startsWith("https://")) throw new Error("Deliverable file URIs must use HTTP or HTTPS.");
      return { kind: "file", file: { name: String(part.file.name || artifact.name || `artifact-${artifactIndex + 1}`), mimeType: String(part.file.mimeType || "application/octet-stream"), uri } };
    });
    return { artifactId: String(artifact.artifactId || `artifact-${artifactIndex + 1}`), name: String(artifact.name || parts[0]?.file.name || `Artifact ${artifactIndex + 1}`), parts, metadata: artifact.metadata && typeof artifact.metadata === "object" ? { ...artifact.metadata } : {} };
  });
}

function deliveredWork(artifacts) {
  return artifacts.flatMap((artifact) => artifact.parts.map((part) => ({
    artifactId: artifact.artifactId, artifactName: artifact.name, name: part.file.name,
    mimeType: part.file.mimeType, uri: part.file.uri, metadata: artifact.metadata,
  })));
}

class SubAgentManager {
  constructor({ onTaskAssigned = () => {}, onTaskEvent = () => {}, onDirectMessage = () => {}, materializeArtifacts = async (_task, work) => work } = {}) {
    this.onTaskAssigned = onTaskAssigned;
    this.onTaskEvent = onTaskEvent;
    this.onDirectMessage = onDirectMessage;
    this.materializeArtifacts = materializeArtifacts;
    this.workers = new Map();
    this.tasks = new Map();
    this.taskIds = new Map();
    this.directMessages = new Map();
  }

  registerWorker(worker, transport) {
    const normalized = normalizeSubAgentWorkers([worker])[0];
    if (!["ws:", "wss:"].includes(new URL(normalized.url).protocol)) throw new Error("Live workers must register a WS or WSS URL.");
    if (!transport || typeof transport.send !== "function" || !transport.connectionId) throw new Error("A live worker transport is required.");
    const previous = this.workers.get(normalized.name);
    if (previous && previous.connectionId !== transport.connectionId) {
      this.unregisterConnection(previous.connectionId, "Worker reconnected on a new socket.");
      previous.close?.(4001, "Worker reconnected");
    }
    this.workers.set(normalized.name, { ...normalized, connectedAt: Date.now(), connectionId: transport.connectionId, send: transport.send, close: transport.close });
    return this.publicWorker(this.workers.get(normalized.name));
  }

  unregisterConnection(connectionId, reason = "Worker disconnected.") {
    for (const [name, worker] of this.workers) {
      if (worker.connectionId === connectionId) this.workers.delete(name);
    }
    for (const record of this.tasks.values()) {
      if (record.connectionId === connectionId && !TERMINAL_TASK_STATES.has(record.state)) {
        this.finish(record, { ok: false, status: "failed", error: reason });
      }
    }
    for (const record of this.directMessages.values()) {
      if (record.connectionId === connectionId) this.finishDirectMessage(record, "failed", { error: reason });
    }
  }

  publicWorker({ send, close, connectionId, ...worker }) {
    return { ...worker, status: "connected" };
  }

  listWorkers() {
    return [...this.workers.values()].map((worker) => this.publicWorker(worker));
  }

  listTasks() {
    return [...this.tasks.values()].map(({ resolve, timer, ...task }) => ({ ...task }));
  }

  listDirectMessages() {
    return [...this.directMessages.values()].map(({ timer, ...message }) => ({ ...message }));
  }

  sendDirectMessage({ agent, text, timeoutMs = DEFAULT_DIRECT_MESSAGE_TIMEOUT_MS } = {}) {
    const worker = this.workers.get(String(agent || ""));
    if (!worker) throw new Error(`Unknown or disconnected sub-agent: ${agent || "(empty)"}`);
    const normalizedText = String(text || "").trim();
    if (!normalizedText) throw new Error("Direct message text is required.");
    if (normalizedText.length > MAX_TASK_LENGTH) throw new Error(`Direct message exceeds ${MAX_TASK_LENGTH} characters.`);
    const messageId = `direct-${crypto.randomUUID()}`;
    const record = {
      messageId, agent: worker.name, text: normalizedText, state: "waiting",
      connectionId: worker.connectionId, createdAt: new Date().toISOString(),
    };
    const duration = Number.isFinite(timeoutMs) ? Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.floor(timeoutMs))) : DEFAULT_DIRECT_MESSAGE_TIMEOUT_MS;
    record.timer = setTimeout(() => this.finishDirectMessage(record, "failed", { error: "Direct message response timed out." }), duration);
    record.timer.unref?.();
    this.directMessages.set(messageId, record);
    try {
      worker.send({
        type: "direct_message",
        message: { messageId, role: "user", parts: [{ kind: "text", mimeType: "text/plain", text: normalizedText }] },
      });
    } catch (error) {
      clearTimeout(record.timer);
      this.directMessages.delete(messageId);
      throw error;
    }
    const { timer, ...receipt } = record;
    return receipt;
  }

  receiveDirectMessage(agent, payload, connectionId) {
    const messageId = String(payload?.inReplyTo || "");
    const record = this.directMessages.get(messageId);
    if (!record || record.agent !== agent || record.connectionId !== connectionId) throw new Error("Unknown direct message response.");
    const text = messageText(payload).trim();
    if (!text) throw new Error("Direct message response text is required.");
    this.finishDirectMessage(record, "completed", { text });
    return { messageId, state: "completed" };
  }

  finishDirectMessage(record, state, output = {}) {
    if (!this.directMessages.has(record.messageId)) return;
    clearTimeout(record.timer);
    this.directMessages.delete(record.messageId);
    const { timer, ...message } = record;
    try { this.onDirectMessage(state, { ...message, ...output, state }); } catch { /* Observers cannot break delivery. */ }
  }

  emitTaskEvent(event, record) {
    const { resolve, timer, ...task } = record;
    try { this.onTaskEvent(event, { ...task }); } catch { /* Observers cannot break delivery. */ }
  }

  queue({ agent, task, title, priority = "medium", timeoutMs = DEFAULT_TIMEOUT_MS }) {
    const messageId = `msg-${crypto.randomUUID()}`;
    const completion = this.delegate({ agent, task, title, priority, timeoutMs, messageId });
    const record = this.tasks.get(messageId);
    if (!record) throw new Error("Unable to queue the worker task.");
    const { resolve, timer, ...publicTask } = record;
    return { task: { ...publicTask }, completion };
  }

  async delegate({ agent, task, title, priority = "medium", timeoutMs = DEFAULT_TIMEOUT_MS, messageId: requestedMessageId } = {}) {
    const worker = this.workers.get(String(agent || ""));
    if (!worker) throw new Error(`Unknown or disconnected sub-agent: ${agent || "(empty)"}`);
    if (typeof task !== "string" || !task.trim()) throw new Error("Sub-agent task is required.");
    if (task.length > MAX_TASK_LENGTH) throw new Error(`Sub-agent task exceeds ${MAX_TASK_LENGTH} characters.`);
    const duration = Number.isFinite(timeoutMs) ? Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.floor(timeoutMs))) : DEFAULT_TIMEOUT_MS;
    const messageId = requestedMessageId || `msg-${crypto.randomUUID()}`;
    const taskId = `task-${crypto.randomUUID()}`;
    const record = {
      agent: worker.name, createdAt: new Date().toISOString(), inReplyTo: messageId, messageId,
      priority: ["low", "medium", "high"].includes(priority) ? priority : "medium",
      state: "assigned", taskId, title: String(title || "").trim() || task.trim(), workerUrl: worker.url,
      connectionId: worker.connectionId, updates: [],
    };
    let settle;
    const result = new Promise((resolve) => { settle = resolve; });
    record.resolve = settle;
    record.timer = setTimeout(() => this.finish(record, { ok: false, status: "timed_out", error: `Sub-agent did not finish within ${duration}ms.` }), duration);
    record.timer.unref?.();
    this.tasks.set(messageId, record);
    this.taskIds.set(taskId, record);
    try {
      worker.send({
        type: "task", taskId, priority: record.priority,
        message: { messageId, role: "manager", parts: [{ kind: "text", mimeType: "text/plain", text: task.trim() }] },
      });
      record.state = "working";
      record.startedAt = new Date().toISOString();
      const { resolve, timer, ...publicTask } = record;
      try { this.onTaskAssigned({ ...publicTask }); } catch { /* Observers cannot break delivery. */ }
    } catch (error) {
      this.finish(record, { ok: false, status: "failed", error: `Unable to send task to ${worker.name}: ${error.message}` });
    }
    return result;
  }

  cancelTask({ messageId, taskId, reason = "Task stopped by the office manager." } = {}) {
    const record = messageId
      ? this.tasks.get(String(messageId))
      : this.taskIds.get(String(taskId || ""));
    if (!record) throw new Error("Unknown worker task.");
    if (TERMINAL_TASK_STATES.has(record.state)) throw new Error(`Task is already ${record.state}.`);
    const worker = this.workers.get(record.agent);
    if (!worker || worker.connectionId !== record.connectionId) throw new Error("The assigned worker is disconnected.");
    const normalizedReason = String(reason || "Task stopped by the office manager.").trim().slice(0, 1_000);
    worker.send({
      type: "task_cancel",
      taskId: record.taskId,
      inReplyTo: record.messageId,
      reason: normalizedReason,
    });
    this.finish(record, { ok: false, status: "cancelled", error: normalizedReason });
    const { resolve, timer, ...task } = record;
    return { ...task };
  }

  receiveUpdate(agent, payload, connectionId) {
    const record = this.taskIds.get(String(payload?.taskId || ""));
    if (!record || record.agent !== agent || record.connectionId !== connectionId) throw new Error("Unknown task update.");
    if (payload.inReplyTo && payload.inReplyTo !== record.messageId) throw new Error("Task update inReplyTo does not match.");
    if (TERMINAL_TASK_STATES.has(record.state)) return { taskId: record.taskId, state: record.state };
    const state = String(payload.status?.state || payload.state || "");
    if (["accepted", "working", "progress"].includes(state)) {
      const text = messageText(payload);
      record.state = "working";
      record.updatedAt = new Date().toISOString();
      if (text) {
        record.updates.push({ text, at: record.updatedAt });
        this.emitTaskEvent("working", { ...record, text });
      }
      return { taskId: record.taskId, state: record.state };
    }
    if (!["completed", "failed"].includes(state)) throw new Error("Task update state must be working, completed, or failed.");
    const artifacts = state === "completed" ? normalizeArtifacts(payload, record.workerUrl) : [];
    const work = deliveredWork(artifacts);
    if (state === "failed") {
      this.finish(record, { ok: false, status: state, error: payload.error?.message || payload.error || messageText(payload) || "Sub-agent task failed." });
      return { taskId: record.taskId, state: record.state };
    }
    return Promise.resolve(this.materializeArtifacts({ ...record }, work)).then((storedWork) => {
      this.finish(record, { ok: true, status: state, text: messageText(payload), artifacts, deliveredWork: storedWork });
      return { taskId: record.taskId, state: record.state };
    }).catch((error) => {
      this.finish(record, { ok: false, status: "failed", error: `Unable to store delivered work: ${error.message}` });
      return { taskId: record.taskId, state: record.state };
    });
  }

  finish(record, output) {
    if (TERMINAL_TASK_STATES.has(record.state)) return;
    clearTimeout(record.timer);
    record.state = output.status;
    record.finishedAt = new Date().toISOString();
    if (output.text) record.text = output.text;
    if (output.artifacts?.length) record.artifacts = output.artifacts;
    if (output.deliveredWork?.length) record.deliveredWork = output.deliveredWork;
    if (output.error) record.error = String(output.error);
    this.emitTaskEvent(record.state, record);
    record.resolve({ agent: record.agent, taskId: record.taskId, ...output });
    delete record.resolve;
    delete record.timer;
  }
}

export { DEFAULT_DIRECT_MESSAGE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, SubAgentManager, TERMINAL_TASK_STATES, normalizeSubAgentWorkers };
