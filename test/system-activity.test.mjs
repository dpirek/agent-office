import test from 'node:test';
import assert from 'node:assert/strict';
import { instrumentModelClient, sanitizeActivity } from '../lib/system-activity.js';
import { createUiStateStore } from '../lib/ui-state.js';

test('activity redacts nested credentials and bounds large payloads', () => {
  const safe = sanitizeActivity({ headers: { Authorization: 'Bearer secret', Cookie: 'session=secret' }, apiKey: 'secret', nested: { password: 'secret', text: 'Bearer secret https://example.test?token=secret' }, huge: 'x'.repeat(9000) });
  assert.ok(!JSON.stringify(safe).includes('secret'));
  assert.equal(safe.huge.length, 8000);
});

test('model telemetry records correlated results and errors without prompts', async () => {
  const entries = [];
  const response = { id: 'response', usage: { total_tokens: 5 }, output: [] };
  let failure = false;
  const client = instrumentModelClient({ async createResponse() { if (failure) throw new Error('Provider failed'); return response; } }, entry => entries.push(entry), { projectId: 'alpha', agent: 'Worker' });
  assert.equal(await client.createResponse({ model: 'test', input: [{ text: 'private prompt' }] }), response);
  assert.equal(entries[0].metadata.callId, entries[1].metadata.callId);
  assert.deepEqual(entries[1].metadata.usage, { total_tokens: 5 });
  assert.ok(!JSON.stringify(entries).includes('private prompt'));
  failure = true;
  await assert.rejects(client.createResponse({ model: 'test' }), /Provider failed/);
  assert.equal(entries.at(-1).tone, 'error');
  const resilient = instrumentModelClient({ createResponse: async () => response }, () => { throw new Error('Log storage unavailable'); }, {});
  assert.equal(await resilient.createResponse({ model: 'test' }), response);
});

test('chat activity retains message and project context and redacts credentials in storage', () => {
  const store = createUiStateStore(':memory:');
  try {
    const message = store.createOfficeChatMessage({ author: 'Human', kind: 'user', text: 'Hello office', projectId: 'central-office' });
    const entry = store.getSystemActivity().at(-1);
    assert.equal(entry.category, 'chat');
    assert.equal(entry.metadata.messageId, message.id);
    assert.equal(entry.metadata.projectId, 'central-office');
    store.recordSystemActivity({ source: 'Test', message: 'Request', metadata: { token: 'private' } });
    assert.equal(store.getSystemActivity().at(-1).metadata.token, '[redacted]');
  } finally { store.close(); }
});
