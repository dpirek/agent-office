import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createAuthService } from '../api/auth.js';
import { createApiRouter } from '../api/index.js';
import { createUiStateStore } from '../lib/ui-state.js';

test('advertised project file URLs accept worker keys through the real HTTP routes and legacy redirects', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-advertised-file-'));
  const store = createUiStateStore(':memory:');
  const project = store.createProject({ name: 'Delivery' });
  await fs.mkdir(path.join(root, project.id, 'designs'), { recursive: true });
  await fs.writeFile(path.join(root, project.id, 'designs', 'puppy-love.gif'), 'GIF89a-test');
  store.setWorkerToken('k'.repeat(32));
  const auth = createAuthService({ userStore: { session: () => null }, getWorkerToken: () => store.getWorkerToken() });
  const router = createApiRouter({ sharedWorkspaceRoot: root, uiStateStore: store });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://office.test');
    if (!await auth.handle(req, res, url)) await router(req, res, url);
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const uri = `${origin}/files/${project.id}/designs/puppy-love.gif`;
  const legacy = `${origin}/api/shared-workspace-file?path=${project.id}/designs/puppy-love.gif`;
  const headers = { Authorization: `Bearer ${store.getWorkerToken()}` };
  for (const url of [uri, legacy]) {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal(await (await fetch(url, { headers })).text(), 'GIF89a-test');
    assert.equal((await fetch(url, { headers, method: 'HEAD' })).status, 200);
    assert.equal((await fetch(url, { headers, method: 'POST' })).status, 401);
  }
  store.setWorkerToken('r'.repeat(32));
  assert.equal((await fetch(uri, { headers })).status, 401);
  assert.equal((await fetch(uri, { headers: { Authorization: `Bearer ${store.getWorkerToken()}` } })).status, 200);
});

test('project file download accepts the worker key through auth and routing and stays within the project', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-worker-download-'));
  const store = createUiStateStore(':memory:');
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = store.createProject({ name: 'Alpha' });
  const other = store.createProject({ name: 'Beta' });
  await fs.mkdir(path.join(root, project.id, 'docs'), { recursive: true });
  await fs.mkdir(path.join(root, other.id), { recursive: true });
  await fs.writeFile(path.join(root, project.id, 'docs', 'contract.md'), 'Project contract');
  await fs.writeFile(path.join(root, other.id, 'private.txt'), 'Other project');
  await fs.writeFile(path.join(root, 'legacy.txt'), 'Legacy file');
  const key = 'a'.repeat(32);
  store.setWorkerToken(key);
  let user = null;
  const userStore = { session: () => user };
  const auth = createAuthService({ userStore, getWorkerToken: () => store.getWorkerToken() });
  const router = createApiRouter({ uiStateStore: store, userStore, sharedWorkspaceRoot: root, resolveWorkspace: async workspace => {
    assert.equal(workspace, '.'); return fs.realpath(root);
  } });
  const calls = [];
  const request = async (uri, options = {}) => {
    const url = new URL(uri, 'http://127.0.0.1:8005');
    const req = { method: options.method || 'GET', headers: { authorization: options.headers?.Authorization || '' } };
    let status, headers = {}, body;
    const res = {
      setHeader(name, value) { headers[name] = value; },
      writeHead(value, extra) { status = value; Object.assign(headers, extra); },
      end(value) { body = value; },
    };
    if (!await auth.handle(req, res, url)) await router(req, res, url);
    calls.push({ status, uri: url.href, authorization: req.headers.authorization });
    return new Response(body, { status, headers });
  };
  const uri = `http://127.0.0.1:8005/api/workspace-file-asset?projectId=${project.id}&path=docs/contract.md`;
  const authorized = { headers: { Authorization: `Bearer ${key}` } };
  assert.equal((await request(uri)).status, 401);
  assert.equal((await request(uri, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal(await (await request(uri, authorized)).text(), 'Project contract');
  const escape = new URL(uri); escape.searchParams.set('path', `../${other.id}/private.txt`);
  assert.equal((await request(escape.href, authorized)).status, 400);
  const unknown = new URL(uri); unknown.searchParams.set('projectId', 'unknown');
  assert.equal((await request(unknown.href, authorized)).status, 400);
  assert.equal(await (await request('/api/workspace-file-asset?path=legacy.txt', authorized)).text(), 'Legacy file');
  assert.equal((await request(uri, { ...authorized, method: 'PUT' })).status, 401);

  store.setWorkerToken('b'.repeat(32));
  assert.equal((await request(uri, authorized)).status, 401);
  assert.equal((await request(uri, { headers: { Authorization: `Bearer ${'b'.repeat(32)}` } })).status, 200);
  user = { id: 'member', role: 'member', projectIds: [project.id] };
  assert.equal((await request(uri)).status, 200);
  const forbidden = new URL(uri); forbidden.searchParams.set('projectId', other.id); forbidden.searchParams.set('path', 'private.txt');
  assert.equal((await request(forbidden.href)).status, 403);
  assert.equal((await request('/api/workspace-file-asset?path=legacy.txt')).status, 403);
});
