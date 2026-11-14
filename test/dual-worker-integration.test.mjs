import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { SubAgentManager } from '../lib/sub-agents.js';
import { fakeClient, message, until } from './helpers/a2a.mjs';
import { createSubAgentApiHandlers } from '../api/sub-agents.js';

const worker = name => ({ name, url: 'ws://office.test/ws/workers', capabilities: { skills: [], tools: [] } });
test('A2A and legacy workers coexist: assignment, replies, cancellation, and isolated persistence', async t => {
  const sent = [], native = [], saved = [];
  const manager = new SubAgentManager({
    clientFactory: async () => fakeClient({ sent: native, response: { message: message('A2A done') } }),
    prepareLegacyTask: async task => `Legacy: ${task.task}`,
    saveState: state => saved.push(state),
    createArtifactUpload: () => ({ url: '/upload', token: 'scoped-secret' }),
    createMcpConnection: () => ({ office_project: { url: '/mcp' } }),
    materializeLegacyArtifacts: async (_, ids) => ids.map(name => ({ name })),
  });
  t.after(() => manager.close());
  await manager.registerWorker({ url: 'http://agent.test' });
  manager.registerWorker(worker('Legacy'), { connectionId: 'socket-1', send: payload => sent.push(payload) });
  assert.deepEqual(manager.listWorkers().map(w => w.protocol), ['a2a', 'websocket']);
  const a2a = manager.queue({ agent: 'Builder', task: 'native work' });
  const legacy = manager.queue({ agent: 'Legacy', task: 'socket work', projectId: 'project-1' });
  await until(() => sent.length && native.length);
  assert.equal(sent[0].type, 'task');
  assert.equal(sent[0].message.role, 'manager');
  assert.equal(sent[0].message.parts[0].text, 'Legacy: socket work');
  assert.equal(sent[0].artifactUpload.token, 'scoped-secret');
  assert.equal(sent[0].mcpServers.office_project.url, '/mcp');
  assert.equal(native[0].message.role, 'ROLE_USER');
  await manager.receiveUpdate('Legacy', { taskId: legacy.task.taskId, state: 'completed', uploadedArtifactIds: ['output.txt'] }, 'socket-1');
  assert.deepEqual((await legacy.completion).deliveredWork, [{ name: 'output.txt' }]);
  assert.equal((await a2a.completion).text, 'A2A done');
  const direct = manager.sendDirectMessage({ agent: 'Legacy', text: 'hello' });
  assert.equal(sent.at(-1).type, 'direct_message');
  manager.receiveDirectMessage('Legacy', { inReplyTo: direct.messageId, message: { parts: [{ kind: 'text', text: 'reply' }] } }, 'socket-1');
  assert.equal(manager.listDirectMessages().length, 0);
  const cancelled = manager.queue({ agent: 'Legacy', task: 'cancel me' });
  await until(() => sent.at(-1).type === 'task');
  await manager.cancelTask({ messageId: cancelled.task.messageId });
  assert.equal(sent.at(-1).type, 'task_cancel');
  assert.equal((await cancelled.completion).status, 'cancelled');
  assert.equal(saved.at(-1).workers.length, 1);
  assert.ok(saved.at(-1).tasks.every(task => task.agent === 'Builder'));
  manager.unregisterConnection('socket-1');
  assert.equal(manager.listWorkers().length, 1);
  assert.equal(manager.listRegisteredWorkers().find(w => w.name === 'Legacy').status, 'offline');
});

test('names cannot collide across integrations, including restored offline workers', async t => {
  const manager = new SubAgentManager({ clientFactory: async () => fakeClient() });
  t.after(() => manager.close());
  manager.restoreLegacyWorkers([worker('Legacy')]);
  await assert.rejects(manager.registerWorker({ url: 'http://agent.test', name: 'Legacy' }), /already uses/);
  await manager.registerWorker({ url: 'http://agent.test' });
  assert.throws(() => manager.registerWorker(worker('Builder'), { connectionId: 'other', send() {} }), /already uses/);
  manager.reset();
  assert.equal(manager.listRegisteredWorkers().length, 0);
});

test('worker-token endpoint rejects non-admin callers and invalid token names', async () => {
  let writes = 0;
  const handler = createSubAgentApiHandlers({ uiStateStore: { setWorkerToken() { writes++; } } })['/api/worker-token'];
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  for (const method of ['GET', 'POST']) {
    await handler({ method, user: { role: 'member' } }, res);
    assert.equal(res.status, 403);
  }
  const req = Readable.from(['{"name":""}']); req.method = 'POST'; req.user = { role: 'admin' };
  await handler(req, res);
  assert.equal(res.status, 400);
  assert.equal(writes, 0);
});
