import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { SubAgentManager } from '../lib/sub-agents.js';
import { createUiStateStore } from '../lib/ui-state.js';
import { createSubAgentApiHandlers } from '../api/sub-agents.js';
import { fakeClient } from './helpers/a2a.mjs';

test('A2A registry and credentials persist privately across restart', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-registry-'));
  const filename = path.join(directory, 'state.sqlite'); let store = createUiStateStore(filename);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const manager = new SubAgentManager({ clientFactory: async () => fakeClient(), saveState: state => store.saveA2AState(state) });
  await manager.registerWorker({ url: 'http://agent.test', token: 'private-token' });
  store.close(); store = createUiStateStore(filename);
  const recovered = new SubAgentManager({ clientFactory: async () => fakeClient() }); await recovered.restore(store.getA2AState());
  assert.equal(recovered.listWorkers()[0].name, 'Builder');
  const handler = createSubAgentApiHandlers({ subAgentManager: recovered, uiStateStore: store })['/api/sub-agents'];
  const response = { writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  await handler({ method: 'GET' }, response);
  assert.equal(JSON.parse(response.body).transport, 'a2a'); assert.equal(response.body.includes('private-token'), false);
  const req = Readable.from([JSON.stringify({ url: 'http://agent.test' })]); req.method = 'POST'; req.user = { role: 'member' };
  await handler(req, response); assert.equal(response.status, 403);
});
