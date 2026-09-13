import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createProjectMcpHandlers } from "../api/project-mcp.js";
import { createWorkerArtifactStore } from "../lib/worker-artifacts.js";
import { prepareWorkerTask } from "../lib/worker-task-context.js";
import { SubAgentManager } from "../lib/sub-agents.js";

test("project MCP authenticates tasks and scopes file, worker and conversation tools", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "office-mcp-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "alpha/assets"), { recursive: true });
  await fs.mkdir(path.join(root, "beta"));
  await fs.writeFile(path.join(root, "alpha/assets/input.txt"), "Project input");
  await fs.writeFile(path.join(root, "beta/secret.txt"), "Other project secret");
  await fs.symlink(path.join(root, "beta/secret.txt"), path.join(root, "alpha/escape"));
  const task = { id: "research", title: "Research", status: "completed", agent: "Researcher", deliveredWork: [{ workspacePath: "alpha/assets/input.txt" }] };
  const store = {
    requireProject(id) { assert.equal(id, "alpha"); return { id, name: "Alpha", description: "Build an accessible website" }; },
    getOfficeTasks({ projectId }) { assert.equal(projectId, "alpha"); return [task]; },
    getOfficeChatMessages({ projectId }) { assert.equal(projectId, "alpha"); return [{ author: "Human", kind: "user", text: "Keep the site accessible.", createdAt: 1 }]; },
  };
  const manager = {
    listTasks: () => [{ agent: "Designer", state: "working", projectId: "beta", title: "Private task" }],
    listWorkers: () => [{ name: "Designer", description: "Design specialist", tokenName: "secret-token-name", capabilities: { skills: [{ name: "Accessibility" }], tools: ["design"] } }, { name: "Researcher", capabilities: { skills: [{ name: "Research" }] } }],
  };
  const artifacts = createWorkerArtifactStore({ root });
  const upload = artifacts.issueTaskUpload({ taskId: "task-one", projectId: "alpha" });
  const options = { sharedWorkspaceRoot: root, uiStateStore: store, subAgentManager: manager, workerArtifactStore: artifacts };
  const handler = createProjectMcpHandlers(options)["/mcp/projects/"];
  async function request(method, params = {}, overrides = {}) {
    const req = Readable.from([Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }))]);
    req.method = overrides.method || "POST";
    req.headers = { authorization: `Bearer ${upload.token}`, "content-type": "application/json", host: "office.test", ...overrides.headers };
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body ? JSON.parse(body) : null; } };
    await handler(req, res, new URL(overrides.url || "http://office.test/mcp/projects/alpha/tasks/task-one"));
    return res;
  }
  assert.equal((await request("initialize", { protocolVersion: "2025-11-25" })).body.result.protocolVersion, "2025-11-25");
  assert.equal((await request("tools/list")).body.result.tools.length, 5);
  const call = async (name, args = {}) => (await request("tools/call", { name, arguments: args })).body.result;
  const listing = (await call("project_list_files")).structuredContent;
  assert.deepEqual(listing.files.map((file) => file.path), ["assets/input.txt"]);
  assert.equal(listing.files[0].completedBy[0].agent, "Researcher");
  assert.equal((await call("project_read_file", { path: "assets/input.txt" })).structuredContent.text, "Project input");
  for (const file of ["../beta/secret.txt", "/beta/secret.txt", "escape"]) assert.equal((await call("project_read_file", { path: file })).isError, true);
  assert.equal((await call("project_list_files", { projectId: "beta" })).isError, true);
  const workers = (await call("project_list_agents", { skill: "Accessibility" })).structuredContent.workers;
  assert.equal(workers[0].name, "Designer");
  assert.equal(workers[0].available, false);
  assert.doesNotMatch(JSON.stringify(workers), /secret-token-name|Private task|beta/);
  assert.equal((await call("project_conversation_summary")).structuredContent.latestUserRequests[0].text, "Keep the site accessible.");
  assert.equal((await request("tools/list", {}, { url: "http://office.test/mcp/projects/beta/tasks/task-one" })).status, 403);
  assert.equal((await request("tools/list", {}, { headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await request("tools/list", {}, { headers: { origin: "http://evil.test" } })).status, 403);
  assert.equal((await request("tools/list", {}, { method: "GET" })).status, 405);
  await artifacts.discardTask("task-one");
  assert.equal((await request("tools/list")).status, 401);
});

