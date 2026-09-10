import assert from "node:assert/strict";
import test from "node:test";
import { revealCreatedTask } from "../public/lib/task-state.mjs";

test("a newly created task is shown immediately without waiting for a dashboard refresh", () => {
  const existing = { id: "existing", title: "Existing task" };
  const created = { id: "created", title: "New task", status: "pending" };

  assert.deepEqual(revealCreatedTask([existing], created, "completed"), {
    officeTasks: [created, existing],
    taskFilter: "pending",
  });
});

test("revealing a task replaces a matching local copy and preserves a visible filter", () => {
  const stale = { id: "created", title: "Stale task" };
  const created = { id: "created", title: "New task", status: "pending" };

  assert.deepEqual(revealCreatedTask([stale], created, "all"), {
    officeTasks: [created],
    taskFilter: "all",
  });
});
