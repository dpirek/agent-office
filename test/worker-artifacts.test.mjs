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
import { createAuthService } from '../api/auth.js';

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
  let workerToken = 'registration-key';
  const store = createWorkerArtifactStore({ root, getWorkerToken: () => workerToken });
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
  const auth = createAuthService({ userStore: { session: () => null }, getWorkerToken: () => workerToken });
  const sharedKeyUpload = async (token, taskId = 'task-1') => {
    const req = uploadRequest(Buffer.from('same-key delivery'), token);
    const res = responseRecorder();
    const url = new URL(`http://office.test/api/worker-artifacts?taskId=${taskId}&name=shared-key.txt`);
    assert.equal(await auth.handle(req, res, url), false);
    await handler(req, res, url);
    return res;
  };
  assert.equal((await sharedKeyUpload(workerToken)).status, 200);
  assert.equal((await sharedKeyUpload(workerToken, 'unknown-task')).status, 401);
  workerToken = 'replacement-key';
  assert.equal((await sharedKeyUpload('registration-key')).status, 401);
  assert.equal((await sharedKeyUpload(workerToken)).status, 200);
  assert.equal((await sharedKeyUpload(upload.token)).status, 200);
  await store.discardTask('task-1');
  assert.equal((await sharedKeyUpload(workerToken)).status, 401);
});
