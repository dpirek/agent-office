import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PeriodicOperationScheduler } from "../lib/operations.js";
import { createUiStateStore } from "../lib/ui-state.js";

test("periodic operations persist and can be updated", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-operations-"));
  const store = createUiStateStore(path.join(directory, "state.sqlite"));
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const created = store.createPeriodicOperation({
    name: "Status report",
    task: "Summarize current work",
    agent: "auto",
    intervalValue: 2,
    intervalUnit: "hours",
    priority: "medium",
    enabled: true,
    nextRunAt: 123_456,
  });
  assert.equal(store.getPeriodicOperations()[0].name, "Status report");
  const updated = store.updatePeriodicOperation(created.id, { ...created, enabled: false, nextRunAt: null });
  assert.equal(updated.enabled, false);
  store.deletePeriodicOperation(created.id);
  assert.equal(store.getPeriodicOperations().length, 0);
});

test("scheduler dispatches a due operation through automatic assignment", async () => {
  const runUpdates = [];
  const resultUpdates = [];
  const memory = [];
  const queued = [];
  const operation = {
    id: "operation-1",
    name: "Monitor",
    task: "Check service health",
    agent: "auto",
    intervalValue: 5,
    intervalUnit: "minutes",
    priority: "high",
    enabled: true,
    nextRunAt: 900,
  };
  const uiStateStore = {
    getPeriodicOperations: () => [operation],
    recordPeriodicOperationRun: (id, value) => runUpdates.push({ id, ...value }),
    recordPeriodicOperationResult: (id, value) => resultUpdates.push({ id, ...value }),
    recordOfficeMemory: (value) => memory.push(value),
  };
  const subAgentManager = {
    listWorkers: () => [{ name: "busy" }, { name: "idle" }],
    listTasks: () => [{ agent: "busy", state: "working" }],
    queue: (value) => { queued.push(value); return { completion: Promise.resolve({ ok: true }) }; },
  };
  const scheduler = new PeriodicOperationScheduler({ uiStateStore, subAgentManager, now: () => 1_000 });
  await scheduler.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queued[0].agent, "idle");
  assert.equal(runUpdates[0].nextRunAt, 301_000);
  assert.equal(resultUpdates[0].status, "completed");
  assert.equal(memory[0].kind, "operation");
  assert.equal(memory[0].status, "completed");
});
