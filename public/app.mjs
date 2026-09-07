import Router from "./lib/router.mjs";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const startedAt = Date.now();
const sessionId = crypto.randomUUID();

const ROLE_AGENTS = [
  { name: "Researcher", role: "Research Specialist", description: "Finds evidence and explores the problem space", tools: "browser, search, filesystem" },
  { name: "Planner", role: "Task Architect", description: "Decomposes goals into executable work", tools: "planning, memory, workflows" },
  { name: "Coder", role: "Software Engineer", description: "Writes and tests production code", tools: "filesystem, shell, git" },
  { name: "Verifier", role: "Quality Engineer", description: "Validates behavior, security, and regressions", tools: "tests, browser, shell" },
  { name: "Coordinator", role: "Lead Orchestrator", description: "Routes tasks and synthesizes agent results", tools: "all connected tools" },
  { name: "Reporter", role: "Technical Writer", description: "Turns completed work into clear outcomes", tools: "filesystem, knowledge, memory" },
];

const PAGES = {
  dashboard: { path: "/dashboard", title: "Dashboard" },
  agents: { path: "/agents", title: "Agents" },
  tasks: { path: "/tasks", title: "Tasks" },
  workflows: { path: "/workflows", title: "Workflows" },
  tools: { path: "/tools", title: "Tools" },
  memory: { path: "/memory", title: "Memory", icon: "◉", heading: "Agent memory", description: "Session context and workspace state are managed by the active rig configuration." },
  knowledge: { path: "/knowledge", title: "Knowledge", icon: "▧", heading: "Knowledge base", description: "Connected sources and selected skills provide shared context to the agent office." },
  logs: { path: "/logs", title: "Logs" },
  settings: { path: "/settings", title: "Settings", icon: "⚙", heading: "Office settings", description: "Provider, tool, skill, and sub-agent settings come from the active rig configuration." },
};

