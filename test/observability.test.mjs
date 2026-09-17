import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUiStateStore } from '../lib/ui-state.js';
import { createObservabilityApiHandlers } from '../api/observability.js';
import { normalizeObservabilityProvider, pushLoki, lokiPayload, createObservabilityExporter } from '../lib/observability.js';

const config = { type: 'loki', name: 'Production', url: 'https://logs.example.test', auth: 'basic', username: '123', secret: 'private-token', tenantId: 'office' };
const event = { category: 'model', source: 'Manager', message: 'Model completed', metadata: { projectId: 'alpha', token: 'hidden' }, createdAt: 1700000000000 };

test('Loki payload uses nanosecond strings, low-cardinality labels, JSON context and redaction', () => {
  const payload = lokiPayload([event, { ...event, createdAt: event.createdAt - 1 }]);
  assert.equal(payload.streams.length, 1);
  assert.deepEqual(payload.streams[0].stream, { app: 'agent-office', category: 'model', level: 'info' });
  assert.equal(payload.streams[0].values[0][0], '1699999999999000000');
  const parsed = JSON.parse(payload.streams[0].values[0][1]);
  assert.equal(parsed.metadata.projectId, 'alpha');
  assert.equal(parsed.metadata.token, '[redacted]');
});

test('Loki push authenticates, preserves proxy paths, refuses redirects and handles blocked ingestion', async () => {
  const provider = normalizeObservabilityProvider({ ...config, url: 'https://logs.example.test/proxy/' });
  assert.equal(provider.url, 'https://logs.example.test/proxy/loki/api/v1/push');
  assert.equal(normalizeObservabilityProvider({ ...config, url: provider.url }).url, provider.url);
  await pushLoki(provider, [event], { fetchImpl: async (url, options) => {
    assert.equal(url, provider.url);
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from('123:private-token').toString('base64')}`);
    assert.equal(options.headers['X-Scope-OrgID'], 'office');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['Content-Type'], 'application/json');
    return new Response(null, { status: 204 });
  } });
  await pushLoki({ ...provider, auth: 'bearer' }, [event], { fetchImpl: async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    return new Response(null, { status: 204 });
  } });
  for (const status of [401, 429, 500, 260]) await assert.rejects(pushLoki(provider, [event], { fetchImpl: async () => new Response('private-token', { status }) }), new RegExp(`HTTP ${status}`));
  await assert.rejects(pushLoki(provider, [event], { fetchImpl: async () => { throw new Error('private-token'); } }), error => !error.message.includes('private-token'));
  for (const url of ['file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com?token=secret']) assert.throws(() => normalizeObservabilityProvider({ ...config, url }));
});

test('observability APIs require admin, test real ingestion, hide credentials and manage providers', async () => {
  const store = createUiStateStore(':memory:');
  try {
    let pushes = 0;
    const routes = createObservabilityApiHandlers({ uiStateStore: store, observabilityFetch: async () => { pushes++; return new Response(null, { status: 204 }); } });
    const request = async (method, body, role = 'admin', suffix = '') => {
      const req = Readable.from(body ? [JSON.stringify(body)] : []); req.method = method; req.user = role ? { role } : null;
      const res = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
      const url = new URL(`http://office.test/api/observability${suffix}`);
      await routes[url.pathname](req, res, url); return res;
    };
    for (const role of [null, 'member']) for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) assert.equal((await request(method, config, role)).status, 403);
    assert.equal((await request('POST', config, 'member', '/test')).status, 403);
    assert.equal((await request('POST', config, 'admin', '/test')).status, 200);
    assert.equal(pushes, 1);
    assert.equal(store.getObservabilityProviders().length, 0);
    const added = await request('POST', config);
    assert.equal(added.status, 201);
    assert.ok(!JSON.stringify(added.body).includes('private-token'));
    const listed = await request('GET');
    assert.equal(listed.body.providers[0].hasSecret, true);
    assert.ok(!JSON.stringify(listed.body).includes('private-token'));
    const id = added.body.provider.id;
    await request('PATCH', { id, enabled: false });
    assert.equal(store.getObservabilityProviders()[0].enabled, false);
    await request('DELETE', { id });
    assert.equal(store.getObservabilityProviders().length, 0);
  } finally { store.close(); }
});

test('exporter resumes from durable cursor, retries failures, and respects pause and reset', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'office-observability-'));
  const file = path.join(directory, 'state.sqlite');
  let store = createUiStateStore(file);
  try {
    store.recordSystemActivity({ message: 'Before provider was added' });
    const provider = store.addObservabilityProvider(normalizeObservabilityProvider(config));
    store.recordSystemActivity({ ...event, createdAt: Date.now() });
    let time = 10000, requests = 0, fail = true;
    const exporter = createObservabilityExporter({ store, now: () => time, fetchImpl: async (_url, options) => {
      requests++;
      const payload = JSON.parse(options.body);
      assert.equal(payload.streams[0].values.length, 1);
      assert.equal(JSON.parse(payload.streams[0].values[0][1]).message, event.message);
      return new Response(null, { status: fail ? 503 : 204 });
    } });
    await exporter.flush();
    assert.equal(store.getObservabilityProviders()[0].cursor, provider.cursor);
    assert.match(store.getObservabilityProviders()[0].status.error, /503/);
    await exporter.flush(); assert.equal(requests, 1);
    time += 3000; fail = false;
    await exporter.flush(); assert.equal(requests, 2);
    assert.equal(store.getObservabilityProviders()[0].status.error, '');
    store.close(); store = createUiStateStore(file);
    let secondRequests = 0;
    const resumed = createObservabilityExporter({ store, fetchImpl: async () => { secondRequests++; return new Response(null, { status: 204 }); } });
    await resumed.flush(); assert.equal(secondRequests, 0);
    store.setObservabilityEnabled(provider.id, false);
    store.recordSystemActivity({ message: 'New message' });
    await resumed.flush(); assert.equal(secondRequests, 0);
    store.setObservabilityEnabled(provider.id, true);
    await resumed.flush(); assert.equal(secondRequests, 1);
    store.factoryReset(); assert.equal(store.getObservabilityProviders().length, 0);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
