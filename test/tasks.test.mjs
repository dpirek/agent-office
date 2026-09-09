import assert from "node:assert/strict";
import test from "node:test";
import { selectAutoAssignedWorker } from "../lib/task-assignment.js";
import { normalizeSubAgentWorkers, SubAgentManager } from "../lib/sub-agents.js";

test("websocket registration normalizes worker capabilities", () => {
  const [worker] = normalizeSubAgentWorkers([{
      name: "Dave the Developer",
      description: "Completes coding tasks in its configured workspace.",
      url: "ws://0.0.0.0:8099/worker",
      capabilities: {
        skills: [{ id: "coding-task", name: "Coding Task", description: "Inspect and modify a workspace." }],
        tools: ["list_files", "write_file"],
        mcp: false,
        workspaceArtifacts: true,
      },
      model: { provider: "openrouter", name: "openai/gpt-5.6-sol", url: "https://openrouter.ai/api/v1" },
  }]);
  assert.equal(worker.name, "Dave the Developer");
  assert.equal(worker.url, "ws://127.0.0.1:8099/worker");
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
  const assignments = [];
  const sent = [];
  const materialized = [];
  const manager = new SubAgentManager({
    onTaskAssigned: (task) => assignments.push(task),
    onTaskEvent: (event, task) => taskEvents.push({ event, task }),
    materializeArtifacts: async (task, work) => {
      materialized.push({ task, work });
      return work.map((artifact) => ({
        ...artifact,
        uri: "/api/shared-workspace-file?path=Check-release--task-1%2Fworker-task-1.zip",
        workspacePath: "Check-release--task-1/worker-task-1.zip",
      }));
    },
  });
  manager.registerWorker({ name: "alpha", url: "ws://127.0.0.1:9999/worker" }, {
    connectionId: "connection-1",
    send: (message) => sent.push(message),
  });
  const queued = manager.queue({ agent: "alpha", task: "Check the release", priority: "high", timeoutMs: 1_000 });
  queued.completion.catch(() => {});
  assert.equal(queued.task.agent, "alpha");
  assert.equal(queued.task.title, "Check the release");
  assert.equal(queued.task.priority, "high");
  assert.equal(assignments[0].messageId, queued.task.messageId);
  assert.equal(sent[0].type, "task");
  assert.equal(sent[0].message.parts[0].text, "Check the release");
  assert.equal(manager.listTasks().length, 1);
  assert.equal(manager.listTasks()[0].state, "working");
  assert.throws(() => manager.receiveUpdate("alpha", {
    type: "task_update", taskId: sent[0].taskId, status: { state: "working" },
  }, "different-connection"), /Unknown task update/);
  manager.receiveUpdate("alpha", {
    type: "task_update",
    taskId: sent[0].taskId,
    inReplyTo: queued.task.messageId,
    status: { state: "working" },
    message: { parts: [{ kind: "text", text: "Running tests." }] },
  }, "connection-1");
  const update = await manager.receiveUpdate("alpha", {
    type: "task_update",
    taskId: sent[0].taskId,
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
  }, "connection-1");
  assert.equal(update.state, "completed");
  assert.equal(taskEvents.length, 2);
  assert.equal(taskEvents[0].event, "working");
  assert.equal(taskEvents[1].event, "completed");
  assert.equal(taskEvents[1].task.deliveredWork[0].name, "worker-task-1.zip");
  assert.equal(materialized[0].task.title, "Check the release");
  assert.equal(materialized[0].work[0].uri, "https://worker.example.com/workspace/worker-task-1.zip");
  const result = await queued.completion;
  assert.equal(result.text, "Work complete.");
  assert.deepEqual(result.deliveredWork[0], {
    artifactId: "workspace-worker-task-1",
    artifactName: "worker-task-1.zip",
    name: "worker-task-1.zip",
    mimeType: "application/zip",
    uri: "/api/shared-workspace-file?path=Check-release--task-1%2Fworker-task-1.zip",
    workspacePath: "Check-release--task-1/worker-task-1.zip",
    metadata: { fileCount: 3, size: 12_480 },
  });
  assert.match(manager.listTasks()[0].deliveredWork[0].uri, /^\/api\/shared-workspace-file/);
  manager.unregisterConnection("connection-1");
  assert.equal(manager.listWorkers().length, 0);
});
