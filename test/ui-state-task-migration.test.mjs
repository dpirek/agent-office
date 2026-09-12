import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createUiStateStore } from "../lib/ui-state.js";

test("existing task databases migrate to support cancelled tasks", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-task-migration-"));
  const databasePath = path.join(directory, "state.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE office_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'timed_out')),
      agent TEXT, message_id TEXT, worker_task_id TEXT, result TEXT, error TEXT,
      depends_on TEXT NOT NULL DEFAULT '[]', artifacts TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
    ) STRICT;
    CREATE INDEX office_tasks_created_at ON office_tasks(created_at DESC);
    INSERT INTO office_tasks
      (id, title, priority, status, agent, message_id, depends_on, artifacts, created_at, updated_at, started_at)
    VALUES ('legacy-task', 'Legacy work', 'medium', 'running', 'Builder', 'legacy-message', '[]', '[]', 1, 1, 1);
  `);
  legacy.close();

  const store = createUiStateStore(databasePath);
  context.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const cancelled = store.completeOfficeTask("legacy-task", { status: "cancelled", error: "Stopped." });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.title, "Legacy work");
  assert.equal(cancelled.projectId, "central-office");
  assert.equal(store.requireProject("central-office").name, "Central Office");
});
