import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createWorkerArtifactApiHandlers } from "../api/worker-artifacts.js";
import { createSharedWorkspace } from "../lib/shared-workspace.js";
import { SubAgentManager } from "../lib/sub-agents.js";
import { createWorkerArtifactStore } from "../lib/worker-artifacts.js";

function responseRecorder() {
  return {
    status: null,
    body: "",
    writeHead(status) { this.status = status; },
    end(body = "") { this.body = body; },
  };
}

function uploadRequest(content, token, contentType = "application/octet-stream") {
  const request = Readable.from([content]);
  request.method = "POST";
  request.headers = { authorization: `Bearer ${token}`, "content-type": contentType };
  return request;
}

test("worker artifact API authenticates task uploads and logs outcomes", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-worker-upload-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logs = [];
  const store = createWorkerArtifactStore({ root });
  const upload = store.issueTaskUpload({ taskId: "task-1", agent: "Builder" });
  const handler = createWorkerArtifactApiHandlers({
    workerArtifactStore: store,
    uiStateStore: { recordSystemActivity: (entry) => logs.push(entry) },
  })["/api/worker-artifacts"];

  const response = responseRecorder();
  await handler(
    uploadRequest(Buffer.from("release"), upload.token),
    response,
    new URL("http://office.test/api/worker-artifacts?taskId=task-1&name=release.zip"),
  );
  const body = JSON.parse(response.body);
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.name, "release.zip");
  assert.equal(body.mimeType, "application/zip");
  assert.equal(body.size, 7);
  assert.match(body.artifactId, /^artifact-/);
  assert.equal(logs[0].tone, "success");
  assert.equal(logs[0].source, "Builder");

  const denied = responseRecorder();
  await handler(
    uploadRequest(Buffer.from("wrong task"), "wrong-token"),
    denied,
    new URL("http://office.test/api/worker-artifacts?taskId=task-1&name=other.txt"),
  );
  assert.equal(denied.status, 401);
  assert.equal(JSON.parse(denied.body).ok, false);
  assert.equal(logs[1].tone, "error");
});

test("completed task updates attach previously uploaded artifacts", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-worker-finish-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sent = [];
  const events = [];
  const uploads = createWorkerArtifactStore({ root });
  const sharedWorkspace = createSharedWorkspace({ root });
  const manager = new SubAgentManager({
    createArtifactUpload: (task) => uploads.issueTaskUpload(task),
    discardArtifactUploads: (taskId) => uploads.discardTask(taskId),
    materializeArtifacts: (task, remoteArtifacts, uploadedArtifactIds) => sharedWorkspace.storeTaskArtifacts(
      task,
      remoteArtifacts,
      uploads.resolve(task.taskId, uploadedArtifactIds),
    ),
    onTaskEvent: (event, task) => events.push({ event, task }),
  });
  manager.registerWorker({ name: "Builder", url: "ws://worker.test/socket" }, {
    connectionId: "worker-1",
    send: (message) => sent.push(message),
  });
  const queued = manager.queue({ agent: "Builder", task: "Create the release", timeoutMs: 2_000 });
  const assignment = sent[0];
  assert.equal(assignment.artifactUpload.method, "POST");
  assert.equal(assignment.artifactUpload.contentType, "application/octet-stream");
  assert.match(assignment.artifactUpload.url, /taskId=task-/);

  const artifact = await uploads.upload({
    taskId: assignment.taskId,
    token: assignment.artifactUpload.token,
    name: "release.txt",
    content: Buffer.from("finished work"),
  });
  const acknowledgement = await manager.receiveUpdate("Builder", {
    type: "task_update",
    taskId: assignment.taskId,
    status: { state: "completed" },
    message: { parts: [{ kind: "text", text: "Release completed." }] },
    uploadedArtifactIds: [artifact.artifactId],
  }, "worker-1");
  const result = await queued.completion;

  assert.equal(acknowledgement.state, "completed");
  assert.equal(result.deliveredWork.length, 1);
  assert.equal(result.deliveredWork[0].artifactId, artifact.artifactId);
  assert.equal(result.deliveredWork[0].name, "release.txt");
  assert.equal("file" in result.deliveredWork[0], false);
  assert.equal(fs.readFileSync(path.join(root, result.deliveredWork[0].workspacePath), "utf8"), "finished work");
  assert.equal(events.at(-1).event, "completed");
});

test("unknown uploaded artifact IDs fail the task without breaking the worker protocol", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-worker-missing-upload-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sent = [];
  const uploads = createWorkerArtifactStore({ root });
  const manager = new SubAgentManager({
    createArtifactUpload: (task) => uploads.issueTaskUpload(task),
    discardArtifactUploads: (taskId) => uploads.discardTask(taskId),
    materializeArtifacts: (task, remoteArtifacts, uploadedArtifactIds) => uploads.resolve(task.taskId, uploadedArtifactIds),
  });
  manager.registerWorker({ name: "Builder", url: "ws://worker.test/socket" }, {
    connectionId: "worker-1",
    send: (message) => sent.push(message),
  });
  const queued = manager.queue({ agent: "Builder", task: "Create a file", timeoutMs: 2_000 });
  const acknowledgement = await manager.receiveUpdate("Builder", {
    type: "task_update",
    taskId: sent[0].taskId,
    status: { state: "completed" },
    uploadedArtifactIds: ["artifact-does-not-exist"],
  }, "worker-1");
  const result = await queued.completion;

  assert.equal(acknowledgement.state, "failed");
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown uploaded artifact/);
});
