import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createTaskDeliveryHandlers } from "../api/task-delivery.js";
import { taskDeliveryFiles, streamTaskZip } from "../lib/task-delivery-zip.js";
import { extractZip } from "../lib/shared-workspace.js";

test("task download bundles only its delivered files with valid CRCs and nested paths", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "office-task-zip-"));
  await fs.mkdir(path.join(root, "alpha/assets"), { recursive: true });
  await fs.writeFile(path.join(root, "alpha/index.html"), '<script src="assets/app.js"></script>');
  await fs.writeFile(path.join(root, "alpha/assets/app.js"), 'console.log("ready");');
  await fs.writeFile(path.join(root, "alpha/unrelated.txt"), "Not delivered by this task");
  const task = { id: "task-one", title: "Build site", projectId: "alpha", deliveredWork: [
    { name: "index.html", workspacePath: "alpha/index.html" },
    { name: "assets/app.js", workspacePath: "alpha/assets/app.js" },
  ] };
  const handler = createTaskDeliveryHandlers({ sharedWorkspaceRoot: root, uiStateStore: {
    requireProject: () => {},
    getOfficeTasks: ({ id, projectId }) => id === task.id && projectId === "alpha" ? [task] : [],
  } })["/downloads/tasks/"];
  const server = http.createServer((req, res) => void handler(req, res, new URL(req.url, "http://office.test")));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/downloads/tasks/alpha/task-one.zip`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="Build-site.zip"');
  const buffer = Buffer.from(await response.arrayBuffer());
  const archive = path.join(root, "download.zip");
  await fs.writeFile(archive, buffer);
  execFileSync("/usr/bin/unzip", ["-t", archive]);
  const extracted = path.join(root, "extracted");
  await fs.mkdir(extracted);
  assert.deepEqual((await extractZip(buffer, extracted)).map((file) => file.relativePath), ["index.html", "assets/app.js"]);
  assert.equal(await fs.readFile(path.join(extracted, "assets/app.js"), "utf8"), 'console.log("ready");');
  assert.equal((await fetch(url.replace("/alpha/", "/beta/"))).status, 404);
  assert.equal((await fetch(url, { method: "HEAD" })).status, 200);
  await fs.unlink(path.join(root, "alpha/index.html"));
  assert.equal((await fetch(url)).status, 404);
});

test("task bundles reject traversal and support UTF-8 filenames and empty files", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "office-zip-paths-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "empty.txt"), "");
  const task = { deliveredWork: [{ name: "résumé.txt", workspacePath: "empty.txt" }] };
  const files = await taskDeliveryFiles(root, task);
  const chunks = [];
  for await (const chunk of streamTaskZip(files)) chunks.push(chunk);
  const archive = path.join(root, "unicode.zip");
  await fs.writeFile(archive, Buffer.concat(chunks));
  execFileSync("/usr/bin/unzip", ["-t", archive]);
  await assert.rejects(taskDeliveryFiles(root, { deliveredWork: [] }), /no delivered files/);
  task.deliveredWork[0].name = "../escape.txt";
  await assert.rejects(taskDeliveryFiles(root, task), /Invalid delivered filename/);
  await fs.symlink("/etc/hosts", path.join(root, "outside"));
  task.deliveredWork[0] = { name: "outside", workspacePath: "outside" };
  await assert.rejects(taskDeliveryFiles(root, task), /outside the workspace/);
});
