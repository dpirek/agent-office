import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { A2AClient } from './a2a-client.js';
import { formatWorkerMessageContext } from './worker-message-context.js';

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_DIRECT_MESSAGE_TIMEOUT_MS = 5 * 60_000;
const MAX_TIMEOUT_MS = 60 * 60_000;
const TERMINAL_TASK_STATES = new Set(['completed', 'failed', 'timed_out', 'cancelled', 'rejected']);
const PAUSED = new Set(['input_required', 'auth_required']);
const STATES = { TASK_STATE_SUBMITTED: 'assigned', TASK_STATE_WORKING: 'working', TASK_STATE_COMPLETED: 'completed', TASK_STATE_FAILED: 'failed', TASK_STATE_CANCELED: 'cancelled', TASK_STATE_REJECTED: 'rejected', TASK_STATE_INPUT_REQUIRED: 'input_required', TASK_STATE_AUTH_REQUIRED: 'auth_required' };
function messageText(message) { return (message?.parts || []).map(part => typeof part.text === 'string' ? part.text : Object.hasOwn(part, 'data') ? JSON.stringify(part.data) : '').filter(Boolean).join('\n'); }
function normalizeSubAgentWorkers(value = []) {
  const names = new Set();
  return value.map(worker => {
    const name = String(worker.name || '').trim();
    if (!name || name.length > 100 || names.has(name)) throw new Error('Agent names must be unique and between 1 and 100 characters.');
    names.add(name);
    const url = new URL(worker.url);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid agent URL.');
    return { name, description: String(worker.description || ''), url: url.href.replace(/\/$/, ''), capabilities: worker.capabilities || { skills: [], tools: [] }, ...(worker.model ? { model: worker.model } : {}) };
  });
}
function publicTask(record) {
  const { resolve, completion, controller, running, cancelRequested, ...task } = record;
  return structuredClone(task);
}
class SubAgentManager {
  constructor(options = {}) {
    Object.assign(this, { getMessageContext: () => null, prepareTask: null, prepareParts: async () => [], materializeArtifacts: async () => [], onTaskAssigned: () => {}, onTaskEvent: () => {}, onTaskSettled: () => {}, onDirectMessage: () => {}, onDirectMessageSent: () => {}, onWorkerRegistered: () => {}, onWorkerDisconnected: () => {}, saveState: () => {}, pollIntervalMs: 2000, clientFactory: config => A2AClient.discover(config) }, options);
    this.workers = new Map(); this.tasks = new Map(); this.directMessages = new Map(); this.closed = false;
  }
  notify(name, ...args) {
    try { this[name](...args); }
    catch (error) { console.error(`A2A ${name} callback failed: ${error.message}`); }
  }
  persist() {
    this.saveState({ workers: [...this.workers.values()].map(({ config }) => config), tasks: [...this.tasks.values(), ...this.directMessages.values()].map(publicTask) });
  }
  async restore(state = {}) {
    for (const config of state.workers || []) {
      try { await this.registerWorker(config); }
      catch (error) { this.workers.set(config.name, { config, name: config.name, url: config.url, status: 'offline', error: error.message }); }
    }
    for (const saved of state.tasks || []) {
      const record = this.makeRecord(saved);
      (record.direct ? this.directMessages : this.tasks).set(record.messageId, record);
      if (TERMINAL_TASK_STATES.has(record.state)) { record.resolve(this.result(record)); continue; }
      if (!record.remoteTaskId) { await this.finish(record, 'failed', 'Office restarted before receiving a task ID; remote execution is unknown. The request was not replayed.'); continue; }
      if (record.officeTaskId && !record.direct) this.notify('onTaskAssigned', publicTask(record));
      if (!PAUSED.has(record.state)) this.launch(record, () => this.monitor(record));
    }
    this.persist();
  }
  async registerWorker(config) {
    const client = await this.clientFactory(config);
    const name = String(config.name || client.card.name).trim();
    normalizeSubAgentWorkers([{ name, url: config.url }]);
    const existing = this.workers.get(name);
    if (existing && existing.config.url !== config.url) throw new Error('An agent with this name already exists. Choose a different name.');
    const worker = { name, description: client.card.description || '', url: config.url, status: 'connected', capabilities: { ...client.card.capabilities, skills: client.card.skills, tools: [] }, client, config: { ...config, name }, protocol: 'a2a', protocolVersion: '1.0', binding: client.interface.protocolBinding };
    this.workers.set(name, worker); this.persist();
    this.notify('onWorkerRegistered', this.publicWorker(worker));
    for (const record of [...this.tasks.values(), ...this.directMessages.values()]) if (record.agent === name && record.remoteTaskId && !TERMINAL_TASK_STATES.has(record.state) && !PAUSED.has(record.state)) this.launch(record, () => this.monitor(record));
    return this.publicWorker(worker);
  }
  removeWorker(name) {
    if ([...this.tasks.values(), ...this.directMessages.values()].some(task => task.agent === name && !TERMINAL_TASK_STATES.has(task.state))) throw new Error('Finish or cancel this agent’s active tasks before removing it.');
    this.workers.delete(name); this.persist();
  }
  publicWorker(worker) { const { client, config, ...result } = worker; return structuredClone(result); }
  listWorkers() { return [...this.workers.values()].filter(worker => worker.client).map(worker => this.publicWorker(worker)); }
  listRegisteredWorkers() { return [...this.workers.values()].map(worker => this.publicWorker(worker)); }
  listTasks() { return [...this.tasks.values()].map(publicTask); }
  listDirectMessages() { return [...this.directMessages.values()].filter(task => !TERMINAL_TASK_STATES.has(task.state)).map(publicTask); }
  makeRecord(values) {
    const record = { ...values, controller: new AbortController() };
    record.completion = new Promise(resolve => { record.resolve = resolve; });
    return record;
  }
  queue({ agent, task, title, projectId = 'central-office', officeTaskId, priority = 'medium', timeoutMs = DEFAULT_TIMEOUT_MS, direct = false, purpose } = {}) {
    const worker = this.workers.get(agent);
    if (!worker?.client) throw new Error(`Unknown or unavailable A2A agent: ${agent}`);
    if (typeof task !== 'string' || !task.trim() || task.length > 100_000) throw new Error('Task must contain between 1 and 100000 characters.');
    const inputs = [...(worker.client.card.defaultInputModes || []), ...(worker.client.card.skills || []).flatMap(skill => skill.inputModes || [])];
    if (!inputs.some(mode => ['text', 'text/plain', '*/*', 'text/*'].includes(mode))) throw new Error('This Office task requires an agent accepting text input.');
    const messageId = crypto.randomUUID();
    const record = this.makeRecord({ messageId, taskId: `assignment-${crypto.randomUUID()}`, agent, projectId, officeTaskId, priority, purpose, direct, title: title || task.trim(), prompt: task.trim(), state: 'assigned', createdAt: new Date().toISOString(), deadline: Date.now() + Math.max(1000, Math.min(MAX_TIMEOUT_MS, Number.isFinite(timeoutMs) ? Math.floor(timeoutMs) : DEFAULT_TIMEOUT_MS)), workerUrl: worker.url, updates: [], artifacts: [] });
    (direct ? this.directMessages : this.tasks).set(messageId, record); this.persist();
    // Start after callers have persisted their Office assignment.
    queueMicrotask(() => this.launch(record, () => this.send(record)));
    return { task: publicTask(record), completion: record.completion };
  }
  delegate(options) { return this.queue(options).completion; }
  sendDirectMessage({ text, timeoutMs = DEFAULT_DIRECT_MESSAGE_TIMEOUT_MS, ...options }) {
    const pending = [...this.directMessages.values()].find(record => record.agent === options.agent && record.projectId === (options.projectId || 'central-office') && PAUSED.has(record.state));
    if (pending) {
      if (typeof text !== 'string' || !text.trim() || text.length > 100_000) throw new Error('A nonempty reply is required.');
      if (pending.running) throw new Error('Agent is still settling its response; retry shortly.');
      pending.state = 'working'; pending.deadline = Date.now() + timeoutMs; this.persist();
      this.notify('onDirectMessageSent', { ...publicTask(pending), text });
      this.launch(pending, () => this.send(pending, text.trim()));
      return publicTask(pending);
    }
    const queued = this.queue({ ...options, task: text, timeoutMs, direct: true });
    this.notify('onDirectMessageSent', { ...queued.task, text }); return queued.task;
  }
  launch(record, fn) {
    if (record.running || this.closed) return;
    record.running = true;
    void fn().catch(async error => {
      if (this.closed || TERMINAL_TASK_STATES.has(record.state)) return;
      await this.finish(record, 'failed', error.message);
    }).finally(() => { record.running = false; });
  }
  client(record) {
    const client = this.workers.get(record.agent)?.client;
    if (!client) throw new Error('Agent is unavailable. Reconnect it using its Agent Card URL.');
    return client;
  }
  async send(record, continuation) {
    let text = continuation || record.prompt;
    if (!continuation) {
      if (this.prepareTask && !record.direct) text = await this.prepareTask({ ...publicTask(record), task: text });
      else { const context = this.getMessageContext(record); if (context) text = formatWorkerMessageContext(context, text); }
    }
    if (TERMINAL_TASK_STATES.has(record.state)) return;
    if (record.cancelRequested && !record.remoteTaskId) { await this.finish(record, 'cancelled'); return; }
    const message = { messageId: continuation ? crypto.randomUUID() : record.messageId, role: 'ROLE_USER', parts: [{ text }, ...(!continuation && !record.direct ? await this.prepareParts(publicTask(record), this.client(record).card.defaultInputModes || []) : [])], ...(record.remoteTaskId ? { taskId: record.remoteTaskId, contextId: record.contextId } : {}) };
    const client = this.client(record);
    const params = { message, configuration: { returnImmediately: !client.card.capabilities?.streaming } };
    record.startedAt ||= new Date().toISOString();
    if (!continuation && !record.direct) this.notify('onTaskAssigned', publicTask(record));
    if (client.card.capabilities?.streaming) {
      try {
        for await (const event of client.sendMessageStream(params, { signal: this.signal(record) })) {
          await this.consume(record, event);
          if (TERMINAL_TASK_STATES.has(record.state) || PAUSED.has(record.state)) return;
        }
      } catch (error) {
        if (!record.remoteTaskId) throw new Error(`Submission failed before a remote task ID was received; execution may be unknown. ${error.message}`);
        // Once the server assigned an ID, recover with GetTask; never replay SendMessage.
        record.connectionError = error.message; this.persist();
      }
    } else await this.consume(record, await client.sendMessage(params, { signal: this.signal(record) }));
    if (TERMINAL_TASK_STATES.has(record.state) || PAUSED.has(record.state)) return;
    if (!record.remoteTaskId) throw new Error('Agent response contained neither a task nor a message.');
    await this.monitor(record);
  }
  signal(record) { return AbortSignal.any([record.controller.signal, AbortSignal.timeout(Math.max(1, Math.min(30_000, record.deadline - Date.now()))) ]); }
  async consume(record, event) {
    if (TERMINAL_TASK_STATES.has(record.state)) return;
    if (event.message) {
      if (!event.message.messageId || !event.message.contextId || event.message.role !== 'ROLE_AGENT') throw new Error('Invalid A2A response message.');
      record.contextId = event.message.contextId;
      record.text = messageText(event.message);
      record.responseMessage = event.message;
      const files = (event.message.parts || []).filter(part => !Object.hasOwn(part, 'text'));
      if (files.length) record.artifacts = [{ artifactId: event.message.messageId, parts: files }];
      await this.finish(record, 'completed'); return;
    }
    const task = event.task;
    const update = event.statusUpdate || event.artifactUpdate;
    const remoteId = task?.id || update?.taskId;
    const contextId = task?.contextId || update?.contextId;
    if (!remoteId || !contextId) throw new Error('A2A task events require task and context identifiers.');
    if ((record.remoteTaskId && record.remoteTaskId !== remoteId) || (record.contextId && record.contextId !== contextId)) throw new Error('Agent returned a mismatched task or context identifier.');
    record.remoteTaskId = remoteId; record.contextId = contextId;
    if (task?.artifacts) record.artifacts = structuredClone(task.artifacts);
    if (task?.history) record.history = task.history;
    if (event.artifactUpdate) {
      const { artifact, append } = event.artifactUpdate;
      if (!artifact?.artifactId || !Array.isArray(artifact.parts)) throw new Error('Invalid A2A artifact update.');
      const prior = record.artifacts.find(entry => entry.artifactId === artifact.artifactId);
      if (append && prior) prior.parts.push(...artifact.parts);
      else record.artifacts = [...record.artifacts.filter(entry => entry.artifactId !== artifact.artifactId), structuredClone(artifact)];
    }
    const status = task?.status || event.statusUpdate?.status;
    if (status) {
      const state = STATES[status.state];
      if (!state) throw new Error(`Unsupported A2A task state: ${status.state}`);
      record.a2aStatus = status;
      const text = messageText(status.message) || (task?.history || []).filter(message => message.role === 'ROLE_AGENT').map(messageText).filter(Boolean).at(-1) || (state === 'input_required' ? 'The agent needs more input. Reply to continue.' : state === 'auth_required' ? 'The agent needs authorization. Update its credentials, then reply to continue.' : undefined);
      if (text && text !== record.text) { record.text = text; record.updates.push({ text, at: new Date().toISOString() }); }
      if (TERMINAL_TASK_STATES.has(state)) { await this.finish(record, state, state === 'completed' ? undefined : text); return; }
      const changed = record.state !== state || record.lastEmittedText !== text;
      record.lastEmittedText = text;
      record.state = state; delete record.connectionError;
      if (changed && !record.direct) this.notify('onTaskEvent', state, publicTask(record));
      if (changed && record.direct && PAUSED.has(state)) this.notify('onDirectMessage', state, publicTask(record));
    }
    this.persist();
  }
  async monitor(record) {
    while (!this.closed && !TERMINAL_TASK_STATES.has(record.state) && !PAUSED.has(record.state)) {
      if (Date.now() >= record.deadline) { await this.finish(record, 'timed_out', 'Office stopped waiting; the remote task may still be running. Its ID is retained for reconciliation.'); return; }
      try { await this.consume(record, { task: await this.client(record).getTask(record.remoteTaskId, { signal: this.signal(record) }) }); }
      catch (error) {
        if (this.closed) return;
        if (error.status === 401 || error.status === 403) { record.state = 'auth_required'; record.text = 'Update the agent credentials, then resume this task.'; this.notify(record.direct ? 'onDirectMessage' : 'onTaskEvent', record.state, publicTask(record)); this.persist(); return; }
        if (error.code === -32001 || error.status === 404) { await this.finish(record, 'failed', error.message); return; }
        record.connectionError = error.message; this.persist();
      }
      if (TERMINAL_TASK_STATES.has(record.state) || PAUSED.has(record.state)) return;
      await delay(this.pollIntervalMs, undefined, { signal: record.controller.signal }).catch(() => {});
    }
  }
  find({ messageId, taskId }) {
    const task = this.tasks.get(messageId) || this.directMessages.get(messageId) || [...this.tasks.values(), ...this.directMessages.values()].find(entry => entry.taskId === taskId || entry.remoteTaskId === taskId);
    if (!task) throw new Error('Unknown Office assignment.'); return task;
  }
  async continueTask({ messageId, taskId, text }) {
    const record = this.find({ messageId, taskId });
    if (!PAUSED.has(record.state)) throw new Error('Only tasks awaiting input or authentication can be resumed.');
    if (!record.remoteTaskId || typeof text !== 'string' || !text.trim() || text.length > 100_000) throw new Error('A remote task and a nonempty reply are required.');
    if (record.running) throw new Error('Task is still settling; retry shortly.');
    record.state = 'working'; record.deadline = Date.now() + DEFAULT_TIMEOUT_MS; this.persist();
    this.launch(record, () => this.send(record, text.trim()));
    return publicTask(record);
  }
  async cancelTask(ids = {}) {
    const record = this.find(ids);
    if (TERMINAL_TASK_STATES.has(record.state) && record.state !== 'timed_out') return { ...publicTask(record), alreadyStopped: true };
    if (!record.startedAt) { record.cancelRequested = true; await this.finish(record, 'cancelled'); return publicTask(record); }
    if (!record.remoteTaskId) throw new Error('Wait for the agent to acknowledge the task before cancelling. Remote execution is not yet known.');
    const task = await this.client(record).cancelTask(record.remoteTaskId);
    // A timeout is local, so a later cancellation must still reconcile the remote state.
    if (record.state === 'timed_out') record.state = 'working';
    await this.consume(record, { task });
    return publicTask(record);
  }
  result(record) { return { agent: record.agent, taskId: record.remoteTaskId || record.taskId, ok: record.state === 'completed', status: record.state, text: record.text, error: record.error, deliveredWork: record.deliveredWork || [] }; }
  async finish(record, state, error) {
    if (TERMINAL_TASK_STATES.has(record.state)) return;
    if (state === 'completed') {
      try {
        record.deliveredWork = await this.materializeArtifacts(publicTask(record), record.artifacts, this.client(record));
        const artifactText = record.artifacts.map(artifact => messageText(artifact)).filter(Boolean).join('\n');
        if (artifactText && !messageText(record.a2aStatus?.message)) record.text = artifactText;
      } catch (failure) { state = 'failed'; error = `Unable to store A2A artifacts: ${failure.message}`; }
    }
    record.state = state; record.error = error; record.finishedAt = new Date().toISOString();
    this.persist();
    if (record.direct) this.notify('onDirectMessage', state, publicTask(record));
    else { this.notify('onTaskEvent', state, publicTask(record)); this.notify('onTaskSettled', this.result(record), publicTask(record)); }
    record.resolve(this.result(record));
  }
  close() { this.closed = true; for (const task of [...this.tasks.values(), ...this.directMessages.values()]) task.controller.abort(); }
}
export { DEFAULT_DIRECT_MESSAGE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, SubAgentManager, TERMINAL_TASK_STATES, normalizeSubAgentWorkers };
