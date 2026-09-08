import crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_TASK_LENGTH = 100_000;
const DEFAULT_SUBMISSION_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

function normalizeWorkerUrl(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Sub-agent worker URLs must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Sub-agent worker URLs cannot contain credentials.");
  }
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
  if (url.hostname === "[::]") url.hostname = "[::1]";
  url.hash = "";
  url.search = "";
  return url.href.replace(/\/$/, "");
}

function normalizeSubAgentWorkers(value = []) {
  const names = new Set();
  return (Array.isArray(value) ? value : []).map((worker) => {
    const name = String(worker?.name || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,99}$/.test(name)) {
      throw new Error(`Invalid sub-agent name: ${name || "(empty)"}`);
    }
    if (names.has(name)) throw new Error(`Duplicate sub-agent name: ${name}`);
    names.add(name);
    const capabilities = worker?.capabilities && typeof worker.capabilities === "object" ? {
      skills: (Array.isArray(worker.capabilities.skills) ? worker.capabilities.skills : []).map((skill) => ({
        id: String(skill?.id || ""),
        name: String(skill?.name || ""),
        description: String(skill?.description || ""),
      })),
      tools: (Array.isArray(worker.capabilities.tools) ? worker.capabilities.tools : []).map(String),
      mcp: worker.capabilities.mcp === true,
      workspaceArtifacts: worker.capabilities.workspaceArtifacts === true,
    } : { skills: [], tools: [], mcp: false, workspaceArtifacts: false };
    const model = worker?.model && typeof worker.model === "object" ? {
      provider: String(worker.model.provider || ""),
      name: String(worker.model.name || ""),
      url: String(worker.model.url || ""),
    } : null;
    return {
      name,
      description: String(worker?.description || ""),
      url: normalizeWorkerUrl(worker?.url),
      capabilities,
      ...(model ? { model } : {}),
    };
  });
}

function workerInfoUrl(value) {
  const url = new URL(normalizeWorkerUrl(value));
  url.pathname = "/api/info";
  url.search = "";
  url.hash = "";
  return url.href;
}

