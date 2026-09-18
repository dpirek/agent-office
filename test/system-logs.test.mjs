import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createSystemLogApiHandlers, discardDisabledLogPost } from "../api/system-logs.js";
import { createUiStateStore } from "../lib/ui-state.js";

function responseRecorder() {
  return {
    status: null,
    body: "",
    writeHead(status) { this.status = status; },
    end(body = "") { this.body = body; },
  };
}

test('disabled log POSTs are discarded before auth without storing activity', () => {
  const store = createUiStateStore(':memory:');
  try {
    const url = new URL('http://localhost/api/system-logs');
    const discard = () => {
      let drained = false;
      const res = responseRecorder();
      const handled = discardDisabledLogPost({ method: 'POST', resume() { drained = true; } }, res, url, store);
      return { handled, drained, status: res.status, body: res.body };
    };
    const ignored = { handled: true, drained: true, status: 204, body: '' };
    assert.deepEqual(discard(), ignored);
    const provider = store.addObservabilityProvider({ type: 'loki', name: 'Logs', url: 'https://logs.example.test', enabled: false });
    assert.deepEqual(discard(), ignored);
    store.setObservabilityEnabled(provider.id, true);
    assert.deepEqual(discard(), { handled: false, drained: false, status: null, body: '' });
    store.deleteObservabilityProvider(provider.id);
    assert.deepEqual(discard(), ignored);
    assert.deepEqual(store.getSystemActivity(), []);
    for (const [method, path] of [['GET', '/api/system-logs'], ['POST', '/api/tasks']]) {
      assert.equal(discardDisabledLogPost({ method }, responseRecorder(), new URL(path, url), store), false);
    }
  } finally { store.close(); }
});

test("system activity is persisted and exposed in chronological order", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-system-logs-"));
  const store = createUiStateStore(path.join(directory, "state.sqlite"));
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  store.recordSystemActivity({
    id: "worker-connect", category: "agent", source: "Builder",
    message: "Worker connected", tone: "success", createdAt: 100,
  });

  const handler = createSystemLogApiHandlers({ uiStateStore: store })["/api/system-logs"];
  const postRequest = Readable.from([Buffer.from(JSON.stringify({
    category: "network", source: "HTTP", message: "POST /api/tasks → 201", tone: "tool",
  }))]);
  postRequest.method = "POST";
  const postResponse = responseRecorder();
  await handler(postRequest, postResponse, new URL("http://localhost/api/system-logs"));
  assert.equal(postResponse.status, 201);

  const getResponse = responseRecorder();
  await handler({ method: "GET" }, getResponse, new URL("http://localhost/api/system-logs?limit=10"));
  const logs = JSON.parse(getResponse.body).logs;
  assert.equal(logs.length, 2);
  assert.deepEqual(logs.map((entry) => entry.message), ["Worker connected", "POST /api/tasks → 201"]);
  assert.equal(logs[0].source, "Builder");
  assert.equal(logs[1].category, "network");
});

test('browser log forwarding is enabled only while an enabled provider exists', async () => {
  const store = createUiStateStore(':memory:');
  try {
    const handler = createSystemLogApiHandlers({ uiStateStore: store })['/api/system-logs'];
    const enabled = async () => {
      const response = responseRecorder();
      await handler({ method: 'GET' }, response, new URL('http://localhost/api/system-logs'));
      return JSON.parse(response.body).forwardingEnabled;
    };
    assert.equal(await enabled(), false);
    const provider = store.addObservabilityProvider({ type: 'loki', name: 'Logs', url: 'https://logs.example.test/loki/api/v1/push', enabled: true });
    assert.equal(await enabled(), true);
    store.setObservabilityEnabled(provider.id, false);
    assert.equal(await enabled(), false);
    store.setObservabilityEnabled(provider.id, true);
    assert.equal(await enabled(), true);
    store.deleteObservabilityProvider(provider.id);
    assert.equal(await enabled(), false);
  } finally { store.close(); }
});

test('live logging switch suppresses activity storage, ingestion, and forwarding even with a provider', async () => {
  const store = createUiStateStore(':memory:', { liveLoggingEnabled: false });
  try {
    assert.equal(store.liveLoggingEnabled, false);
    store.addObservabilityProvider({ type: 'loki', name: 'Logs', url: 'https://logs.example.test/loki/api/v1/push', enabled: true });
    assert.equal(store.recordSystemActivity({ category: 'network', message: 'HTTP/socket event' }), null);
    assert.deepEqual(store.getSystemActivity(), []);
    let drained = 0;
    const request = { method: 'POST', resume() { drained++; } };
    const url = new URL('http://localhost/api/system-logs');
    assert.equal(discardDisabledLogPost(request, responseRecorder(), url, store), true);
    const handler = createSystemLogApiHandlers({ uiStateStore: store })['/api/system-logs'];
    const posted = responseRecorder();
    await handler(request, posted, url);
    assert.equal(posted.status, 204);
    assert.equal(drained, 2);
    const fetched = responseRecorder();
    await handler({ method: 'GET' }, fetched, url);
    assert.deepEqual(JSON.parse(fetched.body), { ok: true, logs: [], liveLoggingEnabled: false, forwardingEnabled: false });
  } finally { store.close(); }
});

test('live logging environment option defaults on and validates boolean values', async () => {
  const { liveLoggingEnabled } = await import('../lib/env-config.js');
  assert.equal(liveLoggingEnabled({}), true);
  for (const value of ['false', '0', 'off', 'no']) assert.equal(liveLoggingEnabled({ AI_HARNESS_LIVE_LOGGING: value }), false);
  for (const value of ['true', '1', 'on', 'yes']) assert.equal(liveLoggingEnabled({ AI_HARNESS_LIVE_LOGGING: value }), true);
  assert.throws(() => liveLoggingEnabled({ AI_HARNESS_LIVE_LOGGING: 'typo' }), /must be true or false/);
});
