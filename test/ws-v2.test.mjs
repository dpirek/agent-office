import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SubAgentManager } from '../lib/sub-agents.js';
import { createUiStateStore } from '../lib/ui-state.js';
import { until } from './helpers/a2a.mjs';

const config = (name = 'Modern') => ({ name, protocolVersion: '2.0', url: 'ws://office.test/ws/workers', capabilities: { skills: [], tools: [], inputModes: ['text/plain'], outputModes: ['text/*', 'application/json'], structuredResults: true, artifactUpdates: true } });
function setup(t, options = {}) {
  const frames = [], saved = [];
  const manager = new SubAgentManager({ saveWsState: state => saved.push(structuredClone(state)), ...options });
  t.after(() => manager.close());
  manager.registerWorker(config(), { connectionId: 'one', send: frame => frames.push(frame) });
  const send = (task, sequence, state, extra = {}, connectionId = 'one') => manager.receiveV2('Modern', { type: 'task_update', taskId: task.taskId, contextId: task.contextId, sequence, eventId: `event-${sequence}`, state, ...extra }, connectionId);
  return { manager, frames, saved, send };
}
test('v2 negotiates capabilities, isolates conversations by worker/project, and keeps v1 unchanged', async t => {
  const { manager, frames } = setup(t);
  assert.equal(manager.registration('Modern').protocolVersion, '2.0');
  assert.ok(manager.registration('Modern').resumeToken);
  assert.equal(JSON.stringify(manager.listRegisteredWorkers()).includes('resumeToken'), false);
  const a = manager.queue({ agent: 'Modern', task: 'one', projectId: 'p' });
  const b = manager.queue({ agent: 'Modern', task: 'two', projectId: 'p' });
  const c = manager.queue({ agent: 'Modern', task: 'three', projectId: 'q' });
  assert.equal(a.task.contextId, b.task.contextId); assert.notEqual(a.task.contextId, c.task.contextId);
  await until(() => frames.length === 3);
  assert.equal(frames[0].message.role, 'user'); assert.equal(frames[0].message.parts[0].text, 'one');
  assert.throws(() => manager.registerWorker({ ...config(), protocolVersion: '1.0' }, { connectionId: 'old', send() {} }), /downgrading/);
  assert.throws(() => manager.registerWorker({ ...config('Other'), protocolVersion: '9.0' }, { connectionId: 'old', send() {} }), /Unsupported/);
});
test('v2 pauses and continues the same task with a new message ID', async t => {
  const { manager, frames, send } = setup(t);
  const queued = manager.queue({ agent: 'Modern', task: 'build' }); await until(() => frames.length);
  await send(queued.task, 1, 'input_required', { message: { parts: [{ text: 'Which color?' }] } });
  assert.equal(manager.listTasks()[0].state, 'input_required');
  manager.continueTask({ messageId: queued.task.messageId, text: 'blue' });
  assert.equal(frames.at(-1).type, 'task_continue'); assert.equal(frames.at(-1).taskId, queued.task.taskId);
  assert.notEqual(frames.at(-1).message.messageId, queued.task.messageId);
  await send(queued.task, 2, 'completed', { message: { parts: [{ text: 'Done' }] } });
  assert.equal((await queued.completion).status, 'completed');
});
test('v2 cancellation remains pending, accepts rejection and only settles on confirmation', async t => {
  const { manager, frames, send } = setup(t);
  const queued = manager.queue({ agent: 'Modern', task: 'build' }); await until(() => frames.length);
  const pending = manager.cancelTask({ messageId: queued.task.messageId });
  assert.ok(pending.cancelPending); assert.equal(pending.state, 'submitted');
  const first = frames.at(-1); manager.cancelTask({ messageId: queued.task.messageId }); assert.equal(frames.at(-1).requestId, first.requestId);
  await manager.receiveV2('Modern', { type: 'task_cancel_response', taskId: queued.task.taskId, contextId: queued.task.contextId, requestId: first.requestId, error: { code: 'NOT_CANCELABLE', message: 'Committing output' } }, 'one');
  assert.equal(manager.listTasks()[0].cancelError.message, 'Committing output');
  assert.equal(manager.listTasks()[0].cancelPending, undefined);
  manager.cancelTask({ messageId: queued.task.messageId });
  await send(queued.task, 1, 'cancelled');
  assert.equal((await queued.completion).status, 'cancelled');
});
test('v2 reconnects without failing or replaying work, checks resume identity and reconciles snapshots', async t => {
  const { manager, frames, send } = setup(t);
  const queued = manager.queue({ agent: 'Modern', task: 'build' }); await until(() => frames.length);
  await send(queued.task, 1, 'working');
  manager.unregisterConnection('one'); assert.equal(manager.listTasks()[0].state, 'working');
  assert.throws(() => manager.registerWorker(config(), { connectionId: 'two', send() {} }), /resumeToken/);
  const resumeToken = manager.registration('Modern').resumeToken;
  manager.registerWorker({ ...config(), resumeToken }, { connectionId: 'two', send: frame => frames.push(frame) });
  manager.resumeConnection('Modern', 'two');
  const query = frames.at(-1); assert.equal(query.type, 'task_get'); assert.equal(query.lastSequence, 1);
  await assert.rejects(send(queued.task, 2, 'working', {}, 'one'), /current/);
  await assert.rejects(send(queued.task, 2, 'working', {}, 'two'), /snapshot/);
  await manager.receiveV2('Modern', { type: 'task_snapshot', requestId: query.requestId, taskId: query.taskId, contextId: query.contextId, eventId: 'snapshot-3', sequence: 3, state: 'completed', artifacts: [], message: { parts: [{ text: 'Finished offline' }] } }, 'two');
  assert.equal((await queued.completion).text, 'Finished offline');
  assert.equal(frames.filter(frame => frame.type === 'task').length, 1);
});
test('v2 duplicate artifact events and concurrent retransmissions materialize only once', async t => {
  const materialized = [];
  const { manager, frames, send } = setup(t, { materializeWsArtifacts: async (_, artifacts) => { materialized.push(structuredClone(artifacts)); return [{ name: 'report.txt' }]; } });
  const queued = manager.queue({ agent: 'Modern', task: 'report' }); await until(() => frames.length);
  const artifact = { artifactId: 'report', parts: [{ text: 'Hello', filename: 'report.txt' }] };
  await send(queued.task, 1, undefined, { type: 'artifact_update', artifact });
  const event = { type: 'artifact_update', artifact: { ...artifact, parts: [{ text: ' world', filename: 'report.txt' }] }, append: true };
  await send(queued.task, 2, undefined, event);
  assert.equal((await send(queued.task, 2, undefined, event)).duplicate, true);
  await assert.rejects(send(queued.task, 4, 'working'), /missing events/);
  await assert.rejects(send(queued.task, 2, 'working'), /different content/);
  await Promise.all([send(queued.task, 3, 'completed'), send(queued.task, 3, 'completed')]);
  assert.equal(materialized.length, 1); assert.equal(materialized[0][0].parts.length, 2);
  assert.equal((await queued.completion).deliveredWork[0].name, 'report.txt');
});
test('v2 import failure does not acknowledge or advance sequence; corrected retry can finish', async t => {
  let attempts = 0;
  const { manager, frames, send } = setup(t, { materializeWsArtifacts: async () => { if (++attempts === 1) throw new Error('Upload is missing'); return []; } });
  const queued = manager.queue({ agent: 'Modern', task: 'report' }); await until(() => frames.length);
  await assert.rejects(send(queued.task, 1, 'completed'), /Upload is missing/);
  assert.equal(manager.listTasks()[0].lastSequence, 0);
  await send(queued.task, 1, 'completed'); assert.equal((await queued.completion).ok, true);
});
test('v2 task ownership and optional structured capability are enforced', async t => {
  const { manager, frames, send } = setup(t);
  const queued = manager.queue({ agent: 'Modern', task: 'report' }); await until(() => frames.length);
  await assert.rejects(send(queued.task, 1, 'working', { contextId: 'wrong' }), /does not belong/);
  await assert.rejects(send(queued.task, 1, 'completed', { artifacts: [{ artifactId: 'unsafe', parts: [{ url: 'http://private' }] }] }), /Only text/);
  manager.wsV2.workers.get('Modern').capabilities.structuredResults = false;
  await assert.rejects(send(queued.task, 1, 'completed', { message: { parts: [{ data: { ok: true } }] } }), /not negotiated/);
  assert.equal(manager.listTasks()[0].lastSequence, 0);
});
test('v2 direct questions can pause and resume without reporting working as a failure', async t => {
  const notifications = [];
  const { manager, frames, send } = setup(t, { onDirectMessage: state => notifications.push(state) });
  const direct = manager.sendDirectMessage({ agent: 'Modern', text: 'question', projectId: 'p' }); await until(() => frames.length);
  await send(direct, 1, 'working'); assert.deepEqual(notifications, []);
  await send(direct, 2, 'auth_required', { message: { parts: [{ text: 'Authorize the tool' }] } });
  manager.sendDirectMessage({ agent: 'Modern', text: 'authorized', projectId: 'p' });
  assert.equal(frames.at(-1).type, 'task_continue');
  await send(direct, 3, 'completed', { message: { parts: [{ data: { answer: 42 } }] } });
  assert.deepEqual(notifications, ['auth_required', 'completed']); assert.equal(manager.listDirectMessages().length, 0);
});
test('v2 SQLite restart retains identity, cancellation and tasks, then reconciles without submission', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'office-ws-v2-'));
  const db = createUiStateStore(path.join(dir, 'state.sqlite'));
  const { manager, frames } = setup(t, { saveWsState: state => db.saveWsState(state) });
  const queued = manager.queue({ agent: 'Modern', task: 'persist' }); await until(() => frames.length);
  const token = manager.registration('Modern').resumeToken;
  manager.cancelTask({ messageId: queued.task.messageId }); manager.close();
  const restoredFrames = [];
  const restored = new SubAgentManager({ saveWsState: state => db.saveWsState(state) });
  t.after(() => restored.close());
  restored.wsV2.restore(db.getWsState());
  restored.registerWorker({ ...config(), resumeToken: token }, { connectionId: 'new', send: frame => restoredFrames.push(frame) });
  restored.resumeConnection('Modern', 'new'); const query = restoredFrames.at(-1);
  await restored.receiveV2('Modern', { type: 'task_snapshot', taskId: query.taskId, contextId: query.contextId, requestId: query.requestId, sequence: 0, eventId: 'snapshot-0', state: 'working', artifacts: [] }, 'new');
  assert.equal(restoredFrames.at(-1).type, 'task_cancel');
  assert.equal(restoredFrames.some(frame => frame.type === 'task'), false);
  assert.equal(restored.listTasks()[0].taskId, queued.task.taskId);
  t.after(async () => { db.close(); await fs.rm(dir, { recursive: true, force: true }); });
});