async function discoverSubAgentWorker(value, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(workerInfoUrl(value), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let info;
  try {
    info = JSON.parse(text);
  } catch {
    throw new Error(`Worker /api/info returned invalid JSON (HTTP ${response.status}).`);
  }
  if (!response.ok) throw new Error(info?.error || `Worker /api/info returned HTTP ${response.status}.`);
  if (!info || typeof info !== "object") throw new Error("Worker /api/info returned an invalid response.");
  const requested = new URL(normalizeWorkerUrl(value));
  let advertisedUrl = String(info.url || "").trim();
  if (advertisedUrl) {
    const advertised = new URL(advertisedUrl, requested);
    if (["0.0.0.0", "[::]"].includes(advertised.hostname)) advertised.hostname = requested.hostname;
    advertisedUrl = advertised.href;
  } else {
    advertisedUrl = requested.href;
  }
  return normalizeSubAgentWorkers([{ ...info, url: advertisedUrl }])[0];
}

function a2aUrl(workerUrl) {
  const url = new URL(workerUrl);
  if (!url.pathname.endsWith("/a2a")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/a2a`;
  }
  return url.href;
}

function callbackText(payload) {
  return (Array.isArray(payload?.message?.parts) ? payload.message.parts : [])
    .filter((part) => part?.kind === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function callbackArtifacts(payload, workerUrl) {
  if (payload?.artifacts === undefined) return [];
  if (!Array.isArray(payload.artifacts)) throw new Error("Callback artifacts must be an array.");
  return payload.artifacts.map((artifact, artifactIndex) => {
    if (!artifact || typeof artifact !== "object") {
      throw new Error(`Callback artifact ${artifactIndex + 1} must be an object.`);
    }
    const parts = Array.isArray(artifact.parts) ? artifact.parts : [];
    const normalizedParts = parts.map((part, partIndex) => {
      if (part?.kind !== "file" || !part.file || typeof part.file !== "object") {
        throw new Error(`Callback artifact ${artifactIndex + 1} part ${partIndex + 1} must be a file.`);
      }
      let uri;
      try {
        uri = new URL(String(part.file.uri || ""), `${workerUrl}/`).href;
      } catch {
        throw new Error(`Callback artifact ${artifactIndex + 1} contains an invalid file URI.`);
      }
      if (!uri.startsWith("http://") && !uri.startsWith("https://")) {
        throw new Error("Callback artifact file URIs must use HTTP or HTTPS.");
      }
      return {
        kind: "file",
        file: {
          name: String(part.file.name || artifact.name || `artifact-${artifactIndex + 1}`),
          mimeType: String(part.file.mimeType || "application/octet-stream"),
          uri,
        },
      };
    });
    return {
      artifactId: String(artifact.artifactId || `artifact-${artifactIndex + 1}`),
      name: String(artifact.name || normalizedParts[0]?.file.name || `Artifact ${artifactIndex + 1}`),
      parts: normalizedParts,
      metadata: artifact.metadata && typeof artifact.metadata === "object" ? { ...artifact.metadata } : {},
    };
  });
}

function deliveredWork(artifacts) {
  return artifacts.flatMap((artifact) => artifact.parts.map((part) => ({
    artifactId: artifact.artifactId,
    artifactName: artifact.name,
    name: part.file.name,
    mimeType: part.file.mimeType,
    uri: part.file.uri,
    metadata: artifact.metadata,
  })));
}

function workerConnectionError(worker, error, attempts) {
  const cause = error?.cause;
  const causeMessage = typeof cause?.message === "string" ? cause.message : "";
  const detail = causeMessage && causeMessage !== error?.message
    ? `${error.message}: ${causeMessage}`
    : error?.message || "Unknown network error.";
  const attempted = attempts > 1 ? ` after ${attempts} attempts` : "";
  return new Error(`Unable to reach sub-agent “${worker.name}” at ${a2aUrl(worker.url)}${attempted}. ${detail}`);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class SubAgentManager {
  constructor({
    workers = [],
    callbackUrl,
    fetchImpl = globalThis.fetch,
    onTaskEvent = () => {},
    submissionAttempts = DEFAULT_SUBMISSION_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  } = {}) {
    this.setWorkers(workers);
    this.callbackUrl = callbackUrl;
    this.fetchImpl = fetchImpl;
    this.onTaskEvent = onTaskEvent;
    this.submissionAttempts = Math.max(1, Math.floor(submissionAttempts));
    this.retryDelayMs = Math.max(0, Math.floor(retryDelayMs));
    this.pending = new Map();
    this.tasks = new Map();
  }

  emitTaskEvent(event, record) {
    const { token, resolve, timer, ...task } = record;
    try { this.onTaskEvent(event, { ...task }); } catch { /* Memory recording must not break task delivery. */ }
  }

  listWorkers() {
    return [...this.workers.values()].map((worker) => ({
      ...worker,
      capabilities: {
        ...worker.capabilities,
        skills: worker.capabilities.skills.map((skill) => ({ ...skill })),
        tools: [...worker.capabilities.tools],
      },
      ...(worker.model ? { model: { ...worker.model } } : {}),
    }));
  }

  setWorkers(workers = []) {
    this.workers = new Map(normalizeSubAgentWorkers(workers).map((worker) => [worker.name, worker]));
    return this.listWorkers();
  }

  listTasks() {
    return [...this.tasks.values()].map(({ token, resolve, timer, ...task }) => ({ ...task }));
  }

  queue({ agent, task, priority = "medium", timeoutMs = DEFAULT_TIMEOUT_MS }) {
    const worker = this.workers.get(String(agent || ""));
    if (!worker) throw new Error(`Unknown sub-agent: ${agent || "(empty)"}`);
    if (typeof task !== "string" || !task.trim()) throw new Error("Sub-agent task is required.");
    if (task.length > MAX_TASK_LENGTH) {
      throw new Error(`Sub-agent task exceeds ${MAX_TASK_LENGTH} characters.`);
    }

    const messageId = `msg-${crypto.randomUUID()}`;
    const completion = this.delegate({ agent, task, priority, timeoutMs, messageId });
    const record = this.tasks.get(messageId);
    if (!record) throw new Error("Unable to queue the sub-agent task.");
    const { token, resolve, timer, ...publicTask } = record;
    return { task: { ...publicTask }, completion };
  }

  async delegate({ agent, task, priority = "medium", timeoutMs = DEFAULT_TIMEOUT_MS, messageId: requestedMessageId } = {}) {
    const worker = this.workers.get(String(agent || ""));
    if (!worker) throw new Error(`Unknown sub-agent: ${agent || "(empty)"}`);
    if (typeof task !== "string" || !task.trim()) throw new Error("Sub-agent task is required.");
    if (task.length > MAX_TASK_LENGTH) {
      throw new Error(`Sub-agent task exceeds ${MAX_TASK_LENGTH} characters.`);
    }
    const duration = Number.isFinite(timeoutMs)
      ? Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.floor(timeoutMs)))
      : DEFAULT_TIMEOUT_MS;
    const callbackUrl = typeof this.callbackUrl === "function"
      ? this.callbackUrl()
      : this.callbackUrl;
    if (!callbackUrl) throw new Error("A public sub-agent callback URL is not configured.");

    const messageId = requestedMessageId || `msg-${crypto.randomUUID()}`;
    const token = crypto.randomBytes(32).toString("base64url");
    const record = {
      agent: worker.name,
      callbackReceived: false,
      createdAt: new Date().toISOString(),
      inReplyTo: messageId,
      messageId,
      priority: ["low", "medium", "high"].includes(priority) ? priority : "medium",
      state: "submitting",
      taskId: null,
      title: task.trim(),
      workerUrl: worker.url,
    };
    this.tasks.set(messageId, record);

    let settle;
    const result = new Promise((resolve) => { settle = resolve; });
    const timer = setTimeout(() => {
      this.pending.delete(token);
      record.state = "timed_out";
      record.finishedAt = new Date().toISOString();
      record.error = `Sub-agent did not call back within ${duration}ms.`;
      this.emitTaskEvent("timed_out", record);
      settle({
        ok: false,
        agent: worker.name,
        taskId: record.taskId,
        status: "timed_out",
        error: `Sub-agent did not call back within ${duration}ms.`,
      });
    }, duration);
    timer.unref?.();
    this.pending.set(token, { messageId, record, resolve: settle, timer });

    try {
      let response;
      let connectionError;
      let attempts = 0;
      const submissionDeadline = Date.now() + Math.min(duration, 30_000);
      while (!response && attempts < this.submissionAttempts) {
        attempts += 1;
        try {
          response = await this.fetchImpl(a2aUrl(worker.url), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              message: {
                messageId,
                role: "user",
                parts: [{ kind: "text", text: task.trim() }],
              },
              callback: { url: callbackUrl, token },
            }),
            signal: AbortSignal.timeout(Math.max(1, submissionDeadline - Date.now())),
          });
        } catch (error) {
          connectionError = error;
          const remaining = submissionDeadline - Date.now();
          if (attempts < this.submissionAttempts && remaining > 0) {
            await wait(Math.min(this.retryDelayMs, remaining));
          }
        }
      }
      if (!response) throw workerConnectionError(worker, connectionError, attempts);
      if (!this.pending.has(token)) return result;
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`Sub-agent returned invalid JSON (HTTP ${response.status}).`);
      }
      if (response.status !== 202 || typeof body.taskId !== "string" || !body.taskId) {
        const detail = body?.error?.message || (typeof body?.error === "string" ? body.error : "");
        throw new Error(detail || `Sub-agent rejected the task (HTTP ${response.status}).`);
      }
      if (record.taskId && record.taskId !== body.taskId) {
        throw new Error("Sub-agent acknowledgement and callback used different task IDs.");
      }
      record.taskId = body.taskId;
      if (!record.callbackReceived) {
        record.state = "working";
        record.startedAt = new Date().toISOString();
      }
    } catch (error) {
      const pending = this.pending.get(token);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(token);
        record.state = "failed";
        record.finishedAt = new Date().toISOString();
        record.error = error.message;
        this.emitTaskEvent("failed", record);
        settle({ ok: false, agent: worker.name, taskId: record.taskId, status: "failed", error: error.message });
      }
    }

    return result;
  }

  receiveCallback(authorization, payload) {
    const match = /^Bearer\s+(.+)$/i.exec(String(authorization || ""));
    const pending = match ? this.pending.get(match[1]) : null;
    if (!pending) return { status: 401, body: { ok: false, error: "Invalid or expired callback token." } };

    const { record } = pending;
    if (!payload || typeof payload !== "object" || payload.inReplyTo !== record.inReplyTo) {
      return { status: 400, body: { ok: false, error: "Callback inReplyTo does not match the delegated message." } };
    }
    if (typeof payload.taskId !== "string" || !payload.taskId) {
      return { status: 400, body: { ok: false, error: "Callback taskId is required." } };
    }
    if (record.taskId && payload.taskId !== record.taskId) {
      return { status: 409, body: { ok: false, error: "Callback taskId does not match the acknowledged task." } };
    }
    const state = payload.status?.state;
    if (state !== "completed" && state !== "failed") {
      return { status: 400, body: { ok: false, error: "Callback status.state must be completed or failed." } };
    }
    const artifacts = state === "completed" ? callbackArtifacts(payload, record.workerUrl) : [];
    const work = deliveredWork(artifacts);

    clearTimeout(pending.timer);
    this.pending.delete(match[1]);
    record.callbackReceived = true;
    record.taskId = payload.taskId;
    record.state = state;
    record.finishedAt = new Date().toISOString();
    const output = state === "completed"
      ? { ok: true, agent: record.agent, taskId: payload.taskId, status: state, text: callbackText(payload), artifacts, deliveredWork: work }
      : {
          ok: false,
          agent: record.agent,
          taskId: payload.taskId,
          status: state,
          error: payload.error?.message || (typeof payload.error === "string" ? payload.error : "Sub-agent task failed."),
        };
    if (output.text) record.text = output.text;
    if (artifacts.length) record.artifacts = artifacts;
    if (work.length) record.deliveredWork = work;
    if (output.error) record.error = output.error;
    this.emitTaskEvent(state, record);
    pending.resolve(output);
    return { status: 200, body: { ok: true } };
  }
}

export {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  SubAgentManager,
  discoverSubAgentWorker,
  normalizeSubAgentWorkers,
  workerInfoUrl,
};
