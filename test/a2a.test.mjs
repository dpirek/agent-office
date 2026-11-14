import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { A2AClient } from '../lib/a2a-client.js';
import { SubAgentManager } from '../lib/sub-agents.js';
import { storeA2AArtifacts } from '../lib/a2a-artifacts.js';
import { createSharedWorkspace } from '../lib/shared-workspace.js';
import { agentServer, task, message, until, card } from './helpers/a2a.mjs';

for (const binding of ['JSONRPC', 'HTTP+JSON']) {
  test(`${binding}: discovery, version, native message response, credentials and tenant`, async t => {
    const agent = await agentServer(t, { binding, token: 'secret', tenant: 'my tenant' });
    const manager = new SubAgentManager(); t.after(() => manager.close());
    const worker = await manager.registerWorker({ url: agent.url, token: 'secret' });
    assert.equal(worker.protocolVersion, '1.0'); assert.equal(JSON.stringify(worker).includes('secret'), false);
    const queued = manager.queue({ agent: 'Builder', task: 'Hello' });
    const result = await queued.completion;
    assert.equal(result.text, 'Done'); assert.equal(result.status, 'completed');
    const sent = agent.calls[0].params;
    assert.equal(sent.message.role, 'ROLE_USER'); assert.deepEqual(sent.message.parts, [{ text: 'Hello' }]);
    assert.equal(sent.message.taskId, undefined); assert.equal(sent.message.contextId, undefined);
    assert.equal(sent.artifactUpload, undefined); assert.equal(sent.mcpServers, undefined);
    if (binding === 'HTTP+JSON') assert.equal(agent.calls[0].url, '/agent/my%20tenant/message:send');
    else assert.equal(sent.tenant, 'my tenant');
  });
  test(`${binding}: streaming status and chunked artifacts are materialized`, async t => {
    const artifacts = [];
    const agent = await agentServer(t, { binding, streaming: true, respond: () => ({ events: [
      { task: task('SUBMITTED') },
      { statusUpdate: { taskId: 'remote-task', contextId: 'context-1', status: { state: 'TASK_STATE_WORKING', message: message('Building') } } },
      { artifactUpdate: { taskId: 'remote-task', contextId: 'context-1', artifact: { artifactId: 'a', name: 'report.txt', parts: [{ text: 'first ' }] }, append: false } },
      { artifactUpdate: { taskId: 'remote-task', contextId: 'context-1', artifact: { artifactId: 'a', parts: [{ text: 'second' }] }, append: true, lastChunk: true } },
      { statusUpdate: { taskId: 'remote-task', contextId: 'context-1', status: { state: 'TASK_STATE_COMPLETED', message: message('Finished') } } },
    ] }) });
    const manager = new SubAgentManager({ materializeArtifacts: async (_, result) => { artifacts.push(...result); return [{ name: 'report.txt' }]; } }); t.after(() => manager.close());
    await manager.registerWorker({ url: agent.url });
    const result = await manager.delegate({ agent: 'Builder', task: 'Build' });
    assert.equal(result.ok, true); assert.equal(result.taskId, 'remote-task'); assert.equal(result.text, 'Finished');
    assert.equal(artifacts[0].parts.map(part => part.text).join(''), 'first second');
    assert.equal(agent.calls[0].method, 'SendStreamingMessage');
  });
  test(`${binding}: polling and input-required continuation preserve server IDs`, async t => {
    let submissions = 0;
    const agent = await agentServer(t, { binding, respond: (method, params) => {
      if (method === 'SendMessage') {
        submissions++;
        if (submissions === 1) return { task: task('INPUT_REQUIRED', 'Which color?') };
        assert.equal(params.message.taskId, 'remote-task'); assert.equal(params.message.contextId, 'context-1');
        assert.equal(params.message.parts[0].text, 'Blue'); return { task: task('WORKING') };
      }
      return task('COMPLETED', 'Blue it is');
    } });
    const manager = new SubAgentManager({ pollIntervalMs: 5 }); t.after(() => manager.close());
    await manager.registerWorker({ url: agent.url });
    const queued = manager.queue({ agent: 'Builder', task: 'Build' });
    await until(() => manager.listTasks()[0]?.state === 'input_required');
    await manager.continueTask({ messageId: queued.task.messageId, text: 'Blue' });
    assert.equal((await queued.completion).text, 'Blue it is');
    assert.equal(agent.calls.filter(call => call.method === 'GetTask').length, 1);
    assert.notEqual(agent.calls[0].params.message.messageId, agent.calls[1].params.message.messageId);
  });
  test(`${binding}: cancellation errors never claim the remote task stopped`, async t => {
    let allowCancel = false;
    const agent = await agentServer(t, { binding, respond: method => {
      if (method === 'CancelTask') return allowCancel ? task('CANCELED') : { error: { code: -32002, message: 'Cannot cancel yet' }, ...(binding === 'HTTP+JSON' ? { httpStatus: 400 } : {}) };
      return method === 'SendMessage' ? { task: task() } : task();
    } });
    const manager = new SubAgentManager({ pollIntervalMs: 5 }); t.after(() => manager.close()); await manager.registerWorker({ url: agent.url });
    const queued = manager.queue({ agent: 'Builder', task: 'Long task' });
    await until(() => manager.listTasks()[0]?.remoteTaskId);
    await assert.rejects(manager.cancelTask({ messageId: queued.task.messageId }), /Cannot cancel/);
    assert.equal(manager.listTasks()[0].state, 'working');
    allowCancel = true; await manager.cancelTask({ messageId: queued.task.messageId });
    assert.equal((await queued.completion).status, 'cancelled');
    await assert.rejects(manager.cancelTask({ taskId: 'missing' }), /Unknown/);
  });
}

