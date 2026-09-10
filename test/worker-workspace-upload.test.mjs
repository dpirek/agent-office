import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createUiStateStore } from "../lib/ui-state.js";
import { createOfficeChatService } from "../lib/office-chat.js";
import { createWorkspaceApiHandlers } from "../api/workspace.js";

test("worker test upload announces once after storage, including retries, reconnects and restarts", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-worker-upload-"));
  const databasePath = path.join(root, "state.sqlite");
  let store = createUiStateStore(databasePath);
  context.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const token = "a".repeat(32);
  store.setWorkerToken(token);
  const worker = { name: "Builder", url: "ws://localhost:8099", capabilities: {} };
  store.upsertRegisteredWorker(worker);
  const body = "# Connectivity test\nWorker: Builder\nConnection ID: connection-1\nJoined: 2026-09-10T12:00:00Z\nFile sending connectivity test.\n";
  async function upload({ name = "test.md", agent = "Builder", credential = token, workspace = ".", browser = false } = {}) {
    const req = Readable.from([Buffer.from(body)]);
    req.method = "POST";
    req.headers = { "content-type": "text/markdown; charset=utf-8", "content-length": Buffer.byteLength(body) };
    if (!browser) Object.assign(req.headers, { "x-agent-name": agent, authorization: `Bearer ${credential}` });
    const response = { writeHead(status) { this.status = status; }, end(value) { this.body = JSON.parse(value); } };
    const chat = createOfficeChatService({ uiStateStore: store });
    const handler = createWorkspaceApiHandlers({
      uiStateStore: store, officeChatService: chat,
      resolveWorkspace: async (requested) => { assert.equal(requested, workspace); return path.join(root, requested); },
    })["/api/workspace-upload"];
    await handler(req, response, new URL(`http://office.test/api/workspace-upload?workspace=${workspace}&name=${name}`));
    return response;
  }
  assert.equal((await upload({ credential: "wrong" })).status, 401);
  assert.equal((await upload({ agent: "Unknown" })).status, 403);
  assert.equal(fs.existsSync(path.join(root, "test.md")), false);
  assert.equal((await upload({ workspace: "missing" })).status, 400);
  assert.equal((await upload({ name: "report.md" })).status, 201);
  assert.equal((await upload({ browser: true })).status, 201);
  assert.equal(store.getOfficeChatMessages().length, 0);
  const responses = await Promise.all([upload(), upload()]);
  assert.ok(responses.every((response) => response.status === 201));
  assert.equal(fs.readFileSync(path.join(root, "test.md"), "utf8"), body);
  assert.equal(store.getOfficeChatMessages().length, 1);
  assert.match(store.getOfficeChatMessages()[0].text, /Builder joined the office and has file sending connectivity/);
  store.markRegisteredWorkerOffline(worker.name);
  store.upsertRegisteredWorker(worker);
  await upload();
  store.close();
  store = createUiStateStore(databasePath);
  store.upsertRegisteredWorker(worker);
  await upload();
  assert.equal(store.getOfficeChatMessages().length, 1);
  store.upsertRegisteredWorker({ ...worker, name: "Reviewer" });
  await upload({ agent: "Reviewer" });
  assert.equal(store.getOfficeChatMessages().length, 2);
});

test("a failed chat insert rolls back the connectivity flag", (context) => {
  const store = createUiStateStore(":memory:");
  context.after(() => store.close());
  store.upsertRegisteredWorker({ name: "Builder", url: "ws://localhost:8099", capabilities: {} });
  assert.throws(() => store.announceWorkerConnectivity("Builder", () => { throw new Error("insert failed"); }));
  let announcements = 0;
  assert.equal(store.announceWorkerConnectivity("Builder", () => announcements++), true);
  assert.equal(store.announceWorkerConnectivity("Builder", () => announcements++), false);
  assert.equal(announcements, 1);
});
