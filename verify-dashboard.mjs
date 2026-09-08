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
const compactViewport = new URL(targetUrl).searchParams.get("compact") === "1";
await send("Emulation.setDeviceMetricsOverride", { width: compactViewport ? 1024 : 1536, height: compactViewport ? 900 : 1024, deviceScaleFactor: 1, mobile: false });
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
if (new URL(targetUrl).pathname === "/operations" && new URL(targetUrl).searchParams.get("dialog") === "1") {
  await send("Runtime.evaluate", { expression: `document.querySelector('#add-operation-button')?.click()` });
  await sleep(200);
}
if (new URL(targetUrl).pathname === "/dashboard" && new URL(targetUrl).searchParams.get("chat") === "1") {
  await send("Runtime.evaluate", { expression: `document.querySelector('#chat-input').value = 'List the current task queue'; document.querySelector('#chat-form').requestSubmit()` });
  await sleep(800);
}
const inspection = await send("Runtime.evaluate", {
  expression: `(() => { const activity = document.querySelector('.activity-panel')?.getBoundingClientRect(); const logs = document.querySelector('.logs-panel')?.getBoundingClientRect(); const office = document.querySelector('.office-panel')?.getBoundingClientRect(); const right = document.querySelector('.right-column')?.getBoundingClientRect(); const chat = document.querySelector('.chat-panel')?.getBoundingClientRect(); const metricsNode = document.querySelector('.metrics'); const headers = [...document.querySelectorAll('.panel-header')]; const bodies = [...document.querySelectorAll('.panel-body')]; return { title: document.title, path: location.pathname, activeNavigation: document.querySelector('.nav-item.active')?.dataset.section, visiblePanels: [...document.querySelectorAll('.panel:not([hidden]) .panel-header h2')].map(node => node.textContent), heading: document.querySelector('h1')?.textContent, agents: document.querySelectorAll('.desk-agent').length, registryRows: document.querySelectorAll('#agent-registry-body tr').length, agentDialogOpen: Boolean(document.querySelector('#agent-dialog')?.open), taskDialogOpen: Boolean(document.querySelector('#task-dialog')?.open), operationDialogOpen: Boolean(document.querySelector('#operation-dialog')?.open), taskAgentOptions: [...document.querySelectorAll('#task-agent option')].map(option => option.textContent), operationAgentOptions: [...document.querySelectorAll('#operation-agent option')].map(option => option.textContent), officeFillsLeftColumn: Boolean(office && right && office.y === right.y && office.bottom === right.bottom), chatFillsLeftColumn: Boolean(chat && right && chat.y === right.y && chat.bottom === right.bottom), chatComposerVisible: Boolean(document.querySelector('#chat-form')?.getBoundingClientRect().height), chatMessages: document.querySelectorAll('.chat-message').length, chatStatus: document.querySelector('#chat-status')?.textContent, taskQueueVisible: Boolean(document.querySelector('.task-panel')?.getBoundingClientRect().height), commandBarPresent: Boolean(document.querySelector('.command-bar')), metrics: document.querySelectorAll('.metric').length, metricsVisible: Boolean(metricsNode && !metricsNode.hidden && metricsNode.getBoundingClientRect().height), panels: document.querySelectorAll('.panel').length, bodyOverflow: getComputedStyle(document.body).overflow, viewport: [innerWidth, innerHeight], documentSize: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], rightColumnAligned: Boolean(activity && logs && activity.x === logs.x && activity.width === logs.width && logs.y >= activity.bottom), versionBoxPresent: Boolean(document.querySelector('.version')), panelHeaderHeights: [...new Set(headers.map(node => node.getBoundingClientRect().height))], panelBodyColors: [...new Set(bodies.map(node => getComputedStyle(node).backgroundColor))], panelHeaderEllipsis: headers.some(node => node.textContent.includes('•••')) }; })()`,
  returnByValue: true,
});
const headerInspection = await send("Runtime.evaluate", {
  expression: `(() => { const brand = document.querySelector('.brand'); const style = getComputedStyle(brand); const box = brand.getBoundingClientRect(); const children = [...brand.children].map(node => node.getBoundingClientRect()); return { text: document.querySelector('#header-context')?.textContent, height: document.querySelector('.topbar')?.getBoundingClientRect().height, padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft], contentInsets: [Math.round(Math.min(...children.map(rect => rect.top)) - box.top), Math.round(box.bottom - Math.max(...children.map(rect => rect.bottom)))], overflow: brand.scrollHeight > brand.clientHeight }; })()`,
  returnByValue: true,
});
const navigationInspection = await send("Runtime.evaluate", {
  expression: `(() => { const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect(); const items = [...document.querySelectorAll('.nav-item')]; const icons = items.map(item => item.querySelector('.nav-icon')?.getBoundingClientRect()); return { width: sidebar?.width, itemWidths: [...new Set(items.map(item => item.getBoundingClientRect().width))], iconWidths: [...new Set(icons.map(icon => icon?.width))], centered: items.every((item, index) => { const itemBox = item.getBoundingClientRect(); const icon = icons[index]; return icon && Math.abs((icon.x + icon.width / 2) - (itemBox.x + itemBox.width / 2)) < 1; }), labels: items.map(item => item.getAttribute('aria-label')), activeLabel: document.querySelector('.nav-item.active')?.getAttribute('aria-label') }; })()`,
  returnByValue: true,
});
const chatInputInspection = await send("Runtime.evaluate", {
  expression: `(() => { const input = document.querySelector('#chat-input'); const button = document.querySelector('#send-chat'); if (!input) return {}; const initialHeight = input.getBoundingClientRect().height; input.value = Array(100).fill('long prompt text').join(' '); input.dispatchEvent(new Event('input', { bubbles: true })); const grownHeight = input.getBoundingClientRect().height; input.value = Array(500).fill('more text').join(' '); input.dispatchEvent(new Event('input', { bubbles: true })); const maximumHeight = input.getBoundingClientRect().height; const overflowY = getComputedStyle(input).overflowY; input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); return { rows: input.rows, initialHeight, grownHeight, maximumHeight, overflowY, resetHeight: input.getBoundingClientRect().height, buttonLabel: button?.textContent.trim() }; })()`,
  returnByValue: true,
});
const settingsInspection = await send("Runtime.evaluate", {
  expression: `({ promptCount: document.querySelectorAll('#prompt-list button').length, selectedPrompt: document.querySelector('#prompt-list button.active strong')?.textContent, editorEnabled: !document.querySelector('#system-prompt-content')?.disabled, editorLength: document.querySelector('#system-prompt-content')?.value.length || 0, workflowsLink: Boolean(document.querySelector('a[href="/workflows"]')), toolsLink: Boolean(document.querySelector('a[href="/tools"]')) })`,
  returnByValue: true,
});
const settingsTabsInspection = await send("Runtime.evaluate", {
  expression: `(() => { const tabs = [...document.querySelectorAll('[data-settings-tab]')]; const views = {}; for (const tab of tabs) { tab.click(); views[tab.dataset.settingsTab] = [...document.querySelectorAll('[data-settings-view]')].filter(view => !view.hidden).map(view => view.dataset.settingsView); } const requested = new URL(location.href).searchParams.get('tab') || 'tools'; document.querySelector('[data-settings-tab="' + requested + '"]')?.click(); const model = document.querySelector('#provider-model'); const modelStyle = model ? getComputedStyle(model) : null; return { labels: tabs.map(tab => tab.textContent.trim()), views, toolPermissions: document.querySelectorAll('[data-tool-permission]').length, mcpEditor: Boolean(document.querySelector('#mcp-config-content')), providerFields: document.querySelectorAll('#provider-form input, #provider-form select').length, modelIsDropdown: model?.tagName === 'SELECT', refreshModelsButton: document.querySelector('#refresh-provider-models')?.textContent.trim(), selectPaddingRight: modelStyle?.paddingRight, selectAppearance: modelStyle?.appearance, active: document.querySelector('[data-settings-tab].active')?.dataset.settingsTab }; })()`,
  returnByValue: true,
});
const knowledgeInspection = await send("Runtime.evaluate", {
  expression: `({ skillRows: document.querySelectorAll('#skills-body tr').length, skillNames: [...document.querySelectorAll('.skill-name')].map(node => node.textContent), enabledSkills: document.querySelectorAll('.skill-toggle:checked').length, fileInputPresent: Boolean(document.querySelector('#skill-file-input[type="file"][multiple]')), deleteButtons: document.querySelectorAll('.skill-delete').length })`,
  returnByValue: true,
});
const memoryInspection = await send("Runtime.evaluate", {
  expression: `({ rows: document.querySelectorAll('#memory-body tr').length, titles: [...document.querySelectorAll('.memory-work strong')].map(node => node.textContent), statuses: [...document.querySelectorAll('[class^="memory-status-"]')].map(node => node.textContent), artifactLinks: [...document.querySelectorAll('.memory-artifacts a')].map(node => node.href) })`,
  returnByValue: true,
});
const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
fs.mkdirSync(new URL("./screenshots/", import.meta.url), { recursive: true });
fs.writeFileSync(outputPath, Buffer.from(screenshot.data, "base64"));
socket.close();
console.log(JSON.stringify({ ...inspection.result.value, header: headerInspection.result.value, navigation: navigationInspection.result.value, chatInput: chatInputInspection.result.value, settings: settingsInspection.result.value, settingsTabs: settingsTabsInspection.result.value, knowledge: knowledgeInspection.result.value, memory: memoryInspection.result.value, consoleErrors, screenshot: outputPath }, null, 2));
