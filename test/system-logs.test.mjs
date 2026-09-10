import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createSystemLogApiHandlers } from "../api/system-logs.js";
import { createUiStateStore } from "../lib/ui-state.js";

function responseRecorder() {
  return {
    status: null,
    body: "",
    writeHead(status) { this.status = status; },
    end(body = "") { this.body = body; },
  };
}

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
