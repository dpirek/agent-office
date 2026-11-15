import { SubAgentManager as A2AManager } from './a2a-sub-agents.js';
import { WsV2Manager } from './ws-v2-agents.js';
import { SubAgentManager as LegacyManager } from './legacy-sub-agents.js';

// Separate protocol lifecycles, one directory for office assignment and chat.
class SubAgentManager extends A2AManager {
  constructor(options = {}) {
    super(options);
    this.legacyHistory = new Map();
    this.wsV2 = new WsV2Manager(options);
    this.legacy = new LegacyManager({
      ...options,
      prepareTask: options.prepareLegacyTask || options.prepareTask,
      materializeArtifacts: options.materializeLegacyArtifacts || options.materializeArtifacts,
      onWorkerRegistered: worker => {
        this.legacyHistory.set(worker.name, worker);
        this.notify('onWorkerRegistered', worker);
      },
      onWorkerDisconnected: worker => {
        this.legacyHistory.set(worker.name, worker);
        this.notify('onWorkerDisconnected', worker);
      },
    });
    this.validateRegistration = name => {
      if (this.legacyHistory.has(name) || this.wsV2.hasName(name)) throw new Error('A WebSocket worker already uses this name. Choose a different A2A agent name.');
    };
  }
  registerWorker(config, transport) {
    if (!transport) return super.registerWorker(config);
    config = { ...config, name: String(config.name || "").trim() };
    if (this.workers.has(String(config.name || '').trim())) throw new Error('An A2A agent already uses this name. Choose a different worker name.');
    if (config.protocolVersion === '2.0') {
      if (this.legacy.workers.has(config.name)) throw new Error('Disconnect the v1 worker before upgrading.');
      const registered = this.wsV2.registerWorker(config, transport);
      this.legacyHistory.delete(config.name);
      return registered;
    }
    if (config.protocolVersion && config.protocolVersion !== '1.0') throw new Error('Unsupported WebSocket protocolVersion.');
    if (this.wsV2.hasName(config.name)) throw new Error('This worker is registered for WebSocket v2; downgrading is not supported.');
    return this.legacy.registerWorker(config, transport);
  }
  restoreLegacyWorkers(workers = []) {
    for (const worker of workers) if (/^wss?:/.test(worker.url)) {
      this.legacyHistory.set(worker.name, { ...worker, protocol: 'websocket', binding: 'WebSocket', status: 'offline' });
    }
  }
  listWorkers() { return [...super.listWorkers(), ...this.legacy.listWorkers(), ...this.wsV2.listWorkers()]; }
  listRegisteredWorkers() { return [...super.listRegisteredWorkers(), ...[...this.legacyHistory.values()].filter(worker => !this.wsV2.hasName(worker.name)), ...this.wsV2.listRegisteredWorkers()]; }
  listTasks() { return [...super.listTasks(), ...this.legacy.listTasks(), ...this.wsV2.listTasks()]; }
  listDirectMessages() { return [...super.listDirectMessages(), ...this.legacy.listDirectMessages(), ...this.wsV2.listDirectMessages()]; }
  queue(options) { if (this.wsV2.hasName(options?.agent)) return this.wsV2.queue(options); return this.legacy.workers.has(options?.agent) ? this.legacy.queue(options) : super.queue(options); }
  delegate(options) { return this.queue(options).completion; }
  sendDirectMessage(options) { if (this.wsV2.hasName(options?.agent)) return this.wsV2.sendDirectMessage(options); return this.legacy.workers.has(options?.agent) ? this.legacy.sendDirectMessage(options) : super.sendDirectMessage(options); }
  continueTask(ids) { return this.wsV2.owns(ids) ? this.wsV2.continueTask(ids) : super.continueTask(ids); }
  registration(name) { return this.wsV2.hasName(name) ? this.wsV2.registration(name) : {}; }
  resumeConnection(...args) { return this.wsV2.resumeConnection(...args); }
  receiveV2(...args) { return this.wsV2.receive(...args); }
  cancelTask(ids = {}) {
    if (this.wsV2.owns(ids)) return this.wsV2.cancelTask(ids);
    return this.legacy.tasks.has(ids.messageId) || this.legacy.taskIds.has(ids.taskId)
      ? this.legacy.cancelTask(ids) : super.cancelTask(ids);
  }
  unregisterConnection(...args) { this.wsV2.unregisterConnection(...args); return this.legacy.unregisterConnection(...args); }
  receiveUpdate(...args) { return this.legacy.receiveUpdate(...args); }
  receiveDirectMessage(...args) { return this.legacy.receiveDirectMessage(...args); }
  removeWorker(name) {
    if (this.legacyHistory.has(name) || this.wsV2.hasName(name)) throw new Error('Disconnect WebSocket workers at their client. This endpoint removes A2A registrations.');
    return super.removeWorker(name);
  }
  reset() {
    this.wsV2.reset();
    for (const worker of [...this.legacy.workers.values()]) {
      this.legacy.unregisterConnection(worker.connectionId, 'Office reset.');
      worker.close?.(1001, 'Office reset');
    }
    this.workers.clear(); this.tasks.clear(); this.directMessages.clear();
    this.legacy.tasks.clear(); this.legacy.taskIds.clear(); this.legacy.directMessages.clear(); this.legacyHistory.clear();
    this.persist();
  }
  close() {
    super.close();
    this.wsV2.close();
    for (const worker of [...this.legacy.workers.values()]) {
      this.legacy.unregisterConnection(worker.connectionId, 'Office shutting down.');
      worker.close?.(1001, 'Office shutting down');
    }
  }
}
export { SubAgentManager };
export { DEFAULT_DIRECT_MESSAGE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, TERMINAL_TASK_STATES, normalizeSubAgentWorkers } from './a2a-sub-agents.js';
