import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOfficeChatService } from "../lib/office-chat.js";
import { createUiStateStore } from "../lib/ui-state.js";

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-chat-"));
  const store = createUiStateStore(path.join(directory, "state.sqlite"));
  return { directory, store };
}

test("central office persists messages and dispatches direct agent mentions", async (context) => {
  const { directory, store } = setup();
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const queued = [];
  const subAgentManager = {
    listWorkers: () => [{ name: "Dave the Developer", description: "Codes things" }],
    queue({ agent, task, priority }) {
      queued.push({ agent, task, priority });
      return {
        task: { messageId: "msg-1" },
        completion: Promise.resolve({ ok: true, status: "completed", taskId: "worker-1", text: "Done", deliveredWork: [] }),
      };
    },
  };
  const chat = createOfficeChatService({ uiStateStore: store, subAgentManager });

  const result = chat.postUserMessage({ text: "@dave-the-developer please prepare the release", priority: "high" });
  assert.equal(result.managerMentioned, false);
  assert.equal(result.dispatches[0].ok, true);
  assert.equal(queued[0].agent, "Dave the Developer");
  assert.equal(queued[0].priority, "high");
  assert.equal(store.getOfficeTasks()[0].status, "running");
  assert.equal(chat.list().messages[0].text, "@dave-the-developer please prepare the release");
});

test("office manager mentions wake the internal manager without assigning a worker", async (context) => {
  const { directory, store } = setup();
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const mentions = [];
  const chat = createOfficeChatService({
    uiStateStore: store,
    subAgentManager: { listWorkers: () => [] },
    onManagerMention: (message) => mentions.push(message),
  });

  const result = chat.postUserMessage({ text: "Status update, @office-manager?" });
  assert.equal(result.managerMentioned, true);
  assert.deepEqual(result.dispatches, []);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mentions[0].text, "Status update, @office-manager?");
  assert.deepEqual(chat.list().members.map((member) => member.username), ["office-manager"]);
});

test("assignments and worker results are published to central office", (context) => {
  const { directory, store } = setup();
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const chat = createOfficeChatService({ uiStateStore: store, subAgentManager: { listWorkers: () => [] } });
  const task = { agent: "Dave the Developer", title: "Prepare release", messageId: "msg-42" };

  chat.postAssignment(task);
  chat.postTaskResult("completed", {
    ...task,
    text: "Release prepared.",
    deliveredWork: [{ name: "release.zip", uri: "https://worker.example/release.zip" }],
  });

  const messages = chat.list().messages;
  assert.equal(messages[0].author, "Office Manager");
  assert.match(messages[0].text, /^@dave-the-developer Assigned task:/);
  assert.equal(messages[1].author, "Dave the Developer");
  assert.equal(messages[1].text, "Release prepared.");
  assert.equal(messages[1].artifacts[0].name, "release.zip");
  assert.equal(messages[1].taskId, "msg-42");
});
