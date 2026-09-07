import assert from "node:assert/strict";
import test from "node:test";
import { selectAutoAssignedWorker } from "../api/tasks.js";
import { SubAgentManager } from "../lib/sub-agents.js";

test("auto assignment chooses the lightest active workload", () => {
  const workers = [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }];
  const tasks = [
    { agent: "alpha", state: "working" },
    { agent: "alpha", state: "completed" },
    { agent: "beta", state: "completed" },
  ];
  assert.equal(selectAutoAssignedWorker(workers, tasks).name, "gamma");
});

test("queue returns a visible task receipt before the worker completes", async () => {
  const manager = new SubAgentManager({
    workers: [{ name: "alpha", url: "http://127.0.0.1:9999" }],
    callbackUrl: "http://127.0.0.1:8010/api/sub-agents/callback",
    fetchImpl: async () => new Response(JSON.stringify({ taskId: "worker-task-1" }), {
      status: 202,
      headers: { "content-type": "application/json" },
    }),
  });
  const queued = manager.queue({ agent: "alpha", task: "Check the release", priority: "high", timeoutMs: 1_000 });
  queued.completion.catch(() => {});
  assert.equal(queued.task.agent, "alpha");
  assert.equal(queued.task.title, "Check the release");
  assert.equal(queued.task.priority, "high");
  assert.equal(manager.listTasks().length, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.listTasks()[0].state, "working");
});
