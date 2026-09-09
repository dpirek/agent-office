import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
    queue({ agent, task, priority }) {
      dispatchCount += 1;
      assert.deepEqual({ agent, task, priority }, {
        agent: "Dave",
        task: "Prepare the release notes",
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
    queue({ agent, task }) {
      dispatched.push({ agent, task });
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
  assert.deepEqual(dispatched, [{ agent: "Researcher", task: "Research site data" }]);

  completions[0]({ ok: true, taskId: "research-result", text: "Research complete." });
  await new Promise((resolve) => setImmediate(resolve));

  const nextReview = createOfficeTasksTool({ uiStateStore: store, subAgentManager });
  const assignedDesign = await nextReview.execute({ action: "assign", task_id: design.id, agent: "Designer" });
  assert.equal(assignedDesign.ok, true);
  assert.deepEqual(dispatched[1], { agent: "Designer", task: "Design the UI" });
});
