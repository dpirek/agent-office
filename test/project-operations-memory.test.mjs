import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createUiStateStore } from "../lib/ui-state.js";
import { createOperationsApiHandlers } from "../api/operations.js";
import { createMemoryApiHandlers } from "../api/memory.js";

const operation = { name: "Monitor", task: "Check health", agent: "auto", intervalValue: 1, intervalUnit: "hours", priority: "medium", enabled: true, nextRunAt: 1000 };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-project-history-"));
  const databasePath = path.join(root, "state.sqlite");
  const store = createUiStateStore(databasePath);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { store, databasePath };
}
async function call(handler, method, projectId, body = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify({ ...body, projectId }))]); req.method = method;
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  await handler(req, res, new URL(`http://office.test/api?projectId=${projectId}`));
  return res;
}

test("operations and memory APIs isolate project reads and operation mutations", async (t) => {
  const { store } = fixture(t);
  const a = store.createProject({ name: "Alpha" });
  const b = store.createProject({ name: "Beta" });
  const handler = createOperationsApiHandlers({ uiStateStore: store })["/api/operations"];
  const created = await call(handler, "POST", a.id, operation);
  assert.equal(created.status, 201);
  assert.equal(created.body.operation.projectId, a.id);
  assert.equal((await call(handler, "GET", b.id)).body.operations.length, 0);
  for (const method of ["PUT", "DELETE"]) {
    assert.equal((await call(handler, method, b.id, { ...operation, id: created.body.operation.id })).status, 400);
  }
  assert.equal(store.getPeriodicOperations({ projectId: a.id }).length, 1);
  store.recordOfficeMemory({ projectId: a.id, title: "Alpha outcome" });
  store.recordOfficeMemory({ projectId: b.id, title: "Beta outcome" });
  const memory = createMemoryApiHandlers({ uiStateStore: store })["/api/memory"];
  assert.deepEqual((await call(memory, "GET", a.id)).body.records.map((record) => record.title), ["Alpha outcome"]);
  assert.equal((await call(memory, "GET", "unknown")).status, 400);
  assert.equal((await call(handler, "DELETE", a.id, { id: created.body.operation.id })).status, 200);
});

test("legacy operations migrate to Central Office and memory is matched to task projects", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-history-migration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "state.sqlite");
  let store = createUiStateStore(file);
  const project = store.createProject({ name: "Alpha" });
  const task = store.createOfficeTask({ projectId: project.id, title: "Alpha task" });
  store.recordOfficeMemory({ title: "Old task outcome", sourceId: task.id });
  store.createPeriodicOperation(operation);
  store.close();
  const db = new DatabaseSync(file);
  for (const table of ["office_memory", "periodic_operations"]) {
    db.exec(`DROP TRIGGER ${table}_project_insert; DROP TRIGGER ${table}_project_update; DROP INDEX ${table}_project; ALTER TABLE ${table} DROP COLUMN project_id;`);
  }
  db.close();
  store = createUiStateStore(file);
  try {
    assert.equal(store.getPeriodicOperations()[0].projectId, "central-office");
    assert.equal(store.getOfficeMemory({ projectId: project.id })[0].title, "Old task outcome");
    assert.equal(store.getOfficeMemory({ projectId: "central-office" }).length, 0);
  } finally { store.close(); }
});
