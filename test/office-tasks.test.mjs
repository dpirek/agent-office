import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assignOfficeTask, buildDependentTaskPrompt, cancelOfficeTask, createOfficeTask, deleteOfficeTask } from "../lib/office-tasks.js";
import { SubAgentManager } from "../lib/sub-agents.js";
import { createUiStateStore } from "../lib/ui-state.js";
import { createOfficeTasksTool } from "../lib/tools/office-tasks.js";

test("office tasks stay unassigned until the manager explicitly assigns them", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-tasks-"));
  const store = createUiStateStore(path.join(directory, "state.sqlite"));
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  let dispatchCount = 0;
  let finishTask;
  const completion = new Promise((resolve) => { finishTask = resolve; });
  const subAgentManager = {
    listWorkers: () => [{ name: "Dave", url: "http://127.0.0.1:8099/a2a" }],
    queue({ agent, task, title, priority }) {
      dispatchCount += 1;
      assert.deepEqual({ agent, task, title, priority }, {
        agent: "Dave",
        task: "Prepare the release notes",
        title: "Prepare the release notes",
        priority: "high",
      });
      return { task: { messageId: "message-1" }, completion };
    },
  };
  const tool = createOfficeTasksTool({ uiStateStore: store, subAgentManager });

  const created = await tool.execute({
    action: "create",
    title: "Prepare the release notes",
    priority: "high",
  });
  assert.equal(created.ok, true);
  assert.equal(created.task.status, "pending");
  assert.equal(created.task.agent, null);
  assert.equal(dispatchCount, 0, "creating a task must not dispatch it");

  const queue = await tool.execute({ action: "read" });
  assert.equal(queue.tasks[0].id, created.task.id);
  assert.equal(queue.tasks[0].agent, null);
  assert.equal(queue.workers[0].name, "Dave");

  const assigned = await tool.execute({
    action: "assign",
    task_id: created.task.id,
    agent: "Dave",
  });
  assert.equal(assigned.ok, true);
  assert.equal(assigned.task.status, "running");
  assert.equal(assigned.task.agent, "Dave");
  assert.equal(dispatchCount, 1);

  finishTask({
    ok: true,
    taskId: "worker-task-1",
    text: "Release notes are ready.",
    deliveredWork: [{ name: "release-notes.zip", uri: "https://worker.example/release-notes.zip" }],
  });
  await new Promise((resolve) => setImmediate(resolve));
  const completed = store.getOfficeTasks()[0];
  assert.equal(completed.status, "completed");
  assert.equal(completed.result, "Release notes are ready.");
  assert.equal(completed.deliveredWork[0].name, "release-notes.zip");
});

test("dependent tasks dispatch sequentially across manager review turns", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-sequence-"));
  const store = createUiStateStore(path.join(directory, "state.sqlite"));
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  const completions = [];
  const dispatched = [];
  const subAgentManager = {
    listWorkers: () => [{ name: "Researcher" }, { name: "Designer" }],
    queue({ agent, task, title }) {
      dispatched.push({ agent, task, title });
      let finish;
      const completion = new Promise((resolve) => { finish = resolve; });
      completions.push(finish);
      return { task: { messageId: `message-${dispatched.length}` }, completion };
    },
  };

  const firstReview = createOfficeTasksTool({ uiStateStore: store, subAgentManager });
  const research = (await firstReview.execute({
    action: "create",
    title: "Research site data",
  })).task;
  const design = (await firstReview.execute({
    action: "create",
    title: "Design the UI",
    depends_on: [research.id],
  })).task;
  const independent = (await firstReview.execute({
    action: "create",
    title: "Prepare a project summary",
  })).task;

  const blocked = await firstReview.execute({ action: "assign", task_id: design.id, agent: "Designer" });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /waiting for dependencies/i);

  const assignedResearch = await firstReview.execute({ action: "assign", task_id: research.id, agent: "Researcher" });
  assert.equal(assignedResearch.ok, true);
  const sameReviewAssignment = await firstReview.execute({ action: "assign", task_id: independent.id, agent: "Designer" });
  assert.equal(sameReviewAssignment.ok, false);
  assert.match(sameReviewAssignment.error, /one task may be assigned/i);
  assert.deepEqual(dispatched, [{ agent: "Researcher", task: "Research site data", title: "Research site data" }]);

  completions[0]({
    ok: true,
    taskId: "research-result",
    text: "Use the Acme market dataset and lead with conversion rate.",
    deliveredWork: [{
      name: "research.md",
      uri: "/api/shared-workspace-file?path=research%2Fresearch.md",
      workspacePath: "research/research.md",
    }],
  });
  await new Promise((resolve) => setImmediate(resolve));

  const nextReview = createOfficeTasksTool({ uiStateStore: store, subAgentManager });
  const assignedDesign = await nextReview.execute({ action: "assign", task_id: design.id, agent: "Designer" });
  assert.equal(assignedDesign.ok, true);
  assert.equal(dispatched[1].agent, "Designer");
  assert.equal(dispatched[1].title, "Design the UI");
  assert.match(dispatched[1].task, /# Prerequisite work/);
  assert.match(dispatched[1].task, /Research site data/);
  assert.match(dispatched[1].task, /Use the Acme market dataset and lead with conversion rate\./);
  assert.match(dispatched[1].task, /research\/research\.md/);
  assert.match(dispatched[1].task, /# Current task\nDesign the UI/);
  assert.match(dispatched[1].task, /do not redo or ignore it/);
});

