import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSharedWorkspace, extractZip } from "../lib/shared-workspace.js";

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name);
    const content = Buffer.from(value);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    localParts.push(local, filename, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, filename);
    localOffset += local.length + filename.length + content.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

test("delivered ZIP files are unpacked into a task folder and removed", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-shared-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = zip([["index.html", "<h1>Done</h1>"], ["assets/app.js", "console.log('ok')"]]);
  const workspace = createSharedWorkspace({
    root,
    fetchImpl: async () => new Response(archive, { status: 200, headers: { "content-length": String(archive.length) } }),
  });

  const delivered = await workspace.storeTaskArtifacts({ title: "Build launch page", taskId: "task-123" }, [{
    artifactId: "artifact-1", name: "result.zip", mimeType: "application/zip", uri: "https://worker.example/result.zip",
  }]);

  assert.deepEqual(delivered.map((file) => file.name), ["index.html", "assets/app.js"]);
  assert.match(delivered[0].uri, /^\/api\/shared-workspace-file\?path=/);
  const [folder] = fs.readdirSync(root);
  assert.equal(folder, "Build-launch-page--task-123");
  assert.equal(fs.readFileSync(path.join(root, folder, "index.html"), "utf8"), "<h1>Done</h1>");
  assert.equal(fs.readFileSync(path.join(root, folder, "assets/app.js"), "utf8"), "console.log('ok')");
  assert.equal(fs.readdirSync(path.join(root, folder), { recursive: true }).some((name) => String(name).endsWith(".zip")), false);
});

test("ZIP traversal paths are rejected", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-zip-safe-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(extractZip(zip([["../escape.txt", "nope"]]), root), /Unsafe ZIP entry path/);
  assert.equal(fs.existsSync(path.join(root, "..", "escape.txt")), false);
});
