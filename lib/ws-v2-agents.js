import crypto from 'node:crypto';
import { safeTokenEqual } from './worker-auth.js';
import { normalizeSubAgentWorkers } from './legacy-sub-agents.js';

export const WS_VERSION = '2.0';
export const WS_FEATURES = ['recovery', 'continuation', 'confirmedCancellation', 'contexts', 'deduplication'];
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'rejected', 'timed_out']);
const PAUSED = new Set(['input_required', 'auth_required']);
const STATES = new Set(['submitted', 'working', ...PAUSED, 'completed', 'failed', 'cancelled', 'rejected']);
const MAX_BYTES = 1024 * 1024;
const uuid = () => crypto.randomUUID();
const fail = (code, message) => Object.assign(new Error(message), { code });
function publicTask(record) {
  const { resolve, completion, timer, receipts, command, snapshotRequestId, ...task } = record;
  return structuredClone(task);
}
function partsText(parts = []) { return parts.map(part => part.text ?? JSON.stringify(part.data)).join('\n'); }
function validateParts(parts) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 100) throw fail('INVALID_PARTS', 'Supply 1–100 text or data parts.');
  if (Buffer.byteLength(JSON.stringify(parts)) > 256 * 1024) throw fail('LIMIT_EXCEEDED', 'Parts exceed 256 KiB. Use file uploads.');
  for (const part of parts) {
    if (!part || typeof part !== 'object' || ['text', 'data', 'raw', 'url'].filter(key => Object.hasOwn(part, key)).length !== 1
      || (!Object.hasOwn(part, 'text') && !Object.hasOwn(part, 'data')) || (Object.hasOwn(part, 'text') && typeof part.text !== 'string')) throw fail('INVALID_PARTS', 'Only text and JSON data parts are supported. Upload binary files through artifactUpload.');
    if (part.filename !== undefined && (typeof part.filename !== 'string' || !part.filename || part.filename.length > 255 || /[\\/\0]/.test(part.filename) || ['.', '..'].includes(part.filename))) throw fail('INVALID_PARTS', 'filename must be a plain filename.');
  }
}
function validateArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length > 100) throw fail('INVALID_ARTIFACT', 'Supply at most 100 artifacts.');
  const ids = new Set();
  for (const artifact of artifacts) {
    if (typeof artifact?.artifactId !== 'string' || !artifact.artifactId || artifact.artifactId.length > 200 || ids.has(artifact.artifactId)) throw fail('INVALID_ARTIFACT', 'Artifact IDs must be unique nonempty strings.');
    ids.add(artifact.artifactId); validateParts(artifact.parts);
  }
  if (Buffer.byteLength(JSON.stringify(artifacts)) > MAX_BYTES) throw fail('LIMIT_EXCEEDED', 'Inline artifacts exceed 1 MiB. Use file uploads.');
}

