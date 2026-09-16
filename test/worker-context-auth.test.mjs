import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createAuthService } from '../api/auth.js';
import { createApiRouter } from '../api/index.js';
import { createOfficeChatService } from '../lib/office-chat.js';

function setup() {
  let token = 'worker-secret';
  const task = { id: 'task-one', projectId: 'central-office', title: 'Prior work', status: 'completed', result: 'Completed successfully' };
  const message = { id: 'message-one', author: 'Human', kind: 'user', text: 'Prior discussion', projectId: 'central-office', createdAt: 1 };
  const state = {
    getWorkerToken: () => token,
    requireProject: id => ({ id, name: id }),
    getOfficeTasks: () => [task],
    getOfficeChatMessages: () => [message],
    getOfficeMemory: () => [{ id: 'memory-one', title: 'Prior work', summary: 'Completed successfully', details: { result: task.result } }],
  };
  const userStore = { session: () => null };
  const subAgentManager = { listWorkers: () => [], listTasks: () => [] };
  const auth = createAuthService({ userStore, getWorkerToken: state.getWorkerToken });
  const router = createApiRouter({ uiStateStore: state, userStore, subAgentManager, officeChatService: createOfficeChatService({ uiStateStore: state, subAgentManager }), workerArtifactStore: { authorize() { throw new Error('No active task credential'); } } });
  const request = async (url, { method = 'GET', authorization = 'Bearer worker-secret', body } = {}) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    req.method = method; req.headers = { authorization, 'content-type': 'application/json' };
    const result = {};
    const res = { setHeader() {}, writeHead(status) { result.status = status; }, end(value) { result.body = value ? JSON.parse(value) : null; } };
    const parsed = new URL(url, 'http://office.test');
    if (!await auth.handle(req, res, parsed)) await router(req, res, parsed);
    return result;
  };
  return { request, rotate: value => { token = value; } };
}

test('worker token reads prior memory, full task details and chat without a browser session', async () => {
  const { request } = setup();
  const memory = await request('/api/memory?kind=task&status=completed&limit=20');
  assert.equal(memory.status, 200);
  assert.equal(memory.body.records[0].details.result, 'Completed successfully');
  const tasks = await request('/api/tasks');
  assert.equal(tasks.status, 200);
  assert.equal(tasks.body.tasks[0].result, 'Completed successfully');
  const chat = await request('/api/chat?limit=20');
  assert.equal(chat.status, 200);
  assert.equal(chat.body.messages[0].text, 'Prior discussion');
});

test('worker token only authorizes context reads; missing, invalid and rotated credentials fail', async () => {
  const { request, rotate } = setup();
  for (const authorization of ['', 'Bearer wrong', 'Basic worker-secret']) {
    assert.equal((await request('/api/tasks', { authorization })).status, 401);
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    for (const route of ['/api/tasks', '/api/chat', '/api/memory']) assert.equal((await request(route, { method, body: {} })).status, 401);
  }
  for (const route of ['/api/users', '/api/worker-token', '/api/config', '/api/projects']) assert.equal((await request(route)).status, 401);
  rotate('new-secret');
  assert.equal((await request('/api/chat')).status, 401);
  assert.equal((await request('/api/chat', { authorization: 'Bearer new-secret' })).status, 200);
  rotate('');
  assert.equal((await request('/api/chat', { authorization: '' })).status, 401);
});

test('project MCP accepts worker token without a browser session or active task credential', async () => {
  const { request, rotate } = setup();
  const options = { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'project_conversation_summary', arguments: {} } } };
  const response = await request('/mcp/projects/central-office/tasks/task-one', options);
  assert.equal(response.status, 200);
  assert.equal(response.body.result.structuredContent.latestUserRequests[0].text, 'Prior discussion');
  rotate('replacement');
  assert.equal((await request('/mcp/projects/central-office/tasks/task-one', options)).status, 401);
});
