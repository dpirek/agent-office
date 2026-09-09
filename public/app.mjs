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
  chat: { path: "/chat", title: "Central Office" },
  agents: { path: "/agents", title: "Agents" },
  tasks: { path: "/tasks", title: "Tasks" },
  workspace: { path: "/workspace", title: "Workspace" },
  operations: { path: "/operations", title: "Operations" },
  memory: { path: "/memory", title: "Memory" },
  knowledge: { path: "/knowledge", title: "Knowledge", icon: "▧", heading: "Knowledge base", description: "Connected sources and selected skills provide shared context to the agent office." },
  settings: { path: "/settings", title: "Settings" },
};

const TOOL_DETAILS = {
  manage_office_tasks: ["Office tasks", "Read, create, and explicitly assign queued work."],
  read_office_memory: ["Office memory", "Read durable task and operation history."],
  list_files: ["List files", "Inspect workspace directory contents."],
  read_file: ["Read files", "Read files from the configured workspace."],
  write_file: ["Write files", "Create and update workspace files."],
  search_files: ["Search files", "Search workspace content and paths."],
  curl: ["HTTP requests", "Call external HTTP endpoints."],
  run_command: ["Run commands", "Execute approved workspace commands."],
  chrome_devtools: ["Chrome DevTools", "Inspect and validate browser-rendered output."],
  delegate_to_sub_agent: ["Delegate to agent", "Send independent work to registered agents."],
};

const state = {
  agents: [],
  selectedAgent: "Office Manager",
  activeTab: "details",
  taskFilter: "all",
  localTasks: [],
  officeTasks: [],
  workers: [],
  workerTokenConfigured: false,
  operations: [],
  systemPrompts: [],
  settingsTab: "prompts",
  toolPermissions: {},
  providerSettings: { provider: "openai", model: "", baseUrl: "", apiKey: "" },
  mcpConfig: "",
  mcpDirty: false,
  providerDirty: false,
  skills: [],
  memoryRecords: [],
  sharedWorkspaceRoot: "",
  sharedWorkspaceTree: [],
  chatMessages: [],
  officeChatMessages: [],
  officeChatMembers: [],
  chatRunning: false,
  selectedPromptKey: null,
  promptDirty: false,
  activity: [],
  logs: [],
  health: null,
  orchestrator: null,
  socket: null,
  socketReady: false,
  runningTaskId: null,
  paused: false,
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

function scheduleTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
  if (section === "chat") void loadOfficeChat({ quiet: true });
  if (section === "workspace") void loadSharedWorkspace({ quiet: true });
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
  return ["pending", "completed", "failed", "cancelled"].includes(status) ? status : "pending";
}

