import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createUiStateStore } from '../lib/ui-state.js';
import { createApiRouter } from '../api/index.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-project-clear-'));
  const store = createUiStateStore(path.join(root, 'state.sqlite'));
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const workspace = path.join(root, 'workspace');
  const alpha = store.createProject({ name: 'Alpha', ownerId: 'owner' });
  const beta = store.createProject({ name: 'Beta' });
  for (const project of [alpha, beta]) {
    store.createOfficeChatMessage({ projectId: project.id, author: 'Human', username: 'human', kind: 'user', text: 'Hello' });
    store.createOfficeTask({ projectId: project.id, title: 'Task' });
    store.recordOfficeMemory({ projectId: project.id, title: 'Memory' });
    store.createPeriodicOperation({ projectId: project.id, name: 'Monitor', task: 'Check', agent: 'auto', intervalValue: 1, intervalUnit: 'hours', priority: 'medium', enabled: true, nextRunAt: 1000 });
    store.setMcpConfig('{}', project.id);
    await fs.mkdir(path.join(workspace, project.id, 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspace, project.id, 'docs/keep.txt'), project.name);
  }
  const active = { manager: false, workers: [], messages: [] };
  const router = createApiRouter({ uiStateStore: store, sharedWorkspaceRoot: workspace,
    isProjectManagerBusy: id => id === alpha.id && active.manager,
    subAgentManager: { listTasks: () => active.workers, listDirectMessages: () => active.messages },
  });
  const call = async (section, { projectId = alpha.id, user = { id: 'admin', role: 'admin' }, method = 'POST' } = {}) => {
    const req = Readable.from([Buffer.from(JSON.stringify({ projectId, section }))]);
    req.method = method; req.user = user;
    const res = { writeHead(status) { this.status = status; }, end(body) { this.body = body ? JSON.parse(body) : null; } };
    await router(req, res, new URL('http://office.test/api/projects/clear'));
    return res;
  };
  async function counts(projectId) {
    return { chats: store.getOfficeChatMessages({ projectId }).length, tasks: store.getOfficeTasks({ projectId }).length,
      operations: store.getPeriodicOperations({ projectId }).length, memory: store.getOfficeMemory({ projectId }).length,
      workspace: (await fs.readdir(path.join(workspace, projectId))).length };
  }
  return { root, workspace, store, alpha, beta, active, call, counts };
}

for (const section of ['chats', 'tasks', 'workspace', 'operations', 'memory']) {
  test(`clear ${section} affects only that section of the selected project`, async t => {
    const { store, alpha, beta, call, counts } = await fixture(t);
    const before = await counts(alpha.id);
    assert.equal((await call(section)).status, 200);
    assert.deepEqual(await counts(alpha.id), { ...before, [section]: 0 });
    assert.deepEqual(await counts(beta.id), before);
    assert.equal(store.requireProject(alpha.id).name, 'Alpha');
    assert.equal(store.getMcpConfig(alpha.id), '{}');
    assert.equal((await call(section)).body.removed, 0);
  });
}

test('project clear requires owner or administrator and a valid explicit project and section', async t => {
  const { alpha, call, counts } = await fixture(t);
  const before = await counts(alpha.id);
  assert.equal((await call('chats', { user: { id: 'member', role: 'member', projectIds: [alpha.id] } })).status, 403);
  assert.equal((await call('chats', { user: { id: 'owner', role: 'member', projectIds: [] } })).status, 403);
  assert.equal((await call('chats', { user: null })).status, 403);
  assert.equal((await call('chats', { method: 'GET' })).status, 405);
  for (const projectId of ['', 'unknown', '../escape']) assert.equal((await call('chats', { projectId })).status, 400);
  assert.equal((await call('everything')).status, 400);
  assert.deepEqual(await counts(alpha.id), before);
  assert.equal((await call('chats', { user: { id: 'owner', role: 'member', projectIds: [alpha.id] } })).status, 200);
});

test('clear rejects active project work but allows work in other projects', async t => {
  const { active, alpha, beta, call, counts, store } = await fixture(t);
  const before = await counts(alpha.id);
  active.manager = true;
  assert.equal((await call('workspace')).status, 409);
  active.manager = false;
  active.workers = [{ projectId: alpha.id, state: 'working' }];
  assert.equal((await call('tasks')).status, 409);
  active.workers = [];
  active.messages = [{ projectId: alpha.id }];
  assert.equal((await call('chats')).status, 409);
  active.messages = [];
  const task = store.getOfficeTasks({ projectId: alpha.id })[0];
  store.assignOfficeTask(task.id, { agent: 'Worker', messageId: 'message' });
  assert.equal((await call('memory')).status, 409);
  assert.deepEqual(await counts(alpha.id), before);
  store.completeOfficeTask(task.id, { status: 'completed' });
  active.workers = [{ projectId: beta.id, state: 'working' }];
  assert.equal((await call('memory')).status, 200);
});

test('workspace clearing unlinks child symlinks and rejects a symlinked project root', async t => {
  const { workspace, alpha, beta, call } = await fixture(t);
  const other = path.join(workspace, beta.id);
  await fs.symlink(other, path.join(workspace, alpha.id, 'linked'));
  assert.equal((await call('workspace')).status, 200);
  assert.equal(await fs.readFile(path.join(other, 'docs/keep.txt'), 'utf8'), 'Beta');
  await fs.rmdir(path.join(workspace, alpha.id));
  await fs.symlink(other, path.join(workspace, alpha.id));
  assert.equal((await call('workspace')).status, 400);
  assert.equal(await fs.readFile(path.join(other, 'docs/keep.txt'), 'utf8'), 'Beta');
});
