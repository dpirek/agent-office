import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOfficeSearch, searchOfficeData } from '../public/lib/office-search.mjs';
import Router from '../public/lib/router.mjs';

const fixtures = {
  tasks: { tasks: [{ id: 'a', title: 'Prepare release', description: 'Publish alpha docs', projectId: 'alpha', status: 'pending' }, { id: 'b', title: 'Private release', projectId: 'beta' }] },
  files: { tree: [{ type: 'directory', children: [{ type: 'file', name: 'release notes.md', path: 'alpha/docs/release notes.md' }] }] },
  agents: { workers: [{ name: 'Release Agent', description: 'Publishes documentation', capabilities: { tools: ['git'] } }] },
  operations: { operations: [{ id: 'op', name: 'Release check', task: 'Check docs', projectId: 'alpha', enabled: true }] },
  skills: { skills: [{ id: 'skill', name: 'Publishing', content: 'Review the release notes' }] },
};
test('search finds real records across types without mixing task projects', () => {
  const results = searchOfficeData('release', fixtures, 'alpha');
  assert.equal(results.length, 5);
  assert.equal(results.some(result => result.id === 'b'), false);
  assert.equal(results.find(result => result.type === 'Files').href, '/files/alpha/docs/release%20notes.md');
  assert.equal(results.find(result => result.type === 'Tasks').href, '/alpha/tasks');
  assert.equal(searchOfficeData('PREPARE docs', fixtures, 'alpha')[0].id, 'a');
  assert.deepEqual(searchOfficeData('   ', fixtures), []);
  assert.deepEqual(searchOfficeData('absent', fixtures), []);
});
test('search reports unavailable sources while retaining available matches', async () => {
  const urls = [];
  const { data, unavailable } = await loadOfficeSearch('alpha', { fetchImpl: async url => {
    urls.push(url);
    if (url.startsWith('/api/tasks')) return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ workers: fixtures.agents.workers }) };
  } });
  assert.deepEqual(unavailable, ['tasks']);
  assert.equal(searchOfficeData('release', data, 'alpha').length, 1);
  assert.ok(urls.includes('/api/shared-workspace?projectId=alpha'));
});
test('cancelled searches never return stale results', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadOfficeSearch('alpha', { signal: controller.signal, fetchImpl: async () => { throw new DOMException('Aborted', 'AbortError'); } }), { name: 'AbortError' });
});
test('router preserves query strings and records changes on the same search path', t => {
  const previous = globalThis.window;
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const history = [];
  globalThis.window = { location: { pathname: '/dashboard', search: '', hash: '' }, history: { pushState(_state, _title, value) {
    history.push(value); const url = new URL(value, 'http://office.test'); Object.assign(window.location, { pathname: url.pathname, search: url.search, hash: url.hash });
  } }, dispatchEvent() {} };
  const router = new Router(); let count = 0;
  router.addRoute('/search', () => count++);
  router.navigate('/search?q=release&project=alpha');
  router.navigate('/search?q=docs&project=alpha');
  assert.deepEqual(history, ['/search?q=release&project=alpha', '/search?q=docs&project=alpha']);
  assert.equal(count, 2);
});