const state = {
  agents: [],
  selectedAgent: null,
  activeTab: "details",
  taskFilter: "all",
  localTasks: [],
  delegatedTasks: [],
  workers: [],
  activity: [],
  logs: [],
  health: null,
  orchestrator: null,
  socket: null,
  socketReady: false,
  runningTaskId: null,
  paused: false,
  tokenCount: 0,
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function clock(value = Date.now()) {
  return new Date(value).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function shortTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function showToast(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show${error ? " error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = "toast"; }, 3200);
}

function renderPage(section) {
  const page = PAGES[section] || PAGES.dashboard;
  document.body.dataset.page = section;
  document.title = `${page.title} · AI Agent Office`;
  $$(".nav-item").forEach((item) => {
    const active = item.dataset.section === section;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });

  $$("[data-view]").forEach((panel) => {
    panel.hidden = !panel.dataset.view.split(/\s+/).includes(section);
  });
  const rightColumn = $(".right-column");
  const operations = $(".operations-grid");
  const bottom = $(".bottom-grid");
  rightColumn.hidden = !$$(':scope > .panel:not([hidden])', rightColumn).length;
  operations.hidden = $(".office-panel").hidden && rightColumn.hidden;
  bottom.hidden = !$$(':scope > .panel:not([hidden])', bottom).length;

  if (page.heading) {
    $("#route-page-icon").textContent = page.icon;
    $("#route-page-title").textContent = page.title.toUpperCase();
    $("#route-page-heading").textContent = page.heading;
    $("#route-page-description").textContent = page.description;
  }
}

function addActivity(text, tone = "") {
  state.activity.push({ at: Date.now(), text, tone });
  state.activity = state.activity.slice(-80);
  renderActivity();
}

function addLog(source, text, tone = "") {
  state.logs.push({ at: Date.now(), source, text, tone });
  state.logs = state.logs.slice(-120);
  renderLogs();
}

function normalizeTaskStatus(status) {
  if (["working", "submitting", "running"].includes(status)) return "running";
  if (status === "timed_out") return "failed";
  return ["pending", "completed", "failed"].includes(status) ? status : "pending";
}

function allTasks() {
  const delegated = state.delegatedTasks.map((task) => ({
    id: task.messageId || task.taskId || `${task.agent}-${task.createdAt}`,
    title: task.title || `Delegated task ${task.taskId || "awaiting acknowledgement"}`,
    agent: task.agent,
    status: normalizeTaskStatus(task.state),
    priority: task.priority || "medium",
    progress: task.state === "completed" ? 100 : task.state === "working" ? 55 : task.state === "submitting" ? 15 : 0,
    createdAt: task.createdAt,
    delegated: true,
  }));
  return [...state.localTasks, ...delegated].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function currentAgent() {
  return state.agents.find((agent) => agent.name === state.selectedAgent) || state.agents[0];
}

function renderOffice() {
  const floor = $("#agent-floor");
  floor.innerHTML = state.agents.length ? state.agents.slice(0, 6).map((agent) => `
    <button class="desk-agent ${agent.status === "running" ? "active" : ""} ${agent.name === state.selectedAgent ? "selected" : ""}" data-agent="${escapeHtml(agent.name)}" aria-label="Select ${escapeHtml(agent.name)}">
      <span class="monitor"><i></i></span>
      <span class="desk-top"><i class="keyboard"></i></span>
      <span class="chair"></span><span class="avatar"></span>
      <span class="nameplate"><i></i>${escapeHtml(agent.name)}</span>
    </button>`).join("") : `<div class="office-empty"><strong>NO REGISTERED AGENTS</strong><span>Add an HTTP agent from the Agent Registry.</span></div>`;
  $$(".desk-agent", floor).forEach((button) => button.addEventListener("click", () => {
    state.selectedAgent = button.dataset.agent;
    renderOffice();
    renderSelectedAgent();
  }));
}

function renderAgentRegistry() {
  const body = $("#agent-registry-body");
  if (!body) return;
  body.innerHTML = state.workers.length ? state.workers.map((worker) => `
    <tr>
      <td>${escapeHtml(worker.name)}</td>
      <td title="${escapeHtml(worker.url)}">${escapeHtml(worker.url)}</td>
      <td><span class="registry-actions"><button type="button" class="edit-agent" data-agent="${escapeHtml(worker.name)}">EDIT</button><button type="button" class="delete-agent" data-agent="${escapeHtml(worker.name)}">DELETE</button></span></td>
    </tr>`).join("") : `<tr class="empty-row"><td colspan="3">NO HTTP AGENTS CONFIGURED</td></tr>`;
}

function detailRows(agent) {
  const model = state.orchestrator?.model || state.health?.model || "not configured";
  const workspace = state.health?.workspace || "—";
  const tasks = allTasks().filter((task) => task.agent === agent.name);
  const runningTask = tasks.find((task) => task.status === "running");
  const base = {
    details: [["ID", agent.id], ["ROLE", agent.role], ["MODEL", model], ["STATUS", agent.status], ["CURRENT TASK", runningTask?.title || "Standing by"], ["WORKSPACE", workspace], ["TOOLS", agent.tools], ["TASKS (SESSION)", String(tasks.length)], ["UPTIME", formatUptime()]],
    tasks: tasks.length ? tasks.slice(0, 9).map((task) => [task.status.toUpperCase(), task.title]) : [["QUEUE", "No tasks assigned in this session"]],
    tools: agent.tools.split(", ").map((tool, index) => [`TOOL ${index + 1}`, tool]),
    memory: [["SESSION", sessionId.slice(0, 12)], ["CONTEXT", `${tasks.length} task records`], ["PERSISTENCE", "Workspace state enabled"]],
    logs: state.activity.slice(-8).reverse().map((entry) => [clock(entry.at), entry.text]),
  };
  return base[state.activeTab] || base.details;
}

function renderSelectedAgent() {
  const agent = currentAgent();
  if (!agent) {
    $("#selected-name").textContent = "No agent selected";
    $("#selected-status").textContent = "unregistered";
    $("#selected-description").textContent = "Add an HTTP agent in Agent Registry";
    $("#selected-portrait span").textContent = "—";
    $(".agent-summary-copy .status-dot").classList.add("empty");
    $("#agent-details").innerHTML = `<div class="detail-row"><label>STATUS</label><span>No registered agents</span></div>`;
    $("#pause-button").disabled = true;
    $("#stop-button").disabled = true;
    return;
  }
  $("#pause-button").disabled = false;
  $("#stop-button").disabled = false;
  $(".agent-summary-copy .status-dot").classList.remove("empty");
  $("#selected-name").textContent = agent.name;
  $("#selected-status").textContent = agent.status;
  $("#selected-description").textContent = agent.description;
  $("#selected-portrait span").textContent = agent.name.slice(0, 1);
  $("#agent-details").innerHTML = detailRows(agent).map(([key, value]) => `<div class="detail-row"><label>${escapeHtml(key)}</label><span class="${key === "STATUS" && ["ready", "running"].includes(value) ? "green" : ""}">${escapeHtml(value)}</span></div>`).join("");
}

function renderActivity() {
  const node = $("#activity-log");
  const entries = state.activity.slice(-8);
  node.innerHTML = entries.length ? entries.map((entry) => `<div class="log-line"><time>${clock(entry.at)}</time><span class="${entry.tone}">${escapeHtml(entry.text)}</span></div>`).join("") : `<div class="log-line"><time>--:--:--</time><span>Office initialized. Waiting for a command.</span></div>`;
  node.scrollTop = node.scrollHeight;
}

function renderLogs() {
  const node = $("#system-log");
  const entries = state.logs.slice(-9);
  node.innerHTML = entries.length ? entries.map((entry) => `<div class="log-line"><time>${clock(entry.at)}</time><b>${escapeHtml(entry.source)}</b><span class="${entry.tone}">${escapeHtml(entry.text)}</span></div>`).join("") : `<div class="log-line"><time>--:--:--</time><b>System</b><span>No events recorded.</span></div>`;
  node.scrollTop = node.scrollHeight;
}

function taskCounts(tasks) {
  return Object.fromEntries(["all", "running", "pending", "completed", "failed"].map((status) => [status, status === "all" ? tasks.length : tasks.filter((task) => task.status === status).length]));
}

function renderTasks() {
  const tasks = allTasks();
  const counts = taskCounts(tasks);
  $$("#task-filters button").forEach((button) => {
    const filter = button.dataset.filter;
    button.textContent = `${filter.toUpperCase()} (${counts[filter]})`;
    button.classList.toggle("active", filter === state.taskFilter);
  });
  const filtered = state.taskFilter === "all" ? tasks : tasks.filter((task) => task.status === state.taskFilter);
  $("#task-body").innerHTML = filtered.length ? filtered.slice(0, 20).map((task, index) => `<tr>
    <td>${index + 1}</td><td title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</td><td>${escapeHtml(task.agent)}</td>
    <td class="status-${task.status}">${escapeHtml(task.status)}</td><td class="priority-${task.priority}">${escapeHtml(task.priority)}</td>
    <td><span class="progress-cell"><span class="progress"><i style="width:${task.progress}%"></i></span>${task.progress}%</span></td><td>${shortTime(task.createdAt)}</td>
  </tr>`).join("") : `<tr class="empty-row"><td colspan="7">NO TASKS IN THIS VIEW</td></tr>`;
  $("#metric-tasks").textContent = tasks.length;
  $("#metric-tasks-sub").textContent = `${counts.running} running`;
  renderSelectedAgent();
}

function renderTaskAgentOptions() {
  const select = $("#task-agent");
  if (!select) return;
  const selected = select.value || "auto";
  select.innerHTML = `<option value="auto">AUTO ASSIGN</option>${state.workers.map((worker) => `<option value="${escapeHtml(worker.name)}">${escapeHtml(worker.name)}</option>`).join("")}`;
  select.value = [...select.options].some((option) => option.value === selected) ? selected : "auto";
}

function renderMetrics() {
  const active = state.agents.filter((agent) => agent.status === "running").length;
  const toolCount = state.orchestrator?.tools?.length || 0;
  $("#metric-agents").textContent = state.agents.length;
  $("#metric-agents-sub").textContent = `${active} active`;
  $("#metric-tools").textContent = toolCount;
  $("#metric-tokens").textContent = state.tokenCount > 999 ? `${Math.round(state.tokenCount / 1000)}K` : state.tokenCount;
}

function formatUptime() {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function mergeConfiguredAgents(workers) {
  const previous = new Map(state.agents.map((agent) => [agent.name, agent]));
  const normalized = workers.map((worker, index) => {
    const matching = ROLE_AGENTS.find((agent) => agent.name.toLowerCase() === worker.name.toLowerCase());
    return { ...(matching || { role: "Remote Specialist", description: `Connected worker at ${worker.url}`, tools: "remote agent tools" }), name: worker.name, id: `worker-${index + 1}`, url: worker.url, configured: true, status: previous.get(worker.name)?.status || "ready" };
  });
  state.agents = normalized;
  if (!state.agents.some((agent) => agent.name === state.selectedAgent)) {
    state.selectedAgent = state.agents[0]?.name || null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function mutateAgent(method, payload) {
  const response = await fetch("/api/sub-agents", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function createTask(payload) {
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function refreshDashboard({ quiet = false } = {}) {
  try {
    const [health, subAgents] = await Promise.all([fetchJson("/api/health"), fetchJson("/api/sub-agents")]);
    state.health = health;
    state.orchestrator = subAgents.orchestrator;
    state.delegatedTasks = subAgents.tasks || [];
    state.workers = subAgents.workers || [];
    mergeConfiguredAgents(state.workers);
    $("#health-dot").className = "status-dot online";
    $("#health-text").textContent = "SYSTEM ONLINE";
    $("#office-meta").textContent = `${subAgents.workers?.length || 0} REMOTE WORKERS`;
    renderOffice(); renderAgentRegistry(); renderTaskAgentOptions(); renderMetrics(); renderTasks();
    if (!quiet) addLog("System", "Agent configuration synchronized", "success");
  } catch (error) {
    $("#health-dot").className = "status-dot offline";
    $("#health-text").textContent = "SYSTEM OFFLINE";
    if (!quiet) showToast(error.message, true);
  }
}

function setAgentState(name, status) {
  const agent = state.agents.find((entry) => entry.name === name);
  if (agent) agent.status = status;
  renderOffice(); renderSelectedAgent(); renderMetrics();
}

function updateRunningTask(changes) {
  const task = state.localTasks.find((entry) => entry.id === state.runningTaskId);
  if (task) Object.assign(task, changes);
  renderTasks();
}

function eventLabel(event) {
  const labels = {
    composer_start: "Refining task into an execution brief…",
    composer_complete: "Execution brief ready",
    start: "Coordinator started the workflow",
    turn_start: `Reasoning turn ${event.turn || ""}…`,
    tool_start: `Using ${event.name || "tool"}…`,
    tool_result: `${event.name || "Tool"} returned`,
    mcp_call: `Calling ${event.server || "MCP"}.${event.name || "tool"}`,
    validation: `Validation ${event.status || "updated"}`,
    final: "Final response composed",
  };
  return labels[event.type] || null;
}

function handleSocketMessage(message) {
  if (message.type === "ready") {
    state.socketReady = true;
    addLog("System", `Orchestrator connected · ${message.model}`, "success");
    return;
  }
  if (message.type === "info") { addActivity(message.message); return; }
  if (message.type === "tool") {
    addActivity(`Dispatching ${message.name}`, "tool");
    addLog("Coordinator", `Tool call: ${message.name}`, "tool");
    updateRunningTask({ progress: Math.min(88, (state.localTasks.find((task) => task.id === state.runningTaskId)?.progress || 22) + 13) });
    return;
  }
  if (message.type === "agent_event") {
    const label = eventLabel(message.event || {});
    if (label) addActivity(label, message.event?.type === "final" ? "success" : "");
    const usage = message.event?.usage || message.event?.serverResponse?.usage;
    if (usage) {
      state.tokenCount += Number(usage.total_tokens || usage.totalTokens || 0);
      renderMetrics();
    }
    return;
  }
  if (message.type === "run_paused") {
    state.paused = true; $("#pause-button").classList.add("paused"); $("#pause-button").textContent = "▶";
    addActivity("Workflow paused at a safe boundary");
    return;
  }
  if (message.type === "run_resumed") {
    state.paused = false; $("#pause-button").classList.remove("paused"); $("#pause-button").textContent = "Ⅱ";
    addActivity("Workflow resumed", "success");
    return;
  }
  if (message.type === "done") {
    updateRunningTask({ status: "completed", progress: 100, result: message.text });
    addActivity("✓ Task completed", "success");
    addLog("Coordinator", "Task completed successfully", "success");
    setAgentState("Coordinator", "ready");
    $("#streaming-label").textContent = "Complete";
    state.runningTaskId = null;
    showToast("Task completed. Select the task to inspect its status.");
    void refreshDashboard({ quiet: true });
    return;
  }
  if (message.type === "error") {
    updateRunningTask({ status: "failed", progress: 100, error: message.error });
    addActivity(`Error: ${message.error}`, "error");
    addLog("Coordinator", message.error, "error");
    setAgentState("Coordinator", "ready");
    $("#streaming-label").textContent = "Stopped";
    state.runningTaskId = null;
    showToast(message.error, true);
  }
}

function connectSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);
  state.socket = socket;
  socket.addEventListener("open", () => addLog("System", "Live orchestration channel opened", "success"));
  socket.addEventListener("message", (event) => {
    try { handleSocketMessage(JSON.parse(event.data)); } catch (error) { addLog("System", error.message, "error"); }
  });
  socket.addEventListener("close", () => {
    state.socketReady = false;
    if (state.runningTaskId) handleSocketMessage({ type: "error", error: "Orchestration channel disconnected." });
    setTimeout(connectSocket, 1800);
  });
  socket.addEventListener("error", () => { state.socketReady = false; });
}

$("#refresh-button").addEventListener("click", () => void refreshDashboard());
$("#pause-button").addEventListener("click", () => {
  if (!state.runningTaskId || !state.socketReady) { showToast("No active workflow to pause."); return; }
  state.socket.send(JSON.stringify({ type: state.paused ? "resume" : "pause", sessionId }));
});
$("#stop-button").addEventListener("click", () => {
  if (state.runningTaskId) { showToast("Runs stop at safe tool boundaries; pause first if needed."); return; }
  state.activity = []; renderActivity(); addLog("System", "Activity view cleared");
});

$$('.tabs button').forEach((button) => button.addEventListener("click", () => {
  state.activeTab = button.dataset.tab;
  $$(".tabs button").forEach((entry) => entry.classList.toggle("active", entry === button));
  renderSelectedAgent();
}));

const agentDialog = $("#agent-dialog");
function openAgentDialog(worker = null) {
  $("#agent-dialog-title").textContent = worker ? "EDIT AGENT" : "ADD AGENT";
  $("#agent-original-name").value = worker?.name || "";
  $("#agent-name").value = worker?.name || "";
  $("#agent-url").value = worker?.url || "";
  agentDialog.showModal();
  $("#agent-name").focus();
}

$("#add-agent-button").addEventListener("click", () => openAgentDialog());
$("#close-agent-dialog").addEventListener("click", () => agentDialog.close());
$("#cancel-agent").addEventListener("click", () => agentDialog.close());
agentDialog.addEventListener("click", (event) => {
  if (event.target === agentDialog) agentDialog.close();
});
$("#agent-registry-body").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-agent]");
  if (!button) return;
  const worker = state.workers.find((entry) => entry.name === button.dataset.agent);
  if (!worker) return;
  if (button.classList.contains("edit-agent")) {
    openAgentDialog(worker);
    return;
  }
  if (!window.confirm(`Delete agent “${worker.name}”?`)) return;
  button.disabled = true;
  try {
    await mutateAgent("DELETE", { name: worker.name });
    await refreshDashboard({ quiet: true });
    addLog("System", `Agent ${worker.name} deleted`, "success");
    showToast(`Deleted ${worker.name}.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});
$("#agent-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const originalName = $("#agent-original-name").value;
  const name = $("#agent-name").value.trim();
  const url = $("#agent-url").value.trim();
  const saveButton = $("#save-agent");
  saveButton.disabled = true;
  try {
    await mutateAgent(originalName ? "PUT" : "POST", { originalName, name, url });
    agentDialog.close();
    await refreshDashboard({ quiet: true });
    addLog("System", `Agent ${name} ${originalName ? "updated" : "added"}`, "success");
    showToast(`${name} ${originalName ? "updated" : "added"}.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    saveButton.disabled = false;
  }
});

const taskDialog = $("#task-dialog");
function openTaskDialog() {
  $("#task-title").value = "";
  $("#task-agent").value = "auto";
  $("#task-priority").value = "medium";
  taskDialog.showModal();
  $("#task-title").focus();
}

$("#add-task-button").addEventListener("click", openTaskDialog);
$("#close-task-dialog").addEventListener("click", () => taskDialog.close());
$("#cancel-task").addEventListener("click", () => taskDialog.close());
taskDialog.addEventListener("click", (event) => {
  if (event.target === taskDialog) taskDialog.close();
});
$("#task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const saveButton = $("#save-task");
  saveButton.disabled = true;
  try {
    const result = await createTask({
      title: $("#task-title").value.trim(),
      agent: $("#task-agent").value,
      priority: $("#task-priority").value,
    });
    taskDialog.close();
    await refreshDashboard({ quiet: true });
    const assigned = result.task.agent;
    setAgentState(assigned, "running");
    addActivity(`Assigned task to ${assigned}`, "success");
    addLog("Coordinator", `${result.autoAssigned ? "Auto-assigned" : "Assigned"} task to ${assigned}`, "success");
    showToast(`Task assigned to ${assigned}.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    saveButton.disabled = false;
  }
});

$$('#task-filters button').forEach((button) => button.addEventListener("click", () => {
  state.taskFilter = button.dataset.filter; renderTasks();
}));

const router = new Router({ fallback: PAGES.dashboard.path });
router.addRoute("/", () => renderPage("dashboard"));
Object.entries(PAGES).forEach(([section, page]) => {
  router.addRoute(page.path, () => renderPage(section));
});
$$('.nav-item').forEach((link) => link.addEventListener("click", (event) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  router.navigate(link.getAttribute("href"));
}));

setInterval(() => { $("#metric-uptime").textContent = formatUptime().slice(0, 5); renderSelectedAgent(); }, 1000);
setInterval(() => void refreshDashboard({ quiet: true }), 2500);

renderOffice(); renderAgentRegistry(); renderTaskAgentOptions(); renderActivity(); renderLogs(); renderTasks(); renderSelectedAgent(); renderMetrics();
router.start();
connectSocket();
void refreshDashboard();
