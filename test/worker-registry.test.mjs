import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSubAgentApiHandlers } from "../api/sub-agents.js";
import { SubAgentManager } from "../lib/sub-agents.js";
import { createUiStateStore } from "../lib/ui-state.js";

function responseRecorder() {
  return {
    status: null,
    body: "",
    writeHead(status) { this.status = status; },
    end(body = "") { this.body = body; },
  };
}

test("registered workers persist with their token name after disconnect and restart", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-worker-registry-"));
  const databasePath = path.join(directory, "state.sqlite");
  let store = createUiStateStore(databasePath);
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  store.setWorkerToken("a".repeat(32), "Build team token");

  const manager = new SubAgentManager({
    onWorkerRegistered: (worker) => store.upsertRegisteredWorker(worker),
    onWorkerDisconnected: (worker) => store.markRegisteredWorkerOffline(worker.name),
  });
  manager.registerWorker({
    name: "Builder",
    description: "Builds software",
    url: "ws://127.0.0.1:8099/workers",
    tokenName: store.getWorkerTokenName(),
    capabilities: { skills: [{ id: "code", name: "Coding", description: "Writes code" }], tools: ["read_file"], workspaceArtifacts: true },
    model: { provider: "openrouter", name: "openai/gpt-5.6-sol", url: "https://openrouter.ai/api/v1" },
  }, { connectionId: "connection-1", send() {} });

  assert.equal(store.getRegisteredWorkers()[0].status, "connected");
  assert.equal(store.getRegisteredWorkers()[0].tokenName, "Build team token");
  // Simulate a process stopping before its socket close callback can run.
  store.close();
  store = createUiStateStore(databasePath);
  const handler = createSubAgentApiHandlers({
    uiStateStore: store,
    subAgentManager: { listWorkers: () => [], listTasks: () => [] },
  })["/api/sub-agents"];
  const response = responseRecorder();
  handler({ method: "GET" }, response);
  const body = JSON.parse(response.body);
  assert.equal(body.workers.length, 1);
  assert.equal(body.workers[0].name, "Builder");
  assert.equal(body.workers[0].status, "offline");
  assert.equal(body.workers[0].tokenName, "Build team token");
});
