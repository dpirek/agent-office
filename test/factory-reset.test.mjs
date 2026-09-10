import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createSettingsApiHandlers } from "../api/settings.js";
import { clearManagedDirectory } from "../lib/factory-reset.js";
import { DEFAULT_SYSTEM_PROMPTS } from "../lib/system-prompts.js";
import { createUiStateStore } from "../lib/ui-state.js";

function responseRecorder() {
  return {
    status: null,
    body: "",
    writeHead(status) { this.status = status; },
    end(body = "") { this.body = body; },
  };
}

test("factory reset restores a fresh database and clears managed files", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-reset-"));
  const sharedWorkspace = path.join(directory, "shared");
  await fsp.mkdir(path.join(sharedWorkspace, "task-1"), { recursive: true });
  await fsp.writeFile(path.join(sharedWorkspace, "task-1", "result.txt"), "delivered");
  const store = createUiStateStore(path.join(directory, "state.sqlite"));
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  store.set({
    sessions: [{ id: "session-1", title: "Work", workspace: ".", messages: [{ role: "user", text: "hello" }] }],
    providerSettings: { provider: "custom", model: "example", baseUrl: "http://localhost:9999", apiKey: "secret" },
  });
  store.setMcpConfig('{"mcpServers":{"example":{}}}');
  store.setSystemPrompt("agent_instructions", "Customized instructions");
  store.createSkill({ name: "example-skill", content: "# Example" });
  store.createPeriodicOperation({
    name: "Check", task: "Check status", agent: "auto", intervalValue: 1,
    intervalUnit: "hours", priority: "medium", enabled: true, nextRunAt: Date.now() + 3_600_000,
  });
  store.recordOfficeMemory({ kind: "system", status: "info", title: "Before reset" });
  store.createOfficeTask({ title: "Before reset" });
  store.createOfficeChatMessage({ author: "Human", username: "human", kind: "user", text: "Before reset" });
  store.setWorkerToken("a".repeat(32), "Reset test token");
  store.upsertRegisteredWorker({
    name: "Reset Worker",
    url: "ws://127.0.0.1:9000/workers",
    tokenName: "Reset test token",
    capabilities: { skills: [], tools: ["read_file"], mcp: false, workspaceArtifacts: true },
  });

  const filesRemoved = await clearManagedDirectory(sharedWorkspace, { protectedPaths: [directory] });
  const result = store.factoryReset();

  assert.equal(filesRemoved, 1);
  assert.deepEqual(await fsp.readdir(sharedWorkspace), []);
  assert.deepEqual(result, { sessions: 0, tasks: 0, messages: 0, memory: 0, operations: 0, skills: 0 });
  assert.equal(store.getAll().sessions, undefined);
  assert.equal(store.getSelectedProvider(), null);
  assert.equal(store.getMcpConfig(), "");
  assert.deepEqual(store.getSystemPrompts(), DEFAULT_SYSTEM_PROMPTS);
  assert.deepEqual(store.getSkills(), []);
  assert.deepEqual(store.getPeriodicOperations(), []);
  assert.deepEqual(store.getOfficeMemory(), []);
  assert.deepEqual(store.getOfficeTasks(), []);
  assert.deepEqual(store.getOfficeChatMessages(), []);
  assert.equal(store.getWorkerToken(), "");
  assert.equal(store.getWorkerTokenName(), "");
  assert.deepEqual(store.getRegisteredWorkers(), []);
  assert.equal(store.getRigConfigurations().configurations.length, 1);
});

test("factory reset API requires an explicit confirmation phrase", async () => {
  let calls = 0;
  const handler = createSettingsApiHandlers({
    uiStateStore: {},
    defaultWorkspace: ".",
    factoryReset: async () => { calls += 1; return { filesRemoved: 2 }; },
  })["/api/factory-reset"];

  const rejected = responseRecorder();
  const rejectedRequest = Readable.from([Buffer.from(JSON.stringify({ confirmation: "yes" }))]);
  rejectedRequest.method = "POST";
  await handler(rejectedRequest, rejected);
  assert.equal(rejected.status, 400);
  assert.equal(calls, 0);

  const accepted = responseRecorder();
  const acceptedRequest = Readable.from([Buffer.from(JSON.stringify({ confirmation: "FACTORY RESET" }))]);
  acceptedRequest.method = "POST";
  await handler(acceptedRequest, accepted);
  assert.equal(accepted.status, 200);
  assert.deepEqual(JSON.parse(accepted.body), { ok: true, filesRemoved: 2 });
  assert.equal(calls, 1);
});

test("managed directory clearing refuses protected roots", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-reset-safe-"));
  try {
    await assert.rejects(
      clearManagedDirectory(directory, { protectedPaths: [directory] }),
      /Refusing to clear unsafe shared workspace path/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("managed directory clearing resolves symlinks before its safety check", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-reset-link-"));
  const protectedDirectory = path.join(directory, "protected");
  const linkedDirectory = path.join(directory, "shared-link");
  await fsp.mkdir(protectedDirectory);
  await fsp.writeFile(path.join(protectedDirectory, "keep.txt"), "keep");
  await fsp.symlink(protectedDirectory, linkedDirectory, "dir");
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  await assert.rejects(
    clearManagedDirectory(linkedDirectory, { protectedPaths: [protectedDirectory] }),
    /Refusing to clear unsafe shared workspace path/,
  );
  assert.equal(await fsp.readFile(path.join(protectedDirectory, "keep.txt"), "utf8"), "keep");
});