function allTasks() {
  const officeTasks = state.officeTasks.map((task) => ({
    id: task.id,
    title: task.title,
    agent: task.agent || "UNASSIGNED",
    status: normalizeTaskStatus(task.status),
    priority: task.priority || "medium",
    progress: task.status === "completed" ? 100 : task.status === "running" ? 55 : ["failed", "timed_out", "cancelled"].includes(task.status) ? 100 : 0,
    createdAt: task.createdAt,
    dependsOn: task.dependsOn || [],
    deliveredWork: task.deliveredWork || [],
  }));
  return [...state.localTasks, ...officeTasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function officeManagerAgent() {
  return {
    id: "office-manager",
    name: "Office Manager",
    role: "Internal Orchestrator",
    description: "Coordinates the office, manages tasks, and delegates work to registered agents",
    tools: state.orchestrator?.tools?.join(", ") || "office tasks, office memory",
    model: { name: state.orchestrator?.model || state.health?.model || "not configured" },
    status: state.chatRunning ? "running" : state.socketReady ? "ready" : "offline",
    internal: true,
  };
}

function officeAgents() {
  return [officeManagerAgent(), ...state.agents];
}

function currentAgent() {
  const agents = officeAgents();
  return agents.find((agent) => agent.name === state.selectedAgent) || agents[0];
}

function renderOffice() {
  const floor = $("#agent-floor");
  floor.innerHTML = officeAgents().slice(0, 6).map((agent) => `
    <button class="desk-agent ${agent.internal ? "manager" : ""} ${["ready", "running"].includes(agent.status) ? "online" : ""} ${agent.status === "running" ? "active" : ""} ${agent.name === state.selectedAgent ? "selected" : ""}" data-agent="${escapeHtml(agent.name)}" aria-label="Select ${escapeHtml(agent.name)}">
      <span class="monitor"><i></i></span>
      <span class="desk-top"><i class="keyboard"></i></span>
      <span class="chair"></span><span class="avatar"></span>
      <span class="nameplate"><i></i>${escapeHtml(agent.name)}</span>
    </button>`).join("");
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
      <td>${escapeHtml([...(worker.capabilities?.skills || []).map((skill) => skill.name), ...(worker.capabilities?.tools || [])].slice(0, 4).join(", ") || "REGISTERED")}</td>
    </tr>`).join("") : `<tr class="empty-row"><td colspan="3">WAITING FOR AUTHENTICATED WEBSOCKET WORKERS</td></tr>`;
}

function renderWorkerTokenState() {
  $("#worker-token-status").textContent = state.workerTokenConfigured ? "TOKEN CONFIGURED" : "TOKEN NOT SET";
  $("#generate-worker-token").textContent = state.workerTokenConfigured ? "REGENERATE TOKEN" : "GENERATE TOKEN";
}

function detailRows(agent) {
  const model = agent.model?.name || state.orchestrator?.model || state.health?.model || "not configured";
  const workspace = state.health?.workspace || "—";
  const tasks = allTasks().filter((task) => task.agent === agent.name);
  const runningTask = tasks.find((task) => task.status === "running");
  const currentTask = agent.internal && state.chatRunning ? "Handling office conversation" : runningTask?.title || "Standing by";
  const base = {
    details: [["ID", agent.id], ["ROLE", agent.role], ["MODEL", model], ["STATUS", agent.status], ["CURRENT TASK", currentTask], ["WORKSPACE", workspace], ["TOOLS", agent.tools], ["TASKS (SESSION)", String(tasks.length)], ["UPTIME", formatUptime()]],
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
    $("#selected-description").textContent = "Waiting for a WebSocket worker to connect";
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

function renderChat() {
  const node = $("#chat-messages");
  if (!node) return;
  node.innerHTML = state.chatMessages.length ? state.chatMessages.map((message) => `
    <article class="chat-message ${escapeHtml(message.role)}${message.streaming ? " streaming" : ""}${message.error ? " error" : ""}">
      <label>${message.role === "user" ? "YOU" : "OFFICE MANAGER"}</label>
      <p>${escapeHtml(message.text || (message.streaming ? "Thinking" : ""))}</p>
    </article>`).join("") : `<div class="chat-empty"><strong>START A CONVERSATION</strong><span>Ask the office manager to inspect, create, or assign work.</span></div>`;
  node.scrollTop = node.scrollHeight;
  const ready = state.socketReady && Boolean(state.health?.workspace);
  $("#chat-status").textContent = state.chatRunning ? "WORKING…" : ready ? "READY" : "CONNECTING";
  $("#send-chat").disabled = !ready || state.chatRunning;
  $("#chat-input").disabled = state.chatRunning;
}

function highlightMentions(text) {
  return escapeHtml(text).replace(/(^|\s)(@[a-z0-9][a-z0-9-]*)\b/gi, "$1<mark>$2</mark>");
}

function chatInitials(name) {
  return String(name || "?").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function chatAvatar(message) {
  if (message.kind === "user") {
    return `<svg class="human-avatar-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="3.25"></circle><path d="M5.5 20v-2.2c0-3.7 2.9-6.3 6.5-6.3s6.5 2.6 6.5 6.3V20z"></path></svg>`;
  }
  return escapeHtml(chatInitials(message.author));
}

function renderOfficeChat({ preserveScroll = false } = {}) {
  const members = $("#office-chat-members");
  members.innerHTML = state.officeChatMembers.map((member) => `
    <button class="office-chat-member" type="button" data-username="${escapeHtml(member.username)}" data-status="${escapeHtml(member.status)}" title="Mention @${escapeHtml(member.username)} · ${escapeHtml(member.status)}">
      <i></i><span><span class="office-chat-member-name"><strong>${escapeHtml(member.name)}</strong>${member.status === "is typing" ? `<em>is typing</em>` : member.status === "busy" ? `<em class="busy">busy</em>` : ""}</span><small>@${escapeHtml(member.username)}</small></span>
    </button>`).join("");
  $("#office-chat-member-count").textContent = `${state.officeChatMembers.length} MEMBER${state.officeChatMembers.length === 1 ? "" : "S"}`;

  const board = $("#office-board-messages");
  const wasAtBottom = board.scrollHeight - board.scrollTop - board.clientHeight < 70;
  const messages = state.officeChatMessages;
  board.innerHTML = messages.length ? messages.map((message) => `
    <article class="office-board-message ${escapeHtml(message.kind)}${message.streaming ? " streaming" : ""}">
      <div class="office-board-avatar"${message.kind === "user" ? ` title="You · Human"` : ""}>${chatAvatar(message)}</div>
      <div class="office-board-message-body">
        <div class="office-board-message-meta"><strong>${escapeHtml(message.author)}</strong><span>@${escapeHtml(message.username)} · ${shortTime(message.createdAt)}</span></div>
        <div class="office-board-message-text">${highlightMentions(message.text)}</div>
        ${message.artifacts?.length ? `<div class="office-board-artifacts">${message.artifacts.map((artifact) => `<a href="${escapeHtml(artifact.uri)}" target="_blank" rel="noopener noreferrer">↗ ${escapeHtml(artifact.name)}</a>`).join("")}</div>` : ""}
      </div>
    </article>`).join("") : `<div class="office-board-empty"><strong># CENTRAL-OFFICE IS READY</strong><span>Mention @office-manager or a registered agent to begin.</span></div>`;
  if (!preserveScroll || wasAtBottom) board.scrollTop = board.scrollHeight;
  $("#office-chat-status").textContent = "LIVE CHANNEL";
}

async function loadOfficeChat({ quiet = false } = {}) {
  try {
    const data = await fetchJson("/api/chat?limit=300");
    state.officeChatMessages = data.messages || [];
    state.officeChatMembers = data.members || [];
    renderOfficeChat({ preserveScroll: true });
  } catch (error) {
    if (!quiet) showToast(error.message, true);
  }
}

async function postOfficeChat(payload) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function resizeOfficeBoardInput() {
  const input = $("#office-board-input");
  input.style.height = "31px";
  input.style.height = `${Math.min(130, Math.max(31, input.scrollHeight))}px`;
}

function currentChatReply() {
  return [...state.chatMessages].reverse().find((message) => message.role === "agent" && message.streaming);
}

function resizeChatInput() {
  const input = $("#chat-input");
  if (!input) return;
  input.style.height = "36px";
  const height = Math.min(Math.max(input.scrollHeight, 36), 160);
  input.style.height = `${height}px`;
  input.style.overflowY = input.scrollHeight > 160 ? "auto" : "hidden";
}

function taskCounts(tasks) {
  return Object.fromEntries(["all", "running", "pending", "completed", "failed", "cancelled"].map((status) => [status, status === "all" ? tasks.length : tasks.filter((task) => task.status === status).length]));
}

function renderTasks() {
  const tasks = allTasks();
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const counts = taskCounts(tasks);
  $$("#task-filters button").forEach((button) => {
    const filter = button.dataset.filter;
    button.textContent = `${filter.toUpperCase()} (${counts[filter]})`;
    button.classList.toggle("active", filter === state.taskFilter);
  });
  const filtered = state.taskFilter === "all" ? tasks : tasks.filter((task) => task.status === state.taskFilter);
  $("#task-body").innerHTML = filtered.length ? filtered.slice(0, 20).map((task, index) => {
    const dependencies = task.dependsOn || [];
    const waiting = dependencies.filter((id) => tasksById.get(id)?.status !== "completed");
    const dependencyState = dependencies.length === 0 ? "READY" : waiting.length ? `WAITING ${waiting.length}` : "MET";
    const dependencyTitle = dependencies.map((id) => tasksById.get(id)?.title || id).join(", ");
    return `<tr>
    <td>${index + 1}</td><td title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</td><td>${escapeHtml(task.agent)}</td>
    <td class="status-${task.status}">${escapeHtml(task.status)}</td><td class="priority-${task.priority}">${escapeHtml(task.priority)}</td>
    <td title="${escapeHtml(dependencyTitle)}">${dependencyState}</td>
    <td><span class="progress-cell"><span class="progress"><i style="width:${task.progress}%"></i></span>${task.progress}%</span></td><td>${shortTime(task.createdAt)}</td>
    <td class="delivered-work">${task.deliveredWork?.length ? task.deliveredWork.map((work) => `<a href="${escapeHtml(work.uri)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(work.mimeType)}">↗ ${escapeHtml(work.name)}</a>`).join("") : "—"}</td>
    <td>${task.status === "running" ? `<button class="stop-task" data-task-id="${escapeHtml(task.id)}" type="button">STOP</button>` : "—"}</td>
  </tr>`;
  }).join("") : `<tr class="empty-row"><td colspan="10">NO TASKS IN THIS VIEW</td></tr>`;
  renderSelectedAgent();
}

function workspaceFiles(nodes, prefix = "") {
  return nodes.flatMap((node) => node.type === "file"
    ? [{ ...node, nestedPath: prefix ? `${prefix}/${node.name}` : node.name }]
    : workspaceFiles(node.children || [], prefix ? `${prefix}/${node.name}` : node.name));
}

function renderSharedWorkspace() {
  const root = $("#shared-workspace-root");
  const browser = $("#shared-workspace-browser");
  if (!root || !browser) return;
  const files = workspaceFiles(state.sharedWorkspaceTree);
  root.textContent = state.sharedWorkspaceRoot || "—";
  root.title = state.sharedWorkspaceRoot || "";
  $("#workspace-file-count").textContent = `${files.length} FILE${files.length === 1 ? "" : "S"}`;
  const folders = state.sharedWorkspaceTree.filter((entry) => entry.type === "directory");
  const rootFiles = state.sharedWorkspaceTree.filter((entry) => entry.type === "file");
  const groups = [...(rootFiles.length ? [{ name: "SHARED ROOT", children: rootFiles }] : []), ...folders];
  browser.innerHTML = groups.length ? groups.map((folder) => {
    const entries = workspaceFiles(folder.children || []);
    return `<section class="workspace-folder">
      <header><div><span>▤</span><strong>${escapeHtml(folder.name)}</strong></div><small>${entries.length} FILE${entries.length === 1 ? "" : "S"}</small></header>
      <div class="workspace-folder-files">${entries.length ? entries.map((file) => `<a class="workspace-file" href="/api/shared-workspace-file?path=${encodeURIComponent(file.path)}" target="_blank" rel="noopener noreferrer"><span>▱</span><strong>${escapeHtml(file.nestedPath)}</strong><small>${formatBytes(file.size)}</small><time>${scheduleTime(file.modifiedAt)}</time><b>OPEN ↗</b></a>`).join("") : `<div class="workspace-empty-folder">EMPTY TASK FOLDER</div>`}</div>
    </section>`;
  }).join("") : `<div class="workspace-empty"><strong>NO DELIVERED FILES</strong><span>Completed worker artifacts will appear here in task-specific folders.</span></div>`;
}

async function loadSharedWorkspace({ quiet = false } = {}) {
  try {
    const data = await fetchJson("/api/shared-workspace");
    state.sharedWorkspaceRoot = data.root || "";
    state.sharedWorkspaceTree = data.tree || [];
    renderSharedWorkspace();
  } catch (error) {
    if (!quiet) showToast(error.message, true);
  }
}

function renderOperationAgentOptions() {
  const select = $("#operation-agent");
  if (!select) return;
  const selected = select.value || "auto";
  select.innerHTML = `<option value="auto">AUTO ASSIGN</option>${state.workers.map((worker) => `<option value="${escapeHtml(worker.name)}">${escapeHtml(worker.name)}</option>`).join("")}`;
  select.value = [...select.options].some((option) => option.value === selected) ? selected : "auto";
}

function renderOperations() {
  const body = $("#operations-body");
  if (!body) return;
  const active = state.operations.filter((operation) => operation.enabled).length;
  $("#operations-active-count").textContent = `${active} ACTIVE`;
  body.innerHTML = state.operations.length ? state.operations.map((operation) => {
    const stateClass = !operation.enabled ? "disabled" : operation.lastStatus === "failed" ? "failed" : "";
    const stateLabel = operation.enabled ? operation.lastStatus || "SCHEDULED" : "DISABLED";
    return `<tr>
      <td><span class="operation-name"><strong>${escapeHtml(operation.name)}</strong><small title="${escapeHtml(operation.task)}">${escapeHtml(operation.task)}</small></span></td>
      <td>EVERY ${operation.intervalValue} ${escapeHtml(operation.intervalUnit).toUpperCase()}</td>
      <td>${operation.agent === "auto" ? "AUTO ASSIGN" : escapeHtml(operation.agent)}</td>
      <td class="priority-${escapeHtml(operation.priority)}">${escapeHtml(operation.priority)}</td>
      <td>${scheduleTime(operation.lastRunAt)}</td><td>${operation.enabled ? scheduleTime(operation.nextRunAt) : "—"}</td>
      <td><span class="operation-state ${stateClass}">${escapeHtml(stateLabel)}</span></td>
      <td><span class="operation-actions"><button class="toggle-operation" data-operation="${escapeHtml(operation.id)}">${operation.enabled ? "DISABLE" : "ENABLE"}</button><button class="edit-operation" data-operation="${escapeHtml(operation.id)}">EDIT</button><button class="delete-operation" data-operation="${escapeHtml(operation.id)}">DELETE</button></span></td>
    </tr>`;
  }).join("") : `<tr class="empty-row"><td colspan="8">NO PERIODIC OPERATIONS DEFINED</td></tr>`;
}

function currentSystemPrompt() {
  return state.systemPrompts.find((prompt) => prompt.key === state.selectedPromptKey) || null;
}

function renderSettingsStatus() {
  const status = $("#settings-status");
  if (!status) return;
  if (state.settingsTab === "tools") {
    const enabled = Object.values(state.toolPermissions).filter(Boolean).length;
    status.textContent = `${enabled} TOOLS ENABLED`;
  } else if (state.settingsTab === "mcp") {
    status.textContent = state.mcpDirty ? "UNSAVED CHANGES" : "SAVED";
  } else if (state.settingsTab === "provider") {
    status.textContent = state.providerDirty ? "UNSAVED CHANGES" : "SAVED";
  } else {
    status.textContent = state.promptDirty ? "UNSAVED CHANGES" : currentSystemPrompt() ? "SAVED" : "SELECT A PROMPT";
  }
}

function selectSettingsTab(tab) {
  if (!['prompts', 'tools', 'mcp', 'provider'].includes(tab)) return;
  state.settingsTab = tab;
  $$('[data-settings-tab]').forEach((button) => {
    const active = button.dataset.settingsTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('[data-settings-view]').forEach((view) => { view.hidden = view.dataset.settingsView !== tab; });
  renderSettingsStatus();
}

function renderToolPermissions() {
  const container = $("#tool-permissions");
  if (!container) return;
  container.innerHTML = Object.entries(state.toolPermissions).map(([name, enabled]) => {
    const [label, description] = TOOL_DETAILS[name] || [name.replaceAll('_', ' '), 'Internal office manager tool.'];
    return `<label class="tool-permission"><input type="checkbox" data-tool-permission="${escapeHtml(name)}" ${enabled ? 'checked' : ''}><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(description)}</small></span></label>`;
  }).join('') || `<div class="office-empty"><strong>NO TOOLS AVAILABLE</strong></div>`;
  renderSettingsStatus();
}

function providerFormValue() {
  return {
    provider: $("#provider-type").value,
    model: $("#provider-model").value.trim(),
    baseUrl: $("#provider-base-url").value.trim(),
    apiKey: $("#provider-api-key").value.trim(),
  };
}

function setProviderModelOptions(models = [], selected = "") {
  const select = $("#provider-model");
  const values = [...new Set(models.map((model) => String(model).trim()).filter(Boolean))];
  if (selected && !values.includes(selected)) values.unshift(selected);
  select.innerHTML = values.length
    ? values.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join("")
    : `<option value="">REFRESH MODELS TO SELECT</option>`;
  select.value = selected && values.includes(selected) ? selected : values[0] || "";
}

function populateProviderForm() {
  $("#provider-type").value = state.providerSettings.provider || "openai";
  setProviderModelOptions([], state.providerSettings.model || "");
  $("#provider-base-url").value = state.providerSettings.baseUrl || "";
  $("#provider-api-key").value = state.providerSettings.apiKey || "";
  $("#provider-model-status").textContent = state.providerSettings.model ? "SAVED MODEL SELECTED" : "REFRESH MODELS TO BEGIN";
  state.providerDirty = false;
  renderSettingsStatus();
}

async function refreshProviderModels() {
  const button = $("#refresh-provider-models");
  const status = $("#provider-model-status");
  const settings = providerFormValue();
  button.disabled = true;
  status.textContent = "LOADING MODELS…";
  try {
    const response = await fetch("/api/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (!data.models?.length) throw new Error("The provider returned no models.");
    setProviderModelOptions(data.models, settings.model);
    state.providerDirty = JSON.stringify(providerFormValue()) !== JSON.stringify(state.providerSettings);
    status.textContent = `${data.models.length} MODELS AVAILABLE`;
    showToast(`${data.models.length} models loaded.`);
  } catch (error) {
    status.textContent = "MODEL REFRESH FAILED";
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    renderSettingsStatus();
  }
}

function renderSystemPrompts() {
  const list = $("#prompt-list");
  if (!list) return;
  list.innerHTML = state.systemPrompts.length ? state.systemPrompts.map((prompt) => `
    <button type="button" data-prompt="${escapeHtml(prompt.key)}" class="${prompt.key === state.selectedPromptKey ? "active" : ""}">
      <strong>${escapeHtml(prompt.title)}</strong><small>${escapeHtml(prompt.key)}</small>
    </button>`).join("") : `<div class="office-empty"><strong>NO SYSTEM PROMPTS</strong></div>`;
  const prompt = currentSystemPrompt();
  $("#prompt-editor-title").textContent = prompt?.title || "Select a system prompt";
  $("#prompt-editor-key").textContent = prompt?.key || "—";
  $("#system-prompt-content").disabled = !prompt;
  $("#reset-system-prompt").disabled = !prompt || !state.promptDirty;
  $("#save-system-prompt").disabled = !prompt || !state.promptDirty;
  renderSettingsStatus();
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function renderSkills() {
  const body = $("#skills-body");
  if (!body) return;
  const enabled = state.skills.filter((skill) => skill.selected).length;
  $("#enabled-skills-count").textContent = `${enabled} ENABLED`;
  body.innerHTML = state.skills.length ? state.skills.map((skill) => `<tr>
    <td><input class="skill-toggle" type="checkbox" data-skill="${escapeHtml(skill.id)}" ${skill.selected ? "checked" : ""} aria-label="Enable ${escapeHtml(skill.name)}"></td>
    <td><strong class="skill-name">${escapeHtml(skill.name)}</strong></td>
    <td><span class="skill-file">${escapeHtml(skill.name)}/SKILL.md</span></td>
    <td>${formatBytes(new Blob([skill.content]).size)}</td>
    <td>${scheduleTime(skill.updatedAt)}</td>
    <td><button class="skill-delete" type="button" data-skill="${escapeHtml(skill.id)}">DELETE</button></td>
  </tr>`).join("") : `<tr class="empty-row"><td colspan="6">NO SKILL FILES ADDED</td></tr>`;
}

function renderMemory() {
  const body = $("#memory-body");
  if (!body) return;
  $("#memory-record-count").textContent = `${state.memoryRecords.length} RECORD${state.memoryRecords.length === 1 ? "" : "S"}`;
  body.innerHTML = state.memoryRecords.length ? state.memoryRecords.map((record) => `<tr>
    <td>${scheduleTime(record.occurredAt)}</td>
    <td>${escapeHtml(record.kind)}</td>
    <td class="memory-status-${escapeHtml(record.status)}">${escapeHtml(record.status)}</td>
    <td>${escapeHtml(record.agent || "—")}</td>
    <td class="memory-work"><strong>${escapeHtml(record.title)}</strong><span title="${escapeHtml(record.summary)}">${escapeHtml(record.summary || "No summary was recorded.")}</span></td>
    <td class="memory-artifacts">${record.artifacts?.length ? record.artifacts.map((artifact) => `<a href="${escapeHtml(artifact.uri)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(artifact.mimeType || "artifact")}">↗ ${escapeHtml(artifact.name || artifact.artifactName || "Delivered work")}</a>`).join("") : "—"}</td>
  </tr>`).join("") : `<tr class="empty-row"><td colspan="6">NO COMPLETED OR FAILED WORK RECORDED YET</td></tr>`;
}

function selectSystemPrompt(key, { force = false } = {}) {
  if (!force && state.promptDirty && !window.confirm("Discard unsaved system prompt changes?")) return;
  const prompt = state.systemPrompts.find((entry) => entry.key === key);
  if (!prompt) return;
  state.selectedPromptKey = prompt.key;
  state.promptDirty = false;
  $("#system-prompt-content").value = prompt.content;
  renderSystemPrompts();
}

async function loadSystemPrompts() {
  try {
    const data = await fetchJson("/api/system-prompts");
    state.systemPrompts = data.prompts || [];
    const selected = state.systemPrompts.some((prompt) => prompt.key === state.selectedPromptKey)
      ? state.selectedPromptKey
      : state.systemPrompts[0]?.key;
    if (selected) selectSystemPrompt(selected, { force: true });
    else renderSystemPrompts();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadConfigurationSettings() {
  try {
    const [uiState, mcp] = await Promise.all([fetchJson("/api/ui-state"), fetchJson("/api/config")]);
    state.toolPermissions = uiState.state?.toolPermissions || {};
    state.providerSettings = { ...state.providerSettings, ...(uiState.state?.providerSettings || {}) };
    state.mcpConfig = mcp.content || "";
    state.mcpDirty = false;
    $("#mcp-config-content").value = state.mcpConfig;
    renderToolPermissions();
    populateProviderForm();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function saveUiState(statePatch) {
  const response = await fetch("/api/ui-state", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: statePatch }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function loadSkills() {
  try {
    const data = await fetchJson("/api/skills");
    state.skills = data.skills || [];
    renderSkills();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadMemory({ quiet = false } = {}) {
  try {
    const data = await fetchJson("/api/memory?limit=200");
    state.memoryRecords = data.records || [];
    renderMemory();
  } catch (error) {
    if (!quiet) showToast(error.message, true);
  }
}

async function mutateSkills(method, payload) {
  const response = await fetch("/api/skills", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  state.skills = data.skills || [];
  renderSkills();
  return data;
}

function skillNameFromFile(file, content) {
  const frontMatter = /^---\n([\s\S]*?)\n---/.exec(content)?.[1] || "";
  const declared = /^name\s*:\s*([^\n]+)$/m.exec(frontMatter)?.[1]?.trim();
  const candidate = declared || file.name.replace(/\.[^.]+$/, "");
  return candidate.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

async function saveSystemPrompt() {
  const prompt = currentSystemPrompt();
  if (!prompt) return;
  const content = $("#system-prompt-content").value;
  const response = await fetch("/api/system-prompts", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: prompt.key, content }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  prompt.content = content;
  state.promptDirty = false;
  renderSystemPrompts();
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
    const skill = worker.capabilities?.skills?.[0];
    return {
      ...(matching || {}),
      name: worker.name,
      role: skill?.name || matching?.role || "Remote Specialist",
      description: worker.description || skill?.description || matching?.description || `Connected worker at ${worker.url}`,
      tools: worker.capabilities?.tools?.length ? worker.capabilities.tools.join(", ") : matching?.tools || "remote agent tools",
      model: worker.model,
      capabilities: worker.capabilities,
      id: `worker-${index + 1}`,
      url: worker.url,
      configured: true,
      status: previous.get(worker.name)?.status || "ready",
    };
  });
  state.agents = normalized;
  if (!officeAgents().some((agent) => agent.name === state.selectedAgent)) {
    state.selectedAgent = "Office Manager";
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
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

async function stopTask(id) {
  const response = await fetch("/api/tasks", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function mutateOperation(method, payload) {
  const response = await fetch("/api/operations", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  state.operations = data.operations || [];
  renderOperations();
  return data;
}

async function refreshDashboard({ quiet = false } = {}) {
  try {
    const [health, subAgents, operations, officeTasks] = await Promise.all([
      fetchJson("/api/health"),
      fetchJson("/api/sub-agents"),
      fetchJson("/api/operations"),
      fetchJson("/api/tasks"),
    ]);
    state.health = health;
    $("#header-context").textContent = `v${health.version || "0.0.0"} · Workspace ${health.workspace || "—"}`;
    state.orchestrator = subAgents.orchestrator;
    state.officeTasks = officeTasks.tasks || [];
    state.workers = subAgents.workers || [];
    state.workerTokenConfigured = subAgents.workerTokenConfigured === true;
    state.operations = operations.operations || [];
    mergeConfiguredAgents(state.workers);
    $("#health-dot").className = "status-dot online";
    $("#health-text").textContent = "SYSTEM ONLINE";
    $("#office-meta").textContent = `1 MANAGER · ${subAgents.workers?.length || 0} REMOTE WORKERS`;
    renderOffice(); renderAgentRegistry(); renderWorkerTokenState(); renderOperationAgentOptions(); renderOperations(); renderTasks();
    renderChat();
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
  renderOffice(); renderSelectedAgent();
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
    renderChat(); renderOffice(); renderSelectedAgent();
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
    return;
  }
  if (message.type === "answer_start") {
    if (!currentChatReply()) state.chatMessages.push({ role: "agent", text: "", streaming: true });
    renderChat();
    return;
  }
  if (message.type === "answer_delta") {
    let reply = currentChatReply();
    if (!reply) {
      reply = { role: "agent", text: "", streaming: true };
      state.chatMessages.push(reply);
    }
    reply.text += message.text || "";
    renderChat();
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
    if (state.chatRunning) {
      const reply = currentChatReply() || { role: "agent", text: "", streaming: true };
      if (!state.chatMessages.includes(reply)) state.chatMessages.push(reply);
      reply.text = message.text || reply.text || "Done.";
      reply.streaming = false;
      state.chatRunning = false;
      addActivity("Office manager response complete", "success");
      renderChat(); renderOffice(); renderSelectedAgent();
      $("#chat-input").focus();
      return;
    }
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
    if (state.chatRunning) {
      const reply = currentChatReply() || { role: "agent", text: "", streaming: true };
      if (!state.chatMessages.includes(reply)) state.chatMessages.push(reply);
      reply.text = message.error || "The office manager could not complete the request.";
      reply.streaming = false;
      reply.error = true;
      state.chatRunning = false;
      addLog("Coordinator", reply.text, "error");
      renderChat(); renderOffice(); renderSelectedAgent();
      return;
    }
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
    if (state.runningTaskId || state.chatRunning) handleSocketMessage({ type: "error", error: "Orchestration channel disconnected." });
    renderChat(); renderOffice(); renderSelectedAgent();
    setTimeout(connectSocket, 1800);
  });
  socket.addEventListener("error", () => { state.socketReady = false; });
}

function refreshOrchestratorConnection() {
  if (!state.runningTaskId && !state.chatRunning && state.socket && state.socket.readyState < WebSocket.CLOSING) {
    state.socket.close(1000, "Configuration changed");
  }
}

$("#refresh-button").addEventListener("click", () => void refreshDashboard());
$("#pause-button").addEventListener("click", () => {
  if ((!state.runningTaskId && !state.chatRunning) || !state.socketReady) { showToast("No active workflow to pause."); return; }
  state.socket.send(JSON.stringify({ type: state.paused ? "resume" : "pause", sessionId }));
});
$("#stop-button").addEventListener("click", () => {
  if (state.runningTaskId || state.chatRunning) { showToast("Runs stop at safe tool boundaries; pause first if needed."); return; }
  state.activity = []; renderActivity(); addLog("System", "Activity view cleared");
});

$("#chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#chat-input");
  const prompt = input.value.trim();
  if (!prompt) return;
  if (!state.socketReady || !state.health?.workspace) {
    showToast("The office manager is still connecting.", true);
    return;
  }
  if (state.chatRunning) {
    showToast("Wait for the current response to finish.");
    return;
  }
  const history = state.chatMessages
    .filter((message) => !message.streaming && !message.error && message.text)
    .map(({ role, text }) => ({ role, text }));
  state.chatMessages.push(
    { role: "user", text: prompt },
    { role: "agent", text: "", streaming: true },
  );
  state.chatRunning = true;
  input.value = "";
  resizeChatInput();
  renderChat(); renderOffice(); renderSelectedAgent();
  addActivity("Office manager received a message");
  try {
    state.socket.send(JSON.stringify({
      type: "prompt",
      prompt,
      history,
      sessionId,
      workspace: state.health.workspace,
    }));
  } catch (error) {
    handleSocketMessage({ type: "error", error: error.message });
  }
});
$("#chat-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("#chat-form").requestSubmit();
  }
});
$("#chat-input").addEventListener("input", resizeChatInput);

$("#office-board-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#office-board-input");
  const prompt = input.value.trim();
  if (!prompt) return;
  if (state.chatRunning) {
    showToast("Wait for the office manager's current response to finish.");
    return;
  }
  const sendButton = $("#office-board-send");
  sendButton.disabled = true;
  try {
    const result = await postOfficeChat({ text: prompt });
    input.value = "";
    resizeOfficeBoardInput();
    await loadOfficeChat({ quiet: true });
    const failed = result.dispatches?.filter((dispatch) => !dispatch.ok) || [];
    if (failed.length) showToast(failed.map((dispatch) => dispatch.error).join(" · "), true);
    if (result.managerMentioned) showToast("Office manager notified.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    sendButton.disabled = false;
  }
});
$("#office-board-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("#office-board-form").requestSubmit();
  }
});
$("#office-board-input").addEventListener("input", resizeOfficeBoardInput);
$("#office-chat-members").addEventListener("click", (event) => {
  const member = event.target.closest(".office-chat-member[data-username]");
  if (!member) return;
  const input = $("#office-board-input");
  const mention = `@${member.dataset.username} `;
  input.value = input.value ? `${input.value.trimEnd()} ${mention}` : mention;
  resizeOfficeBoardInput();
  input.focus();
});

$$('.tabs button').forEach((button) => button.addEventListener("click", () => {
  state.activeTab = button.dataset.tab;
  $$(".tabs button").forEach((entry) => entry.classList.toggle("active", entry === button));
  renderSelectedAgent();
}));

const workerTokenDialog = $("#worker-token-dialog");
$("#generate-worker-token").addEventListener("click", async () => {
  const button = $("#generate-worker-token");
  button.disabled = true;
  try {
    const response = await fetch("/api/worker-token", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    state.workerTokenConfigured = true;
    renderWorkerTokenState();
    $("#worker-token-value").value = data.token;
    workerTokenDialog.showModal();
    $("#worker-token-value").select();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});
$("#copy-worker-token").addEventListener("click", async () => {
  const token = $("#worker-token-value").value;
  try {
    await navigator.clipboard.writeText(token);
  } catch {
    $("#worker-token-value").select();
    document.execCommand("copy");
  }
  showToast("Worker token copied.");
});
workerTokenDialog.addEventListener("close", () => { $("#worker-token-value").value = ""; });

const taskDialog = $("#task-dialog");
function openTaskDialog() {
  $("#task-title").value = "";
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
      priority: $("#task-priority").value,
    });
    taskDialog.close();
    await refreshDashboard({ quiet: true });
    addActivity(`Created unassigned task: ${result.task.title}`, "success");
    addLog("Coordinator", "Task created and waiting for office manager assignment", "success");
    showToast("Task created and left unassigned.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    saveButton.disabled = false;
  }
});

$("#task-body").addEventListener("click", async (event) => {
  const button = event.target.closest(".stop-task[data-task-id]");
  if (!button) return;
  const task = allTasks().find((entry) => entry.id === button.dataset.taskId);
  if (!window.confirm(`Stop “${task?.title || "this task"}”? The worker will be instructed to terminate its work.`)) return;
  button.disabled = true;
  try {
    await stopTask(button.dataset.taskId);
    await refreshDashboard({ quiet: true });
    addActivity(`Stopped task: ${task?.title || button.dataset.taskId}`, "error");
    showToast("Task stopped.");
  } catch (error) {
    button.disabled = false;
    showToast(error.message, true);
  }
});

const operationDialog = $("#operation-dialog");
function openOperationDialog(operation = null) {
  $("#operation-dialog-title").textContent = operation ? "EDIT PERIODIC OPERATION" : "NEW PERIODIC OPERATION";
  $("#operation-id").value = operation?.id || "";
  $("#operation-name").value = operation?.name || "";
  $("#operation-task").value = operation?.task || "";
  renderOperationAgentOptions();
  $("#operation-agent").value = operation?.agent || "auto";
  $("#operation-interval").value = operation?.intervalValue || 1;
  $("#operation-unit").value = operation?.intervalUnit || "hours";
  $("#operation-priority").value = operation?.priority || "medium";
  $("#operation-enabled").checked = operation?.enabled !== false;
  operationDialog.showModal();
  $("#operation-name").focus();
}

function operationPayload(operation, changes = {}) {
  return {
    id: operation.id,
    name: operation.name,
    task: operation.task,
    agent: operation.agent,
    intervalValue: operation.intervalValue,
    intervalUnit: operation.intervalUnit,
    priority: operation.priority,
    enabled: operation.enabled,
    ...changes,
  };
}

$("#add-operation-button").addEventListener("click", () => openOperationDialog());
$("#close-operation-dialog").addEventListener("click", () => operationDialog.close());
$("#cancel-operation").addEventListener("click", () => operationDialog.close());
operationDialog.addEventListener("click", (event) => {
  if (event.target === operationDialog) operationDialog.close();
});
$("#operation-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#operation-id").value;
  const saveButton = $("#save-operation");
  saveButton.disabled = true;
  try {
    await mutateOperation(id ? "PUT" : "POST", {
      id,
      name: $("#operation-name").value.trim(),
      task: $("#operation-task").value.trim(),
      agent: $("#operation-agent").value,
      intervalValue: Number($("#operation-interval").value),
      intervalUnit: $("#operation-unit").value,
      priority: $("#operation-priority").value,
      enabled: $("#operation-enabled").checked,
    });
    operationDialog.close();
    addLog("Scheduler", `${id ? "Updated" : "Created"} periodic operation`, "success");
    showToast(`Periodic operation ${id ? "updated" : "created"}.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    saveButton.disabled = false;
  }
});
$("#operations-body").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-operation]");
  if (!button) return;
  const operation = state.operations.find((entry) => entry.id === button.dataset.operation);
  if (!operation) return;
  if (button.classList.contains("edit-operation")) {
    openOperationDialog(operation);
    return;
  }
  if (button.classList.contains("delete-operation")) {
    if (!window.confirm(`Delete periodic operation “${operation.name}”?`)) return;
    try {
      await mutateOperation("DELETE", { id: operation.id });
      showToast(`Deleted ${operation.name}.`);
    } catch (error) { showToast(error.message, true); }
    return;
  }
  try {
    await mutateOperation("PUT", operationPayload(operation, { enabled: !operation.enabled }));
    showToast(`${operation.name} ${operation.enabled ? "disabled" : "enabled"}.`);
  } catch (error) { showToast(error.message, true); }
});

$("#prompt-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-prompt]");
  if (button) selectSystemPrompt(button.dataset.prompt);
});
$("#system-prompt-content").addEventListener("input", () => {
  const prompt = currentSystemPrompt();
  state.promptDirty = Boolean(prompt && $("#system-prompt-content").value !== prompt.content);
  renderSystemPrompts();
});
$("#reset-system-prompt").addEventListener("click", () => {
  const prompt = currentSystemPrompt();
  if (!prompt) return;
  $("#system-prompt-content").value = prompt.content;
  state.promptDirty = false;
  renderSystemPrompts();
});
$("#save-system-prompt").addEventListener("click", async () => {
  const button = $("#save-system-prompt");
  button.disabled = true;
  try {
    await saveSystemPrompt();
    refreshOrchestratorConnection();
    addLog("System", `Saved system prompt ${state.selectedPromptKey}`, "success");
    showToast("System prompt saved.");
  } catch (error) {
    showToast(error.message, true);
    renderSystemPrompts();
  }
});

$(".settings-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-settings-tab]");
  if (button) selectSettingsTab(button.dataset.settingsTab);
});
$("#tool-permissions").addEventListener("change", async (event) => {
  const checkbox = event.target.closest("input[data-tool-permission]");
  if (!checkbox) return;
  const name = checkbox.dataset.toolPermission;
  const previous = state.toolPermissions[name];
  state.toolPermissions[name] = checkbox.checked;
  checkbox.disabled = true;
  renderSettingsStatus();
  try {
    await saveUiState({ toolPermissions: state.toolPermissions });
    refreshOrchestratorConnection();
    addLog("Settings", `${TOOL_DETAILS[name]?.[0] || name} ${checkbox.checked ? "enabled" : "disabled"}`, "success");
    showToast(`Tool ${checkbox.checked ? "enabled" : "disabled"}.`);
  } catch (error) {
    state.toolPermissions[name] = previous;
    checkbox.checked = previous;
    showToast(error.message, true);
  } finally {
    checkbox.disabled = false;
    renderSettingsStatus();
  }
});
$("#mcp-config-content").addEventListener("input", () => {
  state.mcpDirty = $("#mcp-config-content").value !== state.mcpConfig;
  renderSettingsStatus();
});
$("#reset-mcp-config").addEventListener("click", () => {
  $("#mcp-config-content").value = state.mcpConfig;
  state.mcpDirty = false;
  renderSettingsStatus();
});
$("#save-mcp-config").addEventListener("click", async () => {
  const button = $("#save-mcp-config");
  const content = $("#mcp-config-content").value.trim();
  button.disabled = true;
  try {
    if (content) JSON.parse(content);
    const response = await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    state.mcpConfig = content;
    state.mcpDirty = false;
    refreshOrchestratorConnection();
    addLog("Settings", "MCP configuration saved", "success");
    showToast("MCP configuration saved.");
  } catch (error) {
    showToast(error instanceof SyntaxError ? `Invalid MCP JSON: ${error.message}` : error.message, true);
  } finally {
    button.disabled = false;
    renderSettingsStatus();
  }
});
$("#provider-form").addEventListener("input", (event) => {
  state.providerDirty = JSON.stringify(providerFormValue()) !== JSON.stringify(state.providerSettings);
  if (event.target.id !== "provider-model") $("#provider-model-status").textContent = "REFRESH MODELS TO UPDATE";
  renderSettingsStatus();
});
$("#refresh-provider-models").addEventListener("click", () => void refreshProviderModels());
$("#reset-provider").addEventListener("click", populateProviderForm);
$("#provider-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#save-provider");
  const settings = providerFormValue();
  button.disabled = true;
  try {
    await saveUiState({ providerSettings: settings });
    state.providerSettings = settings;
    state.providerDirty = false;
    refreshOrchestratorConnection();
    addLog("Settings", `Provider saved · ${settings.provider}/${settings.model}`, "success");
    showToast("Provider settings saved.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    renderSettingsStatus();
  }
});

$("#add-skill-file-button").addEventListener("click", () => $("#skill-file-input").click());
$("#skill-file-input").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  event.target.value = "";
  if (!files.length) return;
  const errors = [];
  let added = 0;
  for (const file of files) {
    try {
      if (file.size > 2_000_000) throw new Error(`${file.name} is larger than 2 MB.`);
      const content = await file.text();
      const name = skillNameFromFile(file, content);
      if (!name) throw new Error(`${file.name} does not have a valid skill name.`);
      await mutateSkills("POST", { name, content });
      added += 1;
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  if (added) {
    addLog("Knowledge", `Added ${added} skill file${added === 1 ? "" : "s"}`, "success");
    showToast(`${added} skill file${added === 1 ? "" : "s"} added.${errors.length ? ` ${errors.length} failed.` : ""}`, Boolean(errors.length));
  } else if (errors.length) showToast(errors[0], true);
});
$("#skills-body").addEventListener("change", async (event) => {
  const checkbox = event.target.closest("input.skill-toggle[data-skill]");
  if (!checkbox) return;
  checkbox.disabled = true;
  const selectedSkillIds = state.skills
    .filter((skill) => skill.id === checkbox.dataset.skill ? checkbox.checked : skill.selected)
    .map((skill) => skill.id);
  try {
    await mutateSkills("PUT", { selectedSkillIds });
    showToast(`Skill ${checkbox.checked ? "enabled" : "disabled"}.`);
  } catch (error) {
    showToast(error.message, true);
    renderSkills();
  }
});
$("#skills-body").addEventListener("click", async (event) => {
  const button = event.target.closest("button.skill-delete[data-skill]");
  if (!button) return;
  const skill = state.skills.find((entry) => entry.id === button.dataset.skill);
  if (!skill || !window.confirm(`Delete skill file “${skill.name}/SKILL.md”?`)) return;
  button.disabled = true;
  try {
    await mutateSkills("DELETE", { skillId: skill.id });
    addLog("Knowledge", `Deleted skill ${skill.name}`, "success");
    showToast(`${skill.name}/SKILL.md deleted.`);
  } catch (error) {
    showToast(error.message, true);
    button.disabled = false;
  }
});
$("#refresh-memory-button").addEventListener("click", () => void loadMemory());
$("#refresh-workspace-button").addEventListener("click", () => void loadSharedWorkspace());

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

setInterval(renderSelectedAgent, 1000);
setInterval(() => void refreshDashboard({ quiet: true }), 2500);
setInterval(() => void loadMemory({ quiet: true }), 5000);
setInterval(() => {
  if (document.body.dataset.page === "chat") void loadOfficeChat({ quiet: true });
  if (document.body.dataset.page === "workspace") void loadSharedWorkspace({ quiet: true });
}, 2000);

renderOffice(); renderAgentRegistry(); renderWorkerTokenState(); renderOperationAgentOptions(); renderOperations(); renderActivity(); renderLogs(); renderTasks(); renderSelectedAgent(); renderChat(); renderOfficeChat(); renderSharedWorkspace();
router.start();
connectSocket();
void refreshDashboard();
void loadSystemPrompts();
void loadConfigurationSettings();
void loadSkills();
void loadMemory();
void loadOfficeChat();
void loadSharedWorkspace();
