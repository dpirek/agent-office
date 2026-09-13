import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const root = path.resolve('.ui-verification/workspace-tree');
const appRoot = path.resolve('.');
const files = path.join(root, 'workspace/deliverables/central-office');
await fs.mkdir(path.join(files, 'app/assets'), { recursive: true });
await fs.mkdir(path.join(files, 'docs'), { recursive: true });
await fs.writeFile(path.join(files, 'app/index.html'), '<html><body style="background:#f5ead8;padding:50px;font-family:Georgia"><h1>Project website</h1><p>Preview with relative assets.</p></body></html>');
await fs.writeFile(path.join(files, 'app/assets/site.css'), 'body { color: #264535; }');
await fs.writeFile(path.join(files, 'docs/requirements.md'), '# Project requirements\n\nA shared project workspace with **inline previews**.');
const server = spawn(process.execPath, ['server.js'], { cwd: appRoot, env: { ...process.env, PORT: '8139', AI_HARNESS_DATA_DIR: root, AI_HARNESS_WORKSPACE: path.join(root, 'workspace'), AI_HARNESS_SHARED_WORKSPACE: path.join(root, 'workspace/deliverables') }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9239', '--user-data-dir=' + path.join(root, 'chrome'), 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let socket;
try {
  let targets;
  for (let i = 0; i < 80; i++) {
    try { await fetch('http://127.0.0.1:8139/api/projects'); targets = await (await fetch('http://127.0.0.1:9239/json')).json(); break; } catch { await sleep(200); }
  }
  assert.ok(targets, 'Browser and app started');
  socket = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
    const item = pending.get(msg.id); if (!item) return;
    pending.delete(msg.id); msg.error ? item.reject(msg.error) : item.resolve(msg.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const out = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (out.exceptionDetails) throw new Error(JSON.stringify(out.exceptionDetails)); return out.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:8139/central-office/workspace' });
  for (let i = 0; i < 60; i++) { if (await evaluate('document.querySelectorAll(".workspace-tree-file").length === 3')) break; await sleep(100); }
  assert.equal(await evaluate('document.querySelectorAll(".workspace-tree-file").length'), 3);
  assert.equal(await evaluate('Boolean(document.querySelector("#file-preview-dialog"))'), false);
  await sleep(500);
  await evaluate('document.querySelector("a[href$=\\\"docs/requirements.md\\\"]").click()');
  await sleep(250);
  assert.equal(await evaluate('document.querySelector("#file-preview-content h1")?.textContent'), 'Project requirements');
  await evaluate('document.querySelector("details[data-folder-path=\\\"central-office/app\\\"]").open = false');
  await sleep(2500);
  assert.equal(await evaluate('document.querySelector("details[data-folder-path=\\\"central-office/app\\\"]").open'), false);
  assert.equal(await evaluate('document.querySelector(".workspace-tree-file.selected")?.textContent.includes("requirements.md")'), true);
  await evaluate('document.querySelector("details[data-folder-path=\\\"central-office/app\\\"]").open = true; document.querySelector("a[href$=\\\"app/index.html\\\"]").click()');
  await sleep(300);
  assert.equal(await evaluate('Boolean(document.querySelector("#file-preview-content iframe"))'), true);
  assert.equal(await evaluate('document.querySelector(".workspace-tree-pane").getBoundingClientRect().right <= document.querySelector(".workspace-preview").getBoundingClientRect().left'), true);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(root, 'desktop.png'), Buffer.from(shot.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(200);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  const mobile = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(root, 'mobile.png'), Buffer.from(mobile.data, 'base64'));
  assert.deepEqual(errors, []);
  console.log('PASS: nested tree, inline Markdown/HTML previews, selection and collapse persistence, desktop split, mobile width, no modal or browser exceptions.');
} finally { socket?.close(); chrome.kill(); server.kill(); }
