import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUiStateStore } from "../lib/ui-state.js";
import { createOfficeChatService } from "../lib/office-chat.js";
import { createOfficeTask, assignOfficeTask } from "../lib/office-tasks.js";
import { createOfficeTasksTool } from "../lib/tools/office-tasks.js";
import { projectStore, projectWorkspace } from "../lib/projects.js";
import { createSharedWorkspace } from "../lib/shared-workspace.js";
import { createProjectApiHandlers } from "../api/projects.js";
import { createSharedWorkspaceApiHandlers } from "../api/shared-workspace.js";
import { Readable } from "node:stream";
import { createSubAgentTool } from '../lib/tools/sub-agent.js';
import { createTaskApiHandlers } from '../api/tasks.js';

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "office-projects-"));
  const filename = path.join(root, "db.sqlite");
  const store = createUiStateStore(filename);
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, filename, store };
}

function response() {
  return { status: null, body: null, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
}

test('delegated manager work is visible through the project API while running and after completion', async t => {
  const { store, filename } = await setup(t);
  const project = store.createProject({ name: 'Delegated project' });
  let finish, dispatch;
  const manager = {
    listWorkers: () => [{ name: 'Builder' }],
    queue(args) {
      dispatch = args;
      return { task: { messageId: 'delegated-message' }, completion: new Promise(resolve => { finish = resolve; }) };
    },
  };
  const tool = createSubAgentTool({ uiStateStore: projectStore(store, project.id), subAgentManager: manager });
  const execution = tool.execute({ agent: 'Builder', task: 'Build the project app', timeout_ms: 9000 });
  const api = createTaskApiHandlers({ uiStateStore: store, subAgentManager: manager })['/api/tasks'];
  const result = response();
  await api({ method: 'GET' }, result, new URL(`http://office.test/api/tasks?projectId=${project.id}`));
  assert.equal(result.status, 200);
  assert.equal(result.body.tasks.length, 1);
  const [task] = result.body.tasks;
  assert.equal(task.status, 'running');
  assert.equal(task.projectId, project.id);
  assert.equal(task.title, 'Build the project app');
  assert.equal(dispatch.officeTaskId, task.id);
  assert.equal(dispatch.projectId, project.id);
  assert.equal(dispatch.timeoutMs, 9000);
  const other = response();
  await api({ method: 'GET' }, other, new URL('http://office.test/api/tasks?projectId=central-office'));
  assert.equal(other.body.tasks.length, 0);
  finish({ ok: true, taskId: 'remote-task', text: 'Delivered app', deliveredWork: [{ name: 'app.zip' }] });
  assert.equal((await execution).officeTaskId, task.id);
  const reopened = createUiStateStore(filename);
  try {
    const saved = reopened.getOfficeTasks({ projectId: project.id })[0];
    assert.equal(saved.status, 'completed');
    assert.equal(saved.result, 'Delivered app');
    assert.equal(saved.deliveredWork[0].name, 'app.zip');
  } finally { reopened.close(); }
});

test('failed delegated work stays visible and disconnected workers do not create phantom tasks', async t => {
  const { store } = await setup(t);
  const project = store.createProject({ name: 'Failure project' });
  const scoped = projectStore(store, project.id);
  const manager = {
    listWorkers: () => [{ name: 'Builder' }],
    queue: () => ({ task: { messageId: 'failure-message' }, completion: Promise.reject(new Error('Worker disconnected')) }),
  };
  const tool = createSubAgentTool({ uiStateStore: scoped, subAgentManager: manager });
  assert.equal((await tool.execute({ agent: 'Missing', task: 'Do work' })).ok, false);
  assert.equal(scoped.getOfficeTasks().length, 0);
  assert.equal((await tool.execute({ agent: 'Builder', task: 'Do work' })).ok, false);
  const [task] = scoped.getOfficeTasks();
  assert.equal(task.status, 'failed');
  assert.equal(task.error, 'Worker disconnected');
});

test("project rooms persist separately and latest history excludes older and unrelated messages", async (t) => {
  const { store, filename } = await setup(t);
  const a = store.createProject({ name: "Alpha" });
  const b = store.createProject({ name: "Beta" });
  const mentions = [];
  const chat = createOfficeChatService({ uiStateStore: store, onManagerMention: ({ message }) => mentions.push(message.projectId) });
  chat.postUserMessage({ projectId: a.id, text: "Alpha first" });
  chat.postUserMessage({ projectId: b.id, text: "Beta only" });
  chat.postUserMessage({ projectId: a.id, text: "Alpha latest" });
  await new Promise(setImmediate);
  assert.deepEqual(mentions, [a.id, b.id, a.id]);
  assert.deepEqual(chat.list({ projectId: a.id, limit: 1 }).messages.map((m) => m.text), ["Alpha latest"]);
  assert.equal(chat.list().messages.length, 0);
  assert.throws(() => chat.postUserMessage({ projectId: "unknown", text: "invalid" }), /Unknown project/);
  store.updateProject({ id: a.id, name: "Renamed", status: "paused" });
  const reopened = createUiStateStore(filename);
  try {
    assert.equal(reopened.requireProject(a.id).status, "paused");
    assert.equal(reopened.getOfficeChatMessages({ projectId: b.id })[0].text, "Beta only");
  } finally { reopened.close(); }
});

test("manager task tools cannot read, assign, or depend on another project's tasks", async (t) => {
  const { store } = await setup(t);
  const a = store.createProject({ name: "Alpha" }), b = store.createProject({ name: "Beta" });
  const other = createOfficeTask(store, { title: "Secret beta task", projectId: b.id });
  const scoped = projectStore(store, a.id);
  const dispatched = [];
  const manager = { listWorkers: () => [{ name: "Coder" }], queue: (args) => {
    dispatched.push(args);
    return { task: { messageId: "work-1" }, completion: Promise.resolve({ ok: true, taskId: "worker-1", text: "Done" }) };
  } };
  const tool = createOfficeTasksTool({ uiStateStore: scoped, subAgentManager: manager });
  assert.equal((await tool.execute({ action: "read" })).tasks.length, 0);
  assert.equal((await tool.execute({ action: "assign", task_id: other.id, agent: "Coder" })).ok, false);
  assert.equal((await tool.execute({ action: "create", title: "Wrong dependency", depends_on: [other.id] })).ok, false);
  const { task } = await tool.execute({ action: "create", title: "Alpha work" });
  assert.equal(task.projectId, a.id);
  assignOfficeTask(scoped, manager, { id: task.id, agent: "Coder" });
  assert.equal(dispatched[0].projectId, a.id);
  assert.throws(() => scoped.cancelOfficeTask(other.id), /outside/);
  await new Promise(setImmediate);
  assert.equal(store.getOfficeTasks({ projectId: a.id })[0].status, "completed");
  assert.equal(store.getOfficeTasks({ projectId: b.id })[0].status, "pending");
});

test("assignment and worker outcomes stay in the task's room", async (t) => {
  const { store } = await setup(t);
  const project = store.createProject({ name: "Alpha" });
  const chat = createOfficeChatService({ uiStateStore: store });
  const task = { projectId: project.id, messageId: "msg-1", agent: "Coder", title: "Build", text: "Done" };
  chat.postAssignment(task);
  chat.postTaskResult("completed", task);
  assert.equal(chat.list({ projectId: project.id }).messages.length, 2);
  assert.equal(chat.list().messages.length, 0);
});

test("project APIs create workspace folders, update status and filter delivered files", async (t) => {
  const { root, store } = await setup(t);
  const workspace = path.join(root, "workspace");
  const handler = createProjectApiHandlers({ uiStateStore: store, sharedWorkspaceRoot: workspace })["/api/projects"];
  const created = response();
  const req = Readable.from([Buffer.from(JSON.stringify({ name: "Alpha", description: "Website" }))]); req.method = "POST";
  await handler(req, created);
  assert.equal(created.status, 201);
  const project = created.body.project;
  assert.equal((await fs.stat(path.join(workspace, project.id))).isDirectory(), true);
  const storage = createSharedWorkspace({ root: workspace });
  const upload = path.join(root, "uploaded-report.txt");
  await fs.writeFile(upload, "Alpha report");
  const [artifact] = await storage.storeTaskArtifacts({ projectId: project.id, taskId: "task-1", title: "Report" }, [{ name: "report.txt", file: upload }]);
  assert.equal(artifact.workspacePath, `${project.id}/report.txt`);
  assert.equal(await fs.readFile(path.join(workspace, artifact.workspacePath), "utf8"), "Alpha report");
  const b = store.createProject({ name: "Beta" });
  const listing = response();
  await createSharedWorkspaceApiHandlers({ sharedWorkspaceRoot: workspace, uiStateStore: store })["/api/shared-workspace"]({ method: "GET" }, listing, new URL(`http://office/api/shared-workspace?projectId=${b.id}`));
  assert.deepEqual(listing.body.tree, []);
  await assert.rejects(projectWorkspace(workspace, "../escape"), /Invalid/);
  await fs.symlink(root, path.join(workspace, "symlink"));
  await assert.rejects(projectWorkspace(workspace, "symlink"), /symbolic link/);
});

test("manager context includes only the selected project's status, files, and tasks", async (t) => {
  const { root, store } = await setup(t);
  const { prepareProjectContext } = await import("../lib/projects.js");
  const a = store.createProject({ name: "Alpha", description: "Build a website" });
  const b = store.createProject({ name: "Beta" });
  store.updateProject({ id: a.id, status: "paused" });
  store.createOfficeTask({ title: "Alpha task", projectId: a.id });
  store.createOfficeTask({ title: "Beta secret task", projectId: b.id });
  await fs.writeFile(path.join(await projectWorkspace(root, a.id), "alpha.txt"), "A");
  await fs.writeFile(path.join(await projectWorkspace(root, b.id), "beta.txt"), "B");
  const context = await prepareProjectContext(store, root, a.id, "Continue the website");
  assert.equal(context.root, await fs.realpath(path.join(root, a.id)));
  assert.match(context.request, /Project status: paused/);
  assert.match(context.request, /app\/: Application source/);
  assert.match(context.request, /Never add task-ID/);
  assert.match(context.request, /exact project-relative input and output paths/);
  assert.match(context.request, /alpha.txt/);
  assert.match(context.request, /Alpha task/);
  assert.doesNotMatch(context.request, /Beta|beta.txt/);
});