test("worker assignments include project description, current files and prerequisite provenance", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "office-worker-context-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "alpha/assets"), { recursive: true });
  await fs.writeFile(path.join(root, "alpha/assets/research.txt"), "findings");
  const store = {
    requireProject: (id) => ({ id, name: "Alpha", status: "active", description: "Accessible website" }),
    getOfficeTasks: ({ projectId }) => {
      assert.equal(projectId, "alpha");
      return [
        { id: "build", messageId: "message-one", dependsOn: ["research"] },
        { id: "research", title: "Research findings", agent: "Researcher", status: "completed", deliveredWork: [{ workspacePath: "alpha/assets/research.txt" }] },
      ];
    },
  };
  const text = await prepareWorkerTask({ sharedWorkspaceRoot: root, uiStateStore: store }, { projectId: "alpha", messageId: "message-one", task: "Build the site." });
  assert.match(text, /Description: Accessible website/);
  assert.match(text, /\[PREREQUISITE\] assets\/research.txt/);
  assert.match(text, /\/files\/alpha\/assets\/research.txt/);
  assert.match(text, /Research findings by Researcher/);
  assert.ok(text.endsWith("# Assignment\nBuild the site."));
});

test("asynchronous worker preparation preserves receipts and never sends a cancelled task", async () => {
  let ready;
  const sent = [];
  const manager = new SubAgentManager({ prepareTask: () => new Promise((resolve) => { ready = resolve; }), createMcpConnection: () => ({ office_project: { url: "/mcp/projects/alpha/tasks/test" } }) });
  manager.registerWorker({ name: "Builder", url: "ws://localhost:9999" }, { connectionId: "one", send: (message) => sent.push(message) });
  const queued = manager.queue({ agent: "Builder", title: "Short title", task: "Task", projectId: "alpha" });
  assert.equal(queued.task.title, "Short title");
  ready("Project description\nTask");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent[0].message.parts[0].text, "Project description\nTask");
  assert.ok(sent[0].mcpServers.office_project);
  manager.unregisterConnection("one");
  await queued.completion;

  manager.registerWorker({ name: "Builder", url: "ws://localhost:9999" }, { connectionId: "two", send: (message) => sent.push(message) });
  const cancelled = manager.queue({ agent: "Builder", task: "Never send" });
  manager.cancelTask({ messageId: cancelled.task.messageId });
  ready("Prepared too late");
  await cancelled.completion;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.filter((message) => message.type === "task").length, 1);
  manager.unregisterConnection("two");
});

test("project MCP works with the existing HTTP MCP client", async (t) => {
  const { default: http } = await import("node:http");
  const { loadMcpTools } = await import("../lib/mcp.js");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "office-mcp-http-"));
  const artifacts = createWorkerArtifactStore({ root });
  const credential = artifacts.issueTaskUpload({ taskId: "task-http", projectId: "alpha" });
  const handler = createProjectMcpHandlers({
    workerArtifactStore: artifacts, sharedWorkspaceRoot: root,
    uiStateStore: { requireProject: () => ({ id: "alpha", description: "HTTP test project" }), getOfficeTasks: () => [] },
  })["/mcp/projects/"];
  const server = http.createServer((req, res) => void handler(req, res, new URL(req.url, "http://localhost")));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const tools = await loadMcpTools({
    configContent: "",
    env: { AI_HARNESS_MCP_SERVERS: JSON.stringify([{ server_label: "office_project", server_url: `http://127.0.0.1:${server.address().port}/mcp/projects/alpha/tasks/task-http`, headers: { Authorization: `Bearer ${credential.token}` }, require_approval: "never" }]) },
    autoApprove: true,
  });
  assert.equal(tools.length, 5);
  const tool = tools.find((entry) => entry.name.endsWith("project_get_context"));
  assert.ok(tool);
  const result = await tool.execute({});
  assert.match(JSON.stringify(result), /HTTP test project/);
});
