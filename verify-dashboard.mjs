import fs from "node:fs";

const cdpOrigin = process.argv[2] || "http://127.0.0.1:9225";
const targetUrl = process.argv[3] || "http://127.0.0.1:8100/";
const outputPath = process.argv[4] || "screenshots/agent-office.png";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let targets;
for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    targets = await (await fetch(`${cdpOrigin}/json`)).json();
    break;
  } catch {
    await sleep(200);
  }
}
if (!targets) throw new Error("Chrome DevTools endpoint is unavailable.");
const page = targets.find((target) => target.type === "page");
if (!page) throw new Error("No page target found.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") consoleErrors.push(message.params.exceptionDetails.text);
  if (!message.id || !pending.has(message.id)) return;
  const handler = pending.get(message.id);
  pending.delete(message.id);
  message.error ? handler.reject(message.error) : handler.resolve(message.result);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1536, height: 1024, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: targetUrl });
await sleep(2500);
if (new URL(targetUrl).pathname === "/agents" && new URL(targetUrl).searchParams.get("dialog") !== "0") {
  await send("Runtime.evaluate", { expression: `document.querySelector('#add-agent-button')?.click()` });
  await sleep(200);
}
if (new URL(targetUrl).pathname === "/tasks" && new URL(targetUrl).searchParams.get("dialog") === "1") {
  await send("Runtime.evaluate", { expression: `document.querySelector('#add-task-button')?.click()` });
  await sleep(200);
}
const inspection = await send("Runtime.evaluate", {
  expression: `(() => { const activity = document.querySelector('.activity-panel')?.getBoundingClientRect(); const logs = document.querySelector('.logs-panel')?.getBoundingClientRect(); const office = document.querySelector('.office-panel')?.getBoundingClientRect(); const right = document.querySelector('.right-column')?.getBoundingClientRect(); const headers = [...document.querySelectorAll('.panel-header')]; const bodies = [...document.querySelectorAll('.panel-body')]; return { title: document.title, path: location.pathname, activeNavigation: document.querySelector('.nav-item.active')?.dataset.section, visiblePanels: [...document.querySelectorAll('.panel:not([hidden]) .panel-header h2')].map(node => node.textContent), heading: document.querySelector('h1')?.textContent, agents: document.querySelectorAll('.desk-agent').length, registryRows: document.querySelectorAll('#agent-registry-body tr').length, agentDialogOpen: Boolean(document.querySelector('#agent-dialog')?.open), taskDialogOpen: Boolean(document.querySelector('#task-dialog')?.open), taskAgentOptions: [...document.querySelectorAll('#task-agent option')].map(option => option.textContent), officeFillsLeftColumn: Boolean(office && right && office.y === right.y && office.bottom === right.bottom), commandBarPresent: Boolean(document.querySelector('.command-bar')), metrics: document.querySelectorAll('.metric').length, panels: document.querySelectorAll('.panel').length, bodyOverflow: getComputedStyle(document.body).overflow, viewport: [innerWidth, innerHeight], documentSize: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], rightColumnAligned: Boolean(activity && logs && activity.x === logs.x && activity.width === logs.width && logs.y >= activity.bottom), versionBoxPresent: Boolean(document.querySelector('.version')), panelHeaderHeights: [...new Set(headers.map(node => node.getBoundingClientRect().height))], panelBodyColors: [...new Set(bodies.map(node => getComputedStyle(node).backgroundColor))], panelHeaderEllipsis: headers.some(node => node.textContent.includes('•••')) }; })()`,
  returnByValue: true,
});
const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
fs.mkdirSync(new URL("./screenshots/", import.meta.url), { recursive: true });
fs.writeFileSync(outputPath, Buffer.from(screenshot.data, "base64"));
socket.close();
console.log(JSON.stringify({ ...inspection.result.value, consoleErrors, screenshot: outputPath }, null, 2));
