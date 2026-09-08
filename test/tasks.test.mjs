import assert from "node:assert/strict";
import test from "node:test";
import { selectAutoAssignedWorker } from "../lib/task-assignment.js";
import { discoverSubAgentWorker, SubAgentManager } from "../lib/sub-agents.js";

test("worker discovery loads and normalizes /api/info metadata", async () => {
  const worker = await discoverSubAgentWorker("http://127.0.0.1:8099/a2a", async (url) => {
    assert.equal(url, "http://127.0.0.1:8099/api/info");
    return new Response(JSON.stringify({
      name: "Dave the Developer",
      description: "Completes coding tasks in its configured workspace.",
      url: "http://0.0.0.0:8099/a2a",
      capabilities: {
        skills: [{ id: "coding-task", name: "Coding Task", description: "Inspect and modify a workspace." }],
        tools: ["list_files", "write_file"],
        mcp: false,
        workspaceArtifacts: true,
      },
      model: { provider: "openrouter", name: "openai/gpt-5.6-sol", url: "https://openrouter.ai/api/v1" },
    }), { status: 200 });
  });
  assert.equal(worker.name, "Dave the Developer");
  assert.equal(worker.url, "http://127.0.0.1:8099/a2a");
  assert.equal(worker.capabilities.workspaceArtifacts, true);
  assert.deepEqual(worker.capabilities.tools, ["list_files", "write_file"]);
  assert.equal(worker.model.name, "openai/gpt-5.6-sol");
});

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
  const taskEvents = [];
  const manager = new SubAgentManager({
    workers: [{ name: "alpha", url: "http://127.0.0.1:9999" }],
    callbackUrl: "http://127.0.0.1:8010/api/sub-agents/callback",
    fetchImpl: async () => new Response(JSON.stringify({ taskId: "worker-task-1" }), {
      status: 202,
      headers: { "content-type": "application/json" },
    }),
    onTaskEvent: (event, task) => taskEvents.push({ event, task }),
  });
  const queued = manager.queue({ agent: "alpha", task: "Check the release", priority: "high", timeoutMs: 1_000 });
  queued.completion.catch(() => {});
  assert.equal(queued.task.agent, "alpha");
  assert.equal(queued.task.title, "Check the release");
  assert.equal(queued.task.priority, "high");
  assert.equal(manager.listTasks().length, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.listTasks()[0].state, "working");
  const token = [...manager.pending.keys()][0];
  const callback = manager.receiveCallback(`Bearer ${token}`, {
    taskId: "worker-task-1",
    inReplyTo: queued.task.messageId,
    status: { state: "completed" },
    message: {
      messageId: "result-worker-task-1",
      role: "agent",
      parts: [{ kind: "text", mimeType: "text/markdown", text: "Work complete." }],
    },
    artifacts: [{
      artifactId: "workspace-worker-task-1",
      name: "worker-task-1.zip",
      parts: [{
        kind: "file",
        file: {
          name: "worker-task-1.zip",
          mimeType: "application/zip",
          uri: "https://worker.example.com/workspace/worker-task-1.zip",
        },
      }],
      metadata: { fileCount: 3, size: 12_480 },
    }],
  });
  assert.equal(callback.status, 200);
  assert.equal(taskEvents.length, 1);
  assert.equal(taskEvents[0].event, "completed");
  assert.equal(taskEvents[0].task.deliveredWork[0].name, "worker-task-1.zip");
  assert.equal(callback.status, 200);
  const result = await queued.completion;
  assert.equal(result.text, "Work complete.");
  assert.deepEqual(result.deliveredWork[0], {
    artifactId: "workspace-worker-task-1",
    artifactName: "worker-task-1.zip",
    name: "worker-task-1.zip",
    mimeType: "application/zip",
    uri: "https://worker.example.com/workspace/worker-task-1.zip",
    metadata: { fileCount: 3, size: 12_480 },
  });
  assert.equal(manager.listTasks()[0].deliveredWork[0].uri, "https://worker.example.com/workspace/worker-task-1.zip");
});