test("a running office task can be stopped and late worker updates are ignored", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-cancel-"));
  const store = createUiStateStore(path.join(directory, "state.sqlite"));
  const sent = [];
  const manager = new SubAgentManager();
  manager.registerWorker({ name: "Builder", url: "ws://127.0.0.1:9997/worker" }, {
    connectionId: "cancel-connection",
    send: (message) => sent.push(message),
  });
  context.after(() => {
    manager.unregisterConnection("cancel-connection");
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const created = createOfficeTask(store, { title: "Build the website" });
  const running = assignOfficeTask(store, manager, { id: created.id, agent: "Builder" });
  assert.equal(running.status, "running");
  const stopped = cancelOfficeTask(store, manager, { id: created.id, reason: "Requirements changed." });
  assert.equal(stopped.status, "cancelled");
  assert.equal(stopped.error, "Requirements changed.");
  assert.equal(sent[1].type, "task_cancel");
  assert.equal(sent[1].taskId, sent[0].taskId);
  assert.equal(sent[1].inReplyTo, sent[0].message.messageId);
  const alreadyStopped = manager.cancelTask({ messageId: running.messageId });
  assert.equal(alreadyStopped.alreadyStopped, true);
  assert.equal(alreadyStopped.state, "cancelled");
  assert.equal(sent.length, 2, "idempotent cancellation does not send another command");

  const lateUpdate = await manager.receiveUpdate("Builder", {
    type: "task_update",
    taskId: sent[0].taskId,
    inReplyTo: sent[0].message.messageId,
    status: { state: "completed" },
    message: { parts: [{ kind: "text", text: "Late result" }] },
  }, "cancel-connection");
  assert.equal(lateUpdate.state, "cancelled");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getOfficeTasks()[0].status, "cancelled");
  assert.equal(cancelOfficeTask(store, manager, { id: created.id }).status, "cancelled");
  const missingWorkerTask = manager.cancelTask({ messageId: "already-removed" });
  assert.equal(missingWorkerTask.state, "cancelled");
  assert.equal(missingWorkerTask.recordMissing, true);
});

test("stopping a stale running task succeeds when the worker already stopped", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-stale-cancel-"));
  const store = createUiStateStore(path.join(directory, "state.sqlite"));
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const completion = new Promise(() => {});
  const manager = {
    listWorkers: () => [{ name: "Builder" }],
    queue: () => ({ task: { messageId: "stale-message" }, completion }),
    cancelTask: () => { throw new Error("Unknown worker task."); },
  };
  const created = createOfficeTask(store, { title: "Stale work" });
  assignOfficeTask(store, manager, { id: created.id, agent: "Builder" });

  const stopped = cancelOfficeTask(store, manager, { id: created.id });
  assert.equal(stopped.status, "cancelled");
  assert.match(stopped.error, /stopped by the office manager/i);
});

test("a stop request cannot overwrite work that completed concurrently", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-cancel-race-"));
  const store = createUiStateStore(path.join(directory, "state.sqlite"));
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const created = createOfficeTask(store, { title: "Fast work" });
  store.assignOfficeTask(created.id, { agent: "Builder", messageId: "fast-message" });
  store.completeOfficeTask(created.id, { status: "completed", result: "Finished first." });

  const result = store.cancelOfficeTask(created.id, { error: "Stop requested." });
  assert.equal(result.status, "completed");
  assert.equal(result.result, "Finished first.");
});

test("tasks can be deleted after dependents and running work is protected", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-delete-"));
  const store = createUiStateStore(path.join(directory, "state.sqlite"));
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const parent = createOfficeTask(store, { title: "Research" });
  const child = createOfficeTask(store, { title: "Build", dependsOn: [parent.id] });

  assert.throws(() => deleteOfficeTask(store, { id: parent.id }), /Delete dependent tasks first/);
  assert.equal(deleteOfficeTask(store, { id: child.id }).id, child.id);
  assert.equal(deleteOfficeTask(store, { id: parent.id }).id, parent.id);
  assert.deepEqual(store.getOfficeTasks(), []);

  const running = createOfficeTask(store, { title: "Deploy" });
  store.assignOfficeTask(running.id, { agent: "Builder", messageId: "running-message" });
  assert.throws(() => deleteOfficeTask(store, { id: running.id }), /Stop the running task/);
});

test("manager descriptions persist and are included in worker instructions", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-description-"));
  const databasePath = path.join(directory, "state.sqlite");
  let store = createUiStateStore(databasePath);
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const description = "Objective: Prepare release notes.\nDeliverable: notes.md\nAcceptance: Include every user-facing change.";
  const tool = createOfficeTasksTool({ uiStateStore: store });
  const created = await tool.execute({ action: "create", title: "Release notes", description });
  assert.equal(created.ok, true);
  assert.equal(created.task.description, description);
  store.close();
  store = createUiStateStore(databasePath);
  const saved = store.getOfficeTasks({ id: created.task.id })[0];
  assert.equal(saved.description, description);
  let dispatched;
  assignOfficeTask(store, {
    listWorkers: () => [{ name: "Writer" }],
    queue: (request) => {
      dispatched = request;
      return { task: { messageId: "description-message" }, completion: new Promise(() => {}) };
    },
  }, { id: saved.id, agent: "Writer" });
  assert.equal(dispatched.title, "Release notes");
  assert.equal(dispatched.task, `Release notes\n\n${description}`);
  const dependentPrompt = buildDependentTaskPrompt(
    { ...saved, dependsOn: ["prerequisite"] },
    [{ id: "prerequisite", title: "Review changes", result: "Verified change list" }],
  );
  assert.ok(dependentPrompt.includes(description));
  assert.ok(dependentPrompt.includes("Verified change list"));
  assert.equal(buildDependentTaskPrompt({ title: "Legacy instructions" }, []), "Legacy instructions");
});