test('an interrupted stream recovers by GetTask without replaying the submission', async t => {
  const agent = await agentServer(t, { streaming: true, respond: method => method === 'SendStreamingMessage' ? { events: [{ task: task() }], truncated: true } : task('COMPLETED', 'Recovered') });
  const manager = new SubAgentManager({ pollIntervalMs: 5 }); t.after(() => manager.close()); await manager.registerWorker({ url: agent.url });
  const result = await manager.delegate({ agent: 'Builder', task: 'Do once' });
  assert.equal(result.text, 'Recovered'); assert.deepEqual(agent.calls.map(call => call.method), ['SendStreamingMessage', 'GetTask']);
});
test('restart restores remote task tracking without sending another message', async t => {
  let state; let complete = false;
  const agent = await agentServer(t, { respond: method => method === 'SendMessage' ? { task: task() } : task(complete ? 'COMPLETED' : 'WORKING', complete ? 'Recovered' : '') });
  const first = new SubAgentManager({ saveState: snapshot => { state = structuredClone(snapshot); }, pollIntervalMs: 5 });
  await first.registerWorker({ url: agent.url }); first.queue({ agent: 'Builder', task: 'Build', officeTaskId: 'office-task' });
  await until(() => state.tasks[0]?.remoteTaskId); first.close(); complete = true;
  const settled = [];
  const second = new SubAgentManager({ onTaskSettled: (result, assignment) => settled.push({ result, assignment }), pollIntervalMs: 5 }); t.after(() => second.close());
  await second.restore(state); await until(() => settled.length);
  assert.equal(settled[0].result.text, 'Recovered'); assert.equal(settled[0].assignment.officeTaskId, 'office-task');
  assert.equal(agent.calls.filter(call => call.method === 'SendMessage').length, 1);
});
test('native text, data and base64 artifacts are imported atomically', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-a2a-artifacts-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = createSharedWorkspace({ root });
  const artifacts = [
    { artifactId: 'text', name: 'answer.txt', parts: [{ text: 'hello ' }, { text: 'world' }] },
    { artifactId: 'data', name: 'result.json', parts: [{ data: { ok: true } }] },
    { artifactId: 'file', parts: [{ raw: Buffer.from('binary').toString('base64'), filename: 'file.bin', mediaType: 'application/octet-stream' }] },
  ];
  const files = await storeA2AArtifacts(workspace, { projectId: 'alpha' }, artifacts, {});
  assert.equal(files.length, 3);
  assert.equal(await fs.readFile(path.join(root, 'alpha/answer.txt'), 'utf8'), 'hello world');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'alpha/result.json'), 'utf8')), { ok: true });
  assert.equal(await fs.readFile(path.join(root, 'alpha/file.bin'), 'utf8'), 'binary');
});
test('cards reject legacy versions, unsupported required extensions and credential forwarding', () => {
  const value = card('https://agent.test'); value.supportedInterfaces[0].protocolVersion = '0.3';
  assert.throws(() => new A2AClient({ url: 'https://agent.test' }, value), /v1.0/);
  value.supportedInterfaces[0].protocolVersion = '1.0'; value.capabilities.extensions = [{ uri: 'unknown', required: true }];
  assert.throws(() => new A2AClient({ url: 'https://agent.test' }, value), /extension/);
  delete value.capabilities.extensions;
  assert.throws(() => new A2AClient({ url: 'https://other.test', token: 'secret' }, value), /credentials/);
});