export class WsV2Manager {
  constructor(options = {}) {
    this.options = options; this.workers = new Map(); this.tasks = new Map(); this.identities = new Map(); this.contexts = new Map(); this.receiveQueue = Promise.resolve();
  }
  notify(name, ...args) { try { this.options[name]?.(...args); } catch (error) { console.error(`WebSocket v2 ${name}: ${error.message}`); } }
  persist() {
    this.options.saveWsState?.({ identities: [...this.identities], contexts: [...this.contexts], tasks: [...this.tasks.values()].map(record => ({ ...publicTask(record), receipts: record.receipts, command: record.command })) });
  }
  restore(state = {}) {
    this.identities = new Map(state.identities || []); this.contexts = new Map(state.contexts || []);
    for (const saved of state.tasks || []) {
      const record = this.record(saved); this.tasks.set(record.messageId, record);
      if (TERMINAL.has(record.state)) { record.resolve(this.result(record)); if (!record.direct) this.notify('onTaskSettled', this.result(record), publicTask(record)); }
      else { record.connectionId = null; record.connectionError = 'Waiting for worker reconnection and task reconciliation.'; this.arm(record); }
    }
  }
  hasName(name) { return this.identities.has(name); }
  registerWorker(config, transport) {
    const normalized = normalizeSubAgentWorkers([config])[0];
    if (!/^wss?:/.test(normalized.url)) throw fail('INVALID_REGISTRATION', 'A WebSocket worker URL is required.');
    const prior = this.identities.get(normalized.name);
    if (config.resumeToken !== undefined && (typeof config.resumeToken !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(config.resumeToken))) throw fail('INVALID_REGISTRATION', 'resumeToken must be 32–128 base64url characters.');
    if (prior && !safeTokenEqual(config.resumeToken, prior.resumeToken)) throw fail('RESUME_TOKEN_REQUIRED', 'Use the resumeToken issued for this worker name.');
    const caps = config.capabilities;
    for (const key of ['inputModes', 'outputModes']) if (!Array.isArray(caps[key]) || !caps[key].length || caps[key].some(value => typeof value !== 'string' || value.length > 100)) throw fail('INVALID_REGISTRATION', `${key} must list supported content types.`);
    if (!caps.inputModes.some(mode => ['text/plain', 'text/*', '*/*'].includes(mode))) throw fail('UNSUPPORTED_CONTENT', 'Office requires text input support.');
    const worker = { ...normalized, protocol: 'websocket', protocolVersion: WS_VERSION, binding: 'WebSocket v2', status: 'connected', capabilities: { ...normalized.capabilities, inputModes: caps.inputModes, outputModes: caps.outputModes, structuredResults: caps.structuredResults === true, artifactUpdates: caps.artifactUpdates === true }, ...transport };
    const previous = this.workers.get(worker.name);
    if (previous) { this.unregisterConnection(previous.connectionId); previous.close?.(4001, 'Worker reconnected'); }
    this.identities.set(worker.name, { worker: this.publicWorker(worker), resumeToken: prior?.resumeToken || config.resumeToken || crypto.randomBytes(32).toString('base64url') });
    this.workers.set(worker.name, worker); this.persist(); this.notify('onWorkerRegistered', this.publicWorker(worker));
    return this.publicWorker(worker);
  }
  registration(name) { return { protocolVersion: WS_VERSION, features: WS_FEATURES, resumeToken: this.identities.get(name).resumeToken, limits: { messageBytes: 2 * 1024 * 1024, inlineArtifactBytes: MAX_BYTES, partsBytes: 256 * 1024 }, }; }
  publicWorker({ send, close, connectionId, ...worker }) { return structuredClone(worker); }
  listWorkers() { return [...this.workers.values()].map(worker => this.publicWorker(worker)); }
  listRegisteredWorkers() { return [...this.identities].map(([name, value]) => this.workers.has(name) ? this.publicWorker(this.workers.get(name)) : { ...value.worker, status: 'offline' }); }
  listTasks() { return [...this.tasks.values()].filter(record => !record.direct).map(publicTask); }
  listDirectMessages() { return [...this.tasks.values()].filter(record => record.direct && !TERMINAL.has(record.state)).map(publicTask); }
  record(values) { const record = { receipts: [], artifacts: [], updates: [], lastSequence: 0, ...values }; record.completion = new Promise(resolve => { record.resolve = resolve; }); return record; }
  find({ messageId, taskId } = {}) {
    const record = this.tasks.get(messageId) || [...this.tasks.values()].find(record => record.taskId === taskId);
    if (!record) throw fail('TASK_NOT_FOUND', 'Unknown task.'); return record;
  }
  owns(ids) { return this.tasks.has(ids?.messageId) || [...this.tasks.values()].some(record => record.taskId === ids?.taskId); }
  context(agent, projectId) {
    const key = JSON.stringify([agent, projectId]);
    if (!this.contexts.has(key)) this.contexts.set(key, uuid());
    return this.contexts.get(key);
  }
  arm(record) {
    clearTimeout(record.timer);
    if (TERMINAL.has(record.state) || PAUSED.has(record.state)) return;
    record.timer = setTimeout(() => this.finish(record, 'timed_out', 'Office stopped waiting; remote execution may still be running.'), Math.max(1, record.deadline - Date.now())); record.timer.unref?.();
  }
  queue({ agent, task, title, projectId = 'central-office', officeTaskId, priority = 'medium', timeoutMs = 30 * 60_000, direct = false, purpose } = {}) {
    const worker = this.workers.get(agent);
    if (!worker) throw fail('WORKER_OFFLINE', 'Worker is disconnected.');
    if (typeof task !== 'string' || !task.trim() || task.length > 100_000) throw fail('INVALID_MESSAGE', 'Task must contain 1–100000 characters.');
    const record = this.record({ messageId: uuid(), taskId: uuid(), contextId: this.context(agent, projectId), agent, projectId, officeTaskId, priority, direct, purpose, title: title || task, prompt: task, protocol: 'websocket', protocolVersion: WS_VERSION, state: 'submitted', connectionId: worker.connectionId, createdAt: new Date().toISOString(), deadline: Date.now() + Math.max(1000, Math.min(3600000, Number(timeoutMs) || 1800000)) });
    this.tasks.set(record.messageId, record); this.arm(record); this.persist();
    queueMicrotask(() => this.submit(record).catch(error => this.finish(record, 'failed', error.message)));
    return { task: publicTask(record), completion: record.completion };
  }
  credentials(record) {
    const artifactUpload = this.options.createArtifactUpload?.(publicTask(record));
    return { ...(artifactUpload ? { artifactUpload } : {}), mcpServers: this.options.createMcpConnection?.(publicTask(record), artifactUpload) || undefined };
  }
  async submit(record) {
    let text = record.prompt;
    if (!record.direct && this.options.prepareLegacyTask) text = await this.options.prepareLegacyTask({ ...publicTask(record), task: text });
    if (TERMINAL.has(record.state)) return;
    const context = this.options.getMessageContext?.(record);
    record.command = { type: 'task', taskId: record.taskId, contextId: record.contextId, projectId: record.projectId, officeTaskId: record.officeTaskId, priority: record.priority, direct: record.direct, context, message: { messageId: record.messageId, role: 'user', parts: [{ text }] } };
    // Persist before sending. After reconnect Office queries, never replays an uncertain submission.
    record.startedAt = new Date().toISOString(); this.persist();
    const worker = this.workers.get(record.agent);
    if (!worker || worker.connectionId !== record.connectionId) { record.connectionError = 'Delivery uncertain; awaiting reconciliation.'; this.persist(); return; }
    worker.send({ ...record.command, ...this.credentials(record) });
    this.notify(record.direct ? 'onDirectMessageSent' : 'onTaskAssigned', publicTask(record));
  }
  sendDirectMessage({ agent, text, projectId = 'central-office', ...args }) {
    const paused = [...this.tasks.values()].find(record => record.direct && record.agent === agent && record.projectId === projectId && PAUSED.has(record.state));
    if (paused) return this.continueTask({ messageId: paused.messageId, text });
    return this.queue({ ...args, agent, task: text, projectId, direct: true, timeoutMs: args.timeoutMs || 300000 }).task;
  }
  continueTask({ text, ...ids }) {
    const record = this.find(ids);
    if (!PAUSED.has(record.state) || record.cancelPending) throw fail('INVALID_STATE', 'Task must be awaiting input or authorization.');
    if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw fail('INVALID_MESSAGE', 'A nonempty reply is required.');
    const worker = this.workers.get(record.agent);
    if (!worker || record.connectionError) throw fail('WORKER_OFFLINE', 'Reconcile this task before resuming.');
    record.command = { type: 'task_continue', taskId: record.taskId, contextId: record.contextId, message: { messageId: uuid(), role: 'user', parts: [{ text }] } };
    record.state = 'submitted'; record.deadline = Date.now() + 1800000; this.arm(record); this.persist();
    worker.send(record.command); return publicTask(record);
  }
  cancelTask(ids) {
    const record = this.find(ids);
    if (TERMINAL.has(record.state) && record.state !== 'timed_out') return { ...publicTask(record), alreadyStopped: true };
    delete record.cancelError;
    record.cancelPending ||= { requestId: uuid(), reason: String(ids.reason || 'Task stopped by the office manager.').slice(0, 1000) };
    this.persist();
    const worker = this.workers.get(record.agent);
    if (worker && !record.connectionError) this.sendCancel(worker, record);
    return publicTask(record);
  }
  sendCancel(worker, record) { worker.send({ type: 'task_cancel', taskId: record.taskId, contextId: record.contextId, ...record.cancelPending }); }
  unregisterConnection(connectionId, reason = 'Worker disconnected; awaiting task reconciliation.') {
    for (const [name, worker] of this.workers) if (worker.connectionId === connectionId) { this.workers.delete(name); this.notify('onWorkerDisconnected', { ...this.publicWorker(worker), status: 'offline' }); }
    for (const record of this.tasks.values()) if (record.connectionId === connectionId) { record.connectionId = null; record.connectionError = reason; }
    this.persist();
  }
  resumeConnection(name, connectionId) {
    const worker = this.workers.get(name);
    if (!worker || worker.connectionId !== connectionId) return;
    for (const record of this.tasks.values()) if (record.agent === name) {
      record.connectionId = connectionId;
      if (TERMINAL.has(record.state) && record.state !== 'timed_out') { delete record.connectionError; continue; }
      record.connectionError = 'Awaiting task snapshot.'; record.snapshotRequestId = uuid();
      worker.send({ type: 'task_get', requestId: record.snapshotRequestId, taskId: record.taskId, contextId: record.contextId, lastSequence: record.lastSequence, lastCommandMessageId: record.command?.message?.messageId, ...this.credentials(record), uploadsReset: true });
    }
    this.persist();
  }
  receive(name, payload, connectionId) {
    const result = this.receiveQueue.then(() => this.consume(name, payload, connectionId));
    this.receiveQueue = result.catch(() => {});
    return result;
  }
  async consume(name, payload, connectionId) {
    const worker = this.workers.get(name);
    if (!worker || worker.connectionId !== connectionId) throw fail('STALE_CONNECTION', 'Connection is no longer current.');
    if (payload.type === 'task_sync') { this.resumeConnection(name, connectionId); return { type: 'task_sync_ack' }; }
    const record = this.find({ taskId: payload.taskId });
    if (record.agent !== name || record.connectionId !== connectionId || payload.contextId !== record.contextId) throw fail('TASK_NOT_FOUND', 'Task does not belong to this worker/context.');
    if (payload.type === 'task_cancel_response') {
      const digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      if (record.lastCancelResponse?.requestId === payload.requestId) {
        if (record.lastCancelResponse.digest !== digest) throw fail('EVENT_CONFLICT', 'Cancellation response changed after acknowledgment.');
        return { type: 'task_cancel_response_ack', requestId: payload.requestId, taskId: record.taskId, duplicate: true };
      }
      if (!record.cancelPending || payload.requestId !== record.cancelPending.requestId) throw fail('INVALID_REQUEST', 'No matching cancellation request.');
      if (!payload.error?.code) throw fail('INVALID_REQUEST', 'Confirm cancellation using a sequenced cancelled task_update; use this response only to reject cancellation.');
      record.lastCancelResponse = { requestId: payload.requestId, digest };
      record.cancelError = { code: String(payload.error.code).slice(0,100), message: String(payload.error.message || 'Cancellation rejected.').slice(0,1000) }; delete record.cancelPending; this.persist();
      return { type: 'task_cancel_response_ack', requestId: payload.requestId, taskId: record.taskId };
    }
    const duplicate = record.receipts.find(entry => entry.eventId === payload.eventId);
    if (duplicate) {
      if (duplicate.digest !== crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')) throw fail('EVENT_CONFLICT', 'eventId was reused with different content.');
      return { type: `${payload.type}_ack`, taskId: record.taskId, requestId: payload.requestId, eventId: payload.eventId, sequence: payload.sequence, state: record.state, duplicate: true };
    }
    const snapshot = payload.type === 'task_snapshot';
    if (!snapshot && payload.type !== 'task_update' && payload.type !== 'artifact_update') throw fail('METHOD_NOT_FOUND', 'Unsupported v2 message.');
    if (snapshot && payload.requestId === record.lastMissingRequestId) return { type: 'task_snapshot_ack', taskId: record.taskId, requestId: payload.requestId, state: record.state, duplicate: true };
    if (snapshot && payload.requestId !== record.snapshotRequestId) throw fail('INVALID_REQUEST', 'Snapshot must answer the current task_get.');
    if (snapshot && payload.error?.code === 'TASK_NOT_FOUND') {
      record.lastMissingRequestId = payload.requestId;
      this.finish(record, 'failed', 'Worker has no durable record of this task; Office did not replay it.');
      return { type: 'task_snapshot_ack', taskId: record.taskId, requestId: payload.requestId, state: record.state };
    }
    if (!Number.isSafeInteger(payload.sequence) || payload.sequence < (snapshot ? 0 : 1) || typeof payload.eventId !== 'string' || !payload.eventId || payload.eventId.length > 200) throw fail('INVALID_SEQUENCE', 'Provide a sequence and unique eventId.');
    const digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const receipt = record.receipts.find(entry => entry.eventId === payload.eventId);
    if (receipt && receipt.digest !== digest) throw fail('EVENT_CONFLICT', 'eventId was reused with different content.');
    const ack = () => ({ type: `${payload.type}_ack`, taskId: record.taskId, requestId: payload.requestId, eventId: payload.eventId, sequence: payload.sequence, state: record.state });
    if (!snapshot && payload.sequence <= record.lastSequence) return { ...ack(), duplicate: true };
    if (!snapshot && record.connectionError) throw fail('SYNC_REQUIRED', 'Send the requested snapshot before new events.');
    if (snapshot && payload.sequence < record.lastSequence) throw fail('STALE_SNAPSHOT', 'Snapshot predates acknowledged events.');
    if (!snapshot && payload.sequence !== record.lastSequence + 1) throw fail('SEQUENCE_GAP', 'Request task_sync to reconcile missing events.');
    if (TERMINAL.has(record.state) && record.state !== 'timed_out') return { ...ack(), duplicate: true };
    let artifacts = structuredClone(record.artifacts);
    if (payload.type === 'artifact_update') {
      if (!worker.capabilities.artifactUpdates) throw fail('CAPABILITY_REQUIRED', 'artifactUpdates was not negotiated.');
      validateArtifacts([payload.artifact]);
      const prior = artifacts.find(entry => entry.artifactId === payload.artifact.artifactId);
      if (payload.append && prior) prior.parts.push(...payload.artifact.parts);
      else artifacts = [...artifacts.filter(entry => entry.artifactId !== payload.artifact.artifactId), payload.artifact];
    } else if (payload.artifacts !== undefined) artifacts = payload.artifacts;
    if (snapshot && payload.artifacts === undefined) throw fail('INVALID_SNAPSHOT', 'Snapshots require the full artifacts array.');
    validateArtifacts(artifacts);
    if (payload.message) validateParts(payload.message.parts);
    if (!worker.capabilities.structuredResults && [...artifacts.flatMap(artifact => artifact.parts), ...(payload.message?.parts || [])].some(part => Object.hasOwn(part, 'data'))) throw fail('CAPABILITY_REQUIRED', 'structuredResults was not negotiated.');
    for (const part of [...artifacts.flatMap(artifact => artifact.parts), ...(payload.message?.parts || [])]) {
      const mode = part.mediaType || (Object.hasOwn(part, 'data') ? 'application/json' : 'text/plain');
      if (typeof mode !== 'string' || !worker.capabilities.outputModes.some(accepted => accepted === '*/*' || accepted === mode || accepted === mode.split('/')[0] + '/*')) throw fail('UNSUPPORTED_CONTENT', 'Output mediaType was not advertised during registration.');
    }
    const state = payload.type === 'artifact_update' ? record.state : payload.state;
    if (payload.type !== 'artifact_update' && !STATES.has(state)) throw fail('INVALID_STATE', 'Unsupported worker task state.');
    let deliveredWork;
    if (state === 'completed') {
      // Validate and stage all outputs before acknowledging or advancing the sequence.
      deliveredWork = await this.options.materializeWsArtifacts?.(publicTask(record), artifacts, payload.uploadedArtifactIds || []) || [];
    }
    record.artifacts = structuredClone(artifacts); record.lastSequence = payload.sequence;
    record.receipts.push({ eventId: payload.eventId, digest }); record.receipts = record.receipts.slice(-256);
    if (payload.message) { record.text = partsText(payload.message.parts).slice(0,100000); record.responseParts = payload.message.parts; }
    if (snapshot) { delete record.snapshotRequestId; delete record.connectionError; }
    if (TERMINAL.has(state) && state !== 'timed_out') {
      record.deliveredWork = deliveredWork || record.deliveredWork;
      this.finish(record, state, state === 'completed' ? undefined : payload.error?.message || record.text);
    } else {
      // A local timeout is retained until the worker reports a terminal outcome.
      if (record.state !== 'timed_out') record.state = state;
      this.arm(record); this.persist();
      if (!record.direct || PAUSED.has(record.state)) this.notify(record.direct ? 'onDirectMessage' : 'onTaskEvent', record.state, publicTask(record));
    }
    if (snapshot && record.cancelPending && !TERMINAL.has(state)) this.sendCancel(worker, record);
    return ack();
  }
  result(record) { return { agent: record.agent, taskId: record.taskId, ok: record.state === 'completed', status: record.state, text: record.text, error: record.error, deliveredWork: record.deliveredWork || [] }; }
  finish(record, state, error) {
    if (TERMINAL.has(record.state) && record.state !== 'timed_out') return;
    record.state = state; record.error = error; record.finishedAt = new Date().toISOString(); clearTimeout(record.timer);
    if (state !== 'timed_out') delete record.cancelPending;
    this.persist();
    if (record.direct) this.notify('onDirectMessage', state, publicTask(record));
    else { this.notify('onTaskEvent', state, publicTask(record)); this.notify('onTaskSettled', this.result(record), publicTask(record)); }
    record.resolve(this.result(record));
    if (state !== 'timed_out') Promise.resolve(this.options.discardArtifactUploads?.(record.taskId)).catch(() => {});
  }
  close() { for (const record of this.tasks.values()) clearTimeout(record.timer); for (const worker of [...this.workers.values()]) { this.unregisterConnection(worker.connectionId); worker.close?.(1001, 'Office closing'); } }
  reset() { this.close(); this.workers.clear(); this.tasks.clear(); this.identities.clear(); this.contexts.clear(); this.persist(); }
}
