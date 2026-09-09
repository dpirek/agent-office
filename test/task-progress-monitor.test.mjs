import assert from "node:assert/strict";
import test from "node:test";
import { SubAgentManager } from "../lib/sub-agents.js";
import {
  DEFAULT_TASK_PROGRESS_CHECK_INTERVAL_MS,
  TaskProgressMonitor,
  resolveTaskProgressCheckInterval,
} from "../lib/task-progress-monitor.js";

test("progress monitor asks overdue workers and routes their status for manager review", () => {
  let now = 6_001;
  const task = {
    id: "office-task-1",
    title: "Build the website",
    agent: "Builder",
    status: "running",
    createdAt: 1_000,
    startedAt: 1_000,
    messageId: "office-message-1",
  };
  const sent = [];
  const checks = [];
  const statuses = [];
  let monitor;
  const manager = new SubAgentManager({
    onDirectMessage: (state, message) => monitor.handleDirectMessage(state, message),
  });
  manager.registerWorker({ name: "Builder", url: "ws://127.0.0.1:9996/worker" }, {
    connectionId: "progress-connection",
    send: (message) => sent.push(message),
  });
  const store = {
    getOfficeTasks: ({ status } = {}) => !status || task.status === status ? [task] : [],
  };
  monitor = new TaskProgressMonitor({
    uiStateStore: store,
    subAgentManager: manager,
    intervalMs: 5_000,
    now: () => now,
    onCheck: (check) => checks.push(check),
    onStatus: (status) => statuses.push(status),
  });

  monitor.tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "direct_message");
  assert.match(sent[0].message.parts[0].text, /progress completed so far, current blockers, the next step, and estimated time remaining/i);
  assert.equal(checks[0].task.id, task.id);
  const directMessageId = sent[0].message.messageId;
  manager.receiveDirectMessage("Builder", {
    type: "direct_message_response",
    inReplyTo: directMessageId,
    message: { parts: [{ kind: "text", text: "Research is integrated. CSS remains; ETA 10 minutes." }] },
  }, "progress-connection");
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].task.id, task.id);
  assert.match(statuses[0].message.text, /ETA 10 minutes/);

  now = 10_000;
  monitor.tick();
  assert.equal(sent.length, 1, "the task is not checked again before the configured interval");
  now = 11_002;
  monitor.tick();
  assert.equal(sent.length, 2, "a still-running task is checked again after the interval");
  task.status = "completed";
  manager.receiveDirectMessage("Builder", {
    type: "direct_message_response",
    inReplyTo: sent[1].message.messageId,
    message: { parts: [{ kind: "text", text: "Already completed." }] },
  }, "progress-connection");
  assert.equal(statuses.length, 1, "stale status replies do not trigger a review after task completion");
  manager.unregisterConnection("progress-connection");
});

test("progress-check interval is configurable and validated", () => {
  assert.equal(resolveTaskProgressCheckInterval({}), DEFAULT_TASK_PROGRESS_CHECK_INTERVAL_MS);
  assert.equal(resolveTaskProgressCheckInterval({ AI_HARNESS_TASK_PROGRESS_CHECK_INTERVAL_MS: "60000" }), 60_000);
  assert.throws(
    () => resolveTaskProgressCheckInterval({ AI_HARNESS_TASK_PROGRESS_CHECK_INTERVAL_MS: "9999" }),
    /must be an integer between/,
  );
  assert.throws(
    () => resolveTaskProgressCheckInterval({ AI_HARNESS_TASK_PROGRESS_CHECK_INTERVAL_MS: "often" }),
    /must be an integer between/,
  );
});
