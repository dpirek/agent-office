import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import test from "node:test";
import { createSharedWorkspaceApiHandlers } from "../api/shared-workspace.js";

test("workspace static URLs serve a website and relative assets, redirect legacy links, and protect the root", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "office-static-"));
  const root = path.join(directory, "files");
  await fs.mkdir(path.join(root, "project/site/assets"), { recursive: true });
  await fs.writeFile(path.join(root, "project/site/index.html"), '<link href="assets/style.css" rel="stylesheet"><script src="./assets/app.js"></script><a href="../notes.txt">Notes</a>');
  await fs.writeFile(path.join(root, "project/site/assets/style.css"), "body { color: red; }");
  await fs.writeFile(path.join(root, "project/site/assets/app.js"), 'console.log("loaded");');
  await fs.writeFile(path.join(root, "project/notes.txt"), "Notes");
  await fs.writeFile(path.join(root, "project/site/a #%.txt"), "Encoded name");
  await fs.writeFile(path.join(directory, "secret.txt"), "secret");
  await fs.symlink(path.join(directory, "secret.txt"), path.join(root, "escape.txt"));
  await fs.writeFile(path.join(root, ".env"), "private");
  const routes = createSharedWorkspaceApiHandlers({ sharedWorkspaceRoot: root });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://office.test");
    const handler = routes[url.pathname] || (url.pathname.startsWith("/files/") && routes["/files/"]);
    if (handler) void handler(req, res, url);
    else { res.writeHead(404); res.end(); }
  });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(origin + "/files/project/site");
  assert.equal(page.url, origin + "/files/project/site/");
  assert.match(page.headers.get("content-type"), /text\/html/);
  const html = await page.text();
  for (const [relative, type, text] of [
    ["assets/style.css", "text/css", "body { color: red; }"],
    ["./assets/app.js", "text/javascript", 'console.log("loaded");'],
    ["../notes.txt", "text/plain", "Notes"],
  ]) {
    assert.ok(html.includes(relative));
    const asset = await fetch(new URL(relative, page.url));
    assert.equal(asset.status, 200);
    assert.ok(asset.headers.get("content-type").startsWith(type));
    assert.equal(await asset.text(), text);
  }
  const legacy = await fetch(origin + "/api/shared-workspace-file?path=project%2Fsite%2Findex.html");
  assert.equal(legacy.url, origin + "/files/project/site/index.html");
  assert.equal(await legacy.text(), html);
  const encoded = await fetch(origin + "/files/project/site/a%20%23%25.txt");
  assert.equal(await encoded.text(), "Encoded name");
  const head = await fetch(page.url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), Buffer.byteLength(html));
  assert.equal(await head.text(), "");
  for (const url of ["/files/escape.txt", "/files/.env", "/files/%2e%2e%2fsecret.txt", "/files/%ZZ", "/files/missing.css"]) {
    assert.equal((await fetch(origin + url)).status, 404, url);
  }
  assert.equal((await fetch(page.url, { method: "POST" })).status, 405);
});