test('all standard terminal and interrupted states are represented without false completion', async t => {
  const { fakeClient } = await import('./helpers/a2a.mjs');
  for (const [remote, local] of [['FAILED', 'failed'], ['REJECTED', 'rejected'], ['AUTH_REQUIRED', 'auth_required']]) {
    const manager = new SubAgentManager({ clientFactory: async () => fakeClient({ response: { task: task(remote, 'Details') } }) }); t.after(() => manager.close());
    await manager.registerWorker({ url: 'http://agent.test' }); const queued = manager.queue({ agent: 'Builder', task: 'Hello' });
    await until(() => manager.listTasks()[0].state === local);
    if (remote !== 'AUTH_REQUIRED') assert.equal((await queued.completion).ok, false);
    else assert.equal(manager.listTasks()[0].finishedAt, undefined);
  }
});
test('cancelling during async preparation prevents submission', async t => {
  const { fakeClient } = await import('./helpers/a2a.mjs'); let release; const sent = [];
  const manager = new SubAgentManager({ clientFactory: async () => fakeClient({ sent }), prepareTask: () => new Promise(resolve => { release = resolve; }) }); t.after(() => manager.close());
  await manager.registerWorker({ url: 'http://agent.test' }); const queued = manager.queue({ agent: 'Builder', task: 'Build' });
  await until(() => release); await manager.cancelTask({ messageId: queued.task.messageId }); release('Prepared');
  assert.equal((await queued.completion).status, 'cancelled'); await new Promise(resolve => setImmediate(resolve)); assert.equal(sent.length, 0);
});
test('task identity mismatches are rejected and never attributed to another task', async t => {
  const { fakeClient } = await import('./helpers/a2a.mjs');
  const manager = new SubAgentManager({ clientFactory: async () => fakeClient({ response: { task: task('INPUT_REQUIRED') } }) }); t.after(() => manager.close());
  await manager.registerWorker({ url: 'http://agent.test' }); const queued = manager.queue({ agent: 'Builder', task: 'Build' });
  await until(() => manager.listTasks()[0].remoteTaskId);
  const record = manager.find({ messageId: queued.task.messageId });
  await assert.rejects(manager.consume(record, { task: task('COMPLETED', '', { id: 'other-task' }) }), /mismatched/);
  assert.equal(record.state, 'input_required');
});
test('project inputs are standard parts with project isolation and no symlink traversal', async t => {
  const { prepareWorkerParts } = await import('../lib/worker-task-context.js');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-inputs-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'alpha')); await fs.mkdir(path.join(root, 'beta'));
  await fs.writeFile(path.join(root, 'alpha/input.txt'), 'Visible'); await fs.writeFile(path.join(root, 'beta/secret.txt'), 'Private');
  await fs.symlink(path.join(root, 'beta/secret.txt'), path.join(root, 'alpha/link'));
  const parts = await prepareWorkerParts({ sharedWorkspaceRoot: root }, { projectId: 'alpha' }, ['text/plain']);
  assert.deepEqual(parts, [{ text: '# Input file: input.txt\nVisible' }]);
  await fs.writeFile(path.join(root, 'alpha/binary.bin'), Buffer.from([0, 255]));
  await assert.rejects(prepareWorkerParts({ sharedWorkspaceRoot: root }, { projectId: 'alpha' }, ['text/plain']), /binary input/);
  const binary = await prepareWorkerParts({ sharedWorkspaceRoot: root }, { projectId: 'alpha' }, ['application/octet-stream']);
  assert.equal(binary[0].raw, 'AP8=');
});
test('URL artifacts retain same-origin credentials but cannot fetch cross-origin private services', async t => {
  const http = await import('node:http');
  let authorization;
  const server = http.createServer((req, res) => { authorization = req.headers.authorization; res.end('Artifact content'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const client = new A2AClient({ url: origin, token: 'artifact-secret' }, card(origin));
  assert.equal((await client.download(origin + '/file')).toString(), 'Artifact content');
  assert.equal(authorization, 'Bearer artifact-secret');
  await assert.rejects(client.download('http://127.0.0.1:1/private'), /private networks/);
});

test('Office task API exposes interrupted state and resumes the actual assignment', async t => {
  const { createUiStateStore } = await import('../lib/ui-state.js');
  const { createTaskApiHandlers } = await import('../api/tasks.js');
  const { Readable } = await import('node:stream');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'office-a2a-api-'));
  const store = createUiStateStore(path.join(directory, 'state.sqlite'));
  t.after(async () => { store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  let count = 0;
  const agent = await agentServer(t, { respond: () => ({ task: task(++count === 1 ? 'INPUT_REQUIRED' : 'COMPLETED', count === 1 ? 'Which color?' : 'Done') }) });
  const manager = new SubAgentManager(); t.after(() => manager.close()); await manager.registerWorker({ url: agent.url });
  const handler = createTaskApiHandlers({ subAgentManager: manager, uiStateStore: store })['/api/tasks'];
  const call = async (method, body) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []); req.method = method;
    const res = { writeHead(status) { this.status = status; }, end(value) { this.value = JSON.parse(value); } };
    await handler(req, res, new URL('http://office.test/api/tasks?projectId=central-office'));
    assert.ok(res.status < 400, JSON.stringify(res.value)); return res.value;
  };
  const { task: created } = await call('POST', { title: 'Build' });
  await call('PUT', { id: created.id, agent: 'Builder' });
  await until(() => manager.listTasks()[0]?.state === 'input_required');
  const listed = await call('GET');
  assert.equal(listed.tasks[0].a2aState, 'input_required'); assert.equal(listed.tasks[0].agentMessage, 'Which color?');
  await call('PUT', { id: created.id, action: 'continue', text: 'Blue' });
  await until(() => store.getOfficeTasks()[0].status === 'completed');
  assert.equal(store.getOfficeTasks()[0].workerTaskId, 'remote-task');
});

test('SSE accepts all standard line endings and split UTF-8 characters', async () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    const client = new A2AClient({ url: 'https://agent.test' }, card('https://agent.test', 'HTTP+JSON', true), { fetchImpl: async () => {
      const bytes = Buffer.from(`data: ${JSON.stringify({ message: message('✓ finished') })}${ending}${ending}`);
      return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
    } });
    const events = []; for await (const event of client.sendMessageStream({ message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'Test' }] } })) events.push(event);
    assert.equal(events[0].message.parts[0].text, '✓ finished');
  }
});
