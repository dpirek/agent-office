import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAuthService } from '../api/auth.js';
import { createApiRouter } from '../api/index.js';
import { createSharedWorkspace } from '../lib/shared-workspace.js';
import { createUiStateStore } from '../lib/ui-state.js';

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

  const workspace = createSharedWorkspace({ root, fetchImpl: request, getWorkerToken: () => store.getWorkerToken(), getOfficeOrigins: () => ['http://127.0.0.1:8005'] });
  calls.length = 0;
  const files = await workspace.storeTaskArtifacts({ projectId: project.id, workerUrl: 'ws://127.0.0.1:9000' }, [{ name: 'copy.md', uri }]);
  assert.equal(files[0].workspacePath, `${project.id}/copy.md`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 200);
  assert.equal(calls[0].authorization, `Bearer ${key}`);
  assert.equal(await fs.readFile(path.join(root, project.id, 'copy.md'), 'utf8'), 'Project contract');
  await assert.rejects(workspace.storeTaskArtifacts({ projectId: other.id }, [{ name: 'copy.md', uri }]), /different project/);
  assert.equal(calls.length, 1);
  store.setWorkerToken('b'.repeat(32));
  assert.equal((await request(uri, authorized)).status, 401);
  assert.equal((await request(uri, { headers: { Authorization: `Bearer ${'b'.repeat(32)}` } })).status, 200);
  user = { id: 'member', role: 'member', projectIds: [project.id] };
  assert.equal((await request(uri)).status, 200);
  const forbidden = new URL(uri); forbidden.searchParams.set('projectId', other.id); forbidden.searchParams.set('path', 'private.txt');
  assert.equal((await request(forbidden.href)).status, 403);
  assert.equal((await request('/api/workspace-file-asset?path=legacy.txt')).status, 403);
});

test('office download credentials are limited to its asset endpoint and never follow redirects', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-file-redirect-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  const workspace = createSharedWorkspace({ root, getWorkerToken: () => 'private-key', getOfficeOrigins: () => ['http://office.test'], fetchImpl: async (uri, options) => {
    calls.push({ uri, ...options });
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: 'http://other.test/api/workspace-file-asset' } });
    return new Response('File');
  } });
  await workspace.storeTaskArtifacts({}, [{ name: 'file.txt', uri: 'http://office.test/api/workspace-file-asset?path=file.txt' }]);
  assert.equal(calls[0].headers.Authorization, 'Bearer private-key');
  assert.equal(calls[1].headers, undefined);
  await workspace.storeTaskArtifacts({}, [{ name: 'file.txt', uri: 'http://office.test/api/config' }]);
  assert.equal(calls[2].headers, undefined);
});