test('real WebSocket v2 registration, recoverable errors, reconnect and snapshot acknowledgment', async t => {
  const { default: http } = await import('node:http');
  const { attachWebSocketServer } = await import('../lib/ws.js');
  const { createWorkerWebSocketHandler } = await import('../lib/worker-ws.js');
  const manager = new SubAgentManager();
  const server = http.createServer();
  attachWebSocketServer(server, () => {}, '/ws', { '/ws/workers': createWorkerWebSocketHandler({ subAgentManager: manager, getToken: () => 'shared-test-token' }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const sockets = [];
  t.after(async () => { for (const ws of sockets) ws.close(); manager.close(); await new Promise(resolve => server.close(resolve)); });
  const resumeToken = 'worker-owned-persistent-key-1234567890';
  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws/workers`); sockets.push(ws);
    const messages = []; ws.addEventListener('message', event => messages.push(JSON.parse(event.data)));
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    ws.send(JSON.stringify({ type: 'register', protocolVersion: '2.0', credentials: { token: 'shared-test-token', resumeToken }, worker: config() }));
    await until(() => messages.some(message => message.type === 'registered'));
    assert.equal(messages[0].protocolVersion, '2.0'); assert.equal(messages[0].resumeToken, resumeToken);
    return { ws, messages };
  };
  const first = await connect();
  const queued = manager.queue({ agent: 'Modern', task: 'wire test' });
  await until(() => first.messages.some(message => message.type === 'task'));
  first.ws.send(JSON.stringify({ type: 'task_update', taskId: queued.task.taskId, contextId: queued.task.contextId, eventId: 'invalid', sequence: 1, state: 'nonsense' }));
  await until(() => first.messages.some(message => message.code === 'INVALID_STATE'));
  assert.equal(first.ws.readyState, WebSocket.OPEN);
  first.ws.close(); await until(() => manager.listWorkers().length === 0);
  assert.equal(manager.listTasks()[0].state, 'submitted');
  const second = await connect(); await until(() => second.messages.some(message => message.type === 'task_get'));
  const query = second.messages.find(message => message.type === 'task_get');
  const snapshot = { type: 'task_snapshot', taskId: query.taskId, contextId: query.contextId, requestId: query.requestId, eventId: 'snapshot-complete', sequence: 2, state: 'completed', artifacts: [], message: { parts: [{ text: 'Recovered' }] } };
  second.ws.send(JSON.stringify(snapshot)); await until(() => second.messages.some(message => message.type === 'task_snapshot_ack'));
  second.ws.send(JSON.stringify(snapshot)); await until(() => second.messages.some(message => message.duplicate));
  assert.equal((await queued.completion).text, 'Recovered');
  second.ws.close(); await until(() => manager.listWorkers().length === 0);
  const third = await connect();
  third.ws.send(JSON.stringify(snapshot)); await until(() => third.messages.some(message => message.duplicate));
  assert.equal(third.messages.some(message => message.type === 'task'), false);
});

test('v2 pending cancellation is exposed without completing the office task', async t => {
  const { cancelOfficeTask, readOfficeTasks } = await import('../lib/office-tasks.js');
  const { manager, frames } = setup(t);
  const queued = manager.queue({ agent: 'Modern', task: 'cancel API', officeTaskId: 'office-1' }); await until(() => frames.length);
  let completed = false;
  const task = { id: 'office-1', messageId: queued.task.messageId, status: 'running' };
  const store = { getOfficeTasks: () => [task], completeOfficeTask: () => { completed = true; } };
  const result = await cancelOfficeTask(store, manager, { id: task.id });
  assert.equal(result.cancelPending, true); assert.equal(completed, false);
  assert.equal(readOfficeTasks(store, manager).tasks[0].cancelPending, true);
});

test('mixed uploaded and native artifacts share an atomic project delivery', async t => {
  const { createSharedWorkspace } = await import('../lib/shared-workspace.js');
  const { storeA2AArtifacts } = await import('../lib/a2a-artifacts.js');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-v2-artifacts-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const upload = path.join(root, 'upload'); await fs.writeFile(upload, 'uploaded bytes');
  const workspace = createSharedWorkspace({ root: path.join(root, 'projects') });
  const task = { taskId: 'task', projectId: 'central-office', agent: 'Modern' };
  const files = await storeA2AArtifacts(workspace, task, [{ artifactId: 'json', parts: [{ data: { ok: true }, filename: 'checks.json' }] }], null, [{ artifactId: 'upload', name: 'file.txt', file: upload, size: 14 }]);
  assert.equal(files.length, 2);
  assert.equal(await fs.readFile(path.join(root, 'projects/central-office/file.txt'), 'utf8'), 'uploaded bytes');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'projects/central-office/checks.json'), 'utf8')), { ok: true });
  await assert.rejects(storeA2AArtifacts(workspace, task, [{ artifactId: 'invalid', parts: [{ text: 'bad', data: {} }] }], null, [{ name: 'file.txt', file: upload, size: 14 }]), /exactly one/);
  assert.equal(await fs.readFile(path.join(root, 'projects/central-office/file.txt'), 'utf8'), 'uploaded bytes');
});

test('v2 timed-out work remains reconcilable and an unknown worker task is never resubmitted', async t => {
  const { manager, frames, send } = setup(t);
  const queued = manager.queue({ agent: 'Modern', task: 'slow' }); await until(() => frames.length);
  const record = manager.wsV2.find({ messageId: queued.task.messageId });
  manager.wsV2.finish(record, 'timed_out', 'Local deadline');
  assert.equal((await queued.completion).status, 'timed_out');
  manager.cancelTask({ messageId: queued.task.messageId });
  assert.ok(manager.listTasks()[0].cancelPending);
  await send(queued.task, 1, 'cancelled'); assert.equal(manager.listTasks()[0].state, 'cancelled');
  const missing = manager.queue({ agent: 'Modern', task: 'unknown' }); await until(() => frames.some(frame => frame.taskId === missing.task.taskId));
  manager.resumeConnection('Modern', 'one');
  const query = frames.at(-1);
  await manager.receiveV2('Modern', { type: 'task_snapshot', taskId: query.taskId, contextId: query.contextId, requestId: query.requestId, error: { code: 'TASK_NOT_FOUND' } }, 'one');
  assert.equal((await missing.completion).status, 'failed');
  assert.equal(frames.filter(frame => frame.type === 'task' && frame.taskId === missing.task.taskId).length, 1);
});
