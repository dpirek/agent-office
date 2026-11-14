import assert from "node:assert/strict";
import test from "node:test";
import { selectAutoAssignedWorker } from "../lib/task-assignment.js";

test("auto assignment chooses the lightest active workload", () => {
  const workers = [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }];
  const tasks = [
    { agent: "alpha", state: "working" },
    { agent: "alpha", state: "completed" },
    { agent: "beta", state: "completed" },
  ];
  assert.equal(selectAutoAssignedWorker(workers, tasks).name, "gamma");
});
