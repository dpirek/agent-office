import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createSubAgentApiHandlers } from "../api/sub-agents.js";
import { createUiStateStore } from "../lib/ui-state.js";

function responseRecorder() {
  return {
    status: null,
    body: "",
    writeHead(status) { this.status = status; },
    end(body = "") { this.body = body; },
  };
}

test("worker tokens are generated, persisted, and only revealed once", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-worker-token-"));
  const store = createUiStateStore(path.join(directory, "state.sqlite"));
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const handler = createSubAgentApiHandlers({
    uiStateStore: store,
    subAgentManager: { listWorkers: () => [], listTasks: () => [] },
  })["/api/worker-token"];

  const generatedResponse = responseRecorder();
  const generatedRequest = Readable.from([Buffer.from(JSON.stringify({ name: "Production workers" }))]);
  generatedRequest.method = "POST";
  await handler(generatedRequest, generatedResponse);
  const generated = JSON.parse(generatedResponse.body);
  assert.equal(generatedResponse.status, 201);
  assert.match(generated.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(generated.name, "Production workers");
  assert.equal(store.getWorkerToken(), generated.token);
  assert.equal(store.getWorkerTokenName(), "Production workers");

  const statusResponse = responseRecorder();
  await handler({ method: "GET" }, statusResponse);
  const status = JSON.parse(statusResponse.body);
  assert.deepEqual(status, { ok: true, configured: true, name: "Production workers" });
  assert.equal(Object.hasOwn(status, "token"), false);
});
