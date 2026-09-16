import "./components/office-shell.mjs";
import { requireSession } from "./lib/auth.mjs";
const signedInUser = await requireSession();
import { PROJECT_PAGES, projectPagePath, projectIdFromPath, registerProjectRoutes } from "./lib/project-routes.mjs";
import Router from "./lib/router.mjs";
import { createClientId } from "./lib/client-id.mjs";
import { revealCreatedTask } from "./lib/task-state.mjs";
import { createOfficeWebSocketUrl } from "./lib/websocket-url.mjs";

const startedAt = Date.now();
const sessionId = createClientId();
const shell = document.querySelector('office-shell');
const component = name => shell.querySelector(`office-${name}`);
const navigation = component('navigation');
navigation.data = { userRole: signedInUser.role };
const topbar = component('topbar');
topbar.data = { user: signedInUser };
shell.addEventListener('account-user-change', ({ detail }) => {
  Object.assign(signedInUser, detail.user);
  navigation.data = { userRole: detail.user.role };
  topbar.data = { user: detail.user };
  component('settings').data = { userRole: detail.user.role };
  renderOffice(); renderSelectedAgent(); renderOfficeChat();
});
const searchPage = component('search');
const workspace = component('workspace');
const chat = component('chat');
const managerChat = component('manager-chat');
const dashboardChat = component('dashboard-chat');
const settings = component('settings');
settings.data = { userRole: signedInUser.role };
const memory = component('memory');
const taskQueue = component('task-queue');
const operationsPanel = component('operations');

shell.addEventListener('office-notify', ({ detail }) => showToast(detail.message, detail.error));
shell.addEventListener('office-log', ({ detail }) => addLog(detail.source, detail.text, detail.tone));
shell.addEventListener('office-activity', ({ detail }) => addActivity(detail.text, detail.tone));
function handleRequest(name, handler) {
  shell.addEventListener(name, event => event.detail.respondWith(Promise.resolve().then(() => handler(event.detail))));
}

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
  tasks: { path: "/tasks", title: "Tasks" },
  workspace: { path: "/workspace", title: "Workspace" },
  operations: { path: "/operations", title: "Operations" },
  memory: { path: "/memory", title: "Memory" },
  knowledge: { path: "/knowledge", title: "Knowledge", icon: "▧", heading: "Knowledge base", description: "Connected sources and selected skills provide shared context to the agent office." },
  account: { path: "/account", title: "Account" },
  settings: { path: "/settings", title: "Settings" },
  search: { path: "/search", title: "Search" },
};

const state = {
  projectId: projectIdFromPath(window.location.pathname) || (window.location.pathname === "/search" ? new URLSearchParams(location.search).get("project") : null) || localStorage.getItem("office-project") || "central-office",
  projects: [],
  agents: [],
  selectedAgent: "Office Manager",
  localTasks: [],
  officeTasks: [],
  workers: [],
  workerTokenConfigured: false,
  workerTokenName: "",
  operations: [],
  chatMessages: [],
  officeChatMessages: [],
  officeChatMembers: [],
  chatRunning: false,
  activity: [],
  logs: [],
  health: null,
  orchestrator: null,
  socket: null,
  socketReady: false,
  runningTaskId: null,
};

function showToast(message, error = false) { component("toast").show(message, error); }

shell.addEventListener('file-open', ({ detail: { href } }) => {
  const projectId = decodeURIComponent(new URL(href, location.href).pathname.split('/')[2] || '');
  router.navigate(projectPagePath('workspace', state.projects.some(project => project.id === projectId) ? projectId : state.projectId));
  void workspace.openFile(href);
});

function renderPage(section) {
  if (['knowledge', 'operations'].includes(section) && signedInUser.role !== 'admin') {
    router.navigate(projectPagePath('dashboard', state.projectId), { replace: true });
    return;
  }
  if (section === 'account') void component('account').load();
  if (section === 'search') {
    const projectId = new URLSearchParams(location.search).get('project');
    if (projectId && projectId !== state.projectId && state.projects.some(project => project.id === projectId)) void switchProject(projectId, { navigate: false });
  }
  const page = PAGES[section] || PAGES.dashboard;
  document.body.dataset.page = section;
  document.title = `${page.title} · AI Agent Office`;
  navigation.data = { page: section };
  shell.showPage(section);
  if (section === 'search') runSearch();
  else topbar.data = { query: '' };
  if (section === 'tasks' && new URLSearchParams(location.search).get('new') === '1') {
    taskQueue.open();
    history.replaceState(null, '', location.pathname);
  }
  if (section === 'chat') { chat.syncComposer(); void loadOfficeChat({ quiet: true }); }
  if (section === 'workspace') void loadSharedWorkspace({ quiet: true });
}

function runSearch() {
  const query = new URLSearchParams(location.search).get('q') || '';
  topbar.data = { query };
  void searchPage.search(query, state.projectId, state.projects.find(project => project.id === state.projectId)?.name || 'Central Office');
}

function addActivity(text, tone = "") {
  state.activity.push({ at: Date.now(), text, tone });
  state.activity = state.activity.slice(-80);
}

function addLog(source, text, tone = "") {
  state.logs.push({ at: Date.now(), source, text, tone });
  state.logs = state.logs.slice(-500);
  renderLogs();
  void fetch("/api/system-logs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ category: "browser", source, message: text, tone }),
  }).catch(() => {});
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
    description: task.description || "",
    projectId: task.projectId,
    agent: task.agent || "UNASSIGNED",
    status: normalizeTaskStatus(task.status),
    priority: task.priority || "medium",
    progress: task.status === "completed" ? 100 : task.status === "running" ? 55 : ["failed", "timed_out", "cancelled"].includes(task.status) ? 100 : 0,
    createdAt: task.createdAt,
    dependsOn: task.dependsOn || [],
    deliveredWork: task.deliveredWork || [],
    canStop: true,
    canDelete: true,
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

function chatMembers() {
  const members = state.officeChatMembers;
  const current = { id: signedInUser.id, username: `user-${signedInUser.id}`, name: signedInUser.name, avatar: signedInUser.avatar, type: 'human', status: 'online' };
  return [...members.filter(member => member.username !== current.username), current];
}

function officeAgents() {
  const people = chatMembers().filter(member => member.type === 'human').map(member => ({
    ...member, human: true, selectionKey: `human:${member.id}`, role: 'Office member',
    description: 'Signed in to the office', tools: '',
    status: member.status === 'online' ? 'ready' : member.status,
  }));
  return [officeManagerAgent(), ...people, ...state.agents];
}

function currentAgent() {
  const agents = officeAgents();
  return agents.find((agent) => (agent.selectionKey || agent.name) === state.selectedAgent) || agents[0];
}

function renderOffice() {
  const agents = officeAgents();
  const floor = component('floor');
  floor.data = { agents, selectedAgent: state.selectedAgent };
  floor.meta = `1 MANAGER · ${state.workers.length} REMOTE WORKERS · ${agents.filter(agent => agent.human).length} PEOPLE`;
}

function renderAgentRegistry() { component('worker-registry').data = { workers: state.workers }; }

function renderWorkerTokenState() { component('worker-registry').data = { workerTokenConfigured: state.workerTokenConfigured, workerTokenName: state.workerTokenName }; }

function renderSelectedAgent() {
  component('selected-agent').data = { agent: currentAgent(), agents: officeAgents(), tasks: allTasks(), activity: state.activity, health: state.health, orchestrator: state.orchestrator, chatRunning: state.chatRunning, uptime: formatUptime(), sessionId };
}

function renderLogs() { component('system-log').data = { logs: state.logs }; }

async function loadSystemLogs() {
  try {
    const data = await fetchJson("/api/system-logs?limit=500");
    state.logs = (data.logs || []).map((entry) => ({
      at: entry.createdAt,
      source: entry.source,
      text: entry.message,
      tone: entry.tone || "",
    }));
    renderLogs();
  } catch {
    // Preserve the most recent local events while the server is unreachable.
  }
}

function renderChat() { managerChat.data = { chatMessages: state.chatMessages, socketReady: state.socketReady, chatRunning: state.chatRunning, health: state.health, projectId: state.projectId }; }

function renderOfficeChat() {
  chat.data = { officeChatMessages: state.officeChatMessages, officeChatMembers: chatMembers(), projects: state.projects, projectId: state.projectId, chatRunning: state.chatRunning };
  dashboardChat.data = { messages: state.officeChatMessages, projectId: state.projectId, projectName: state.projects.find(project => project.id === state.projectId)?.name || 'Central Office' };
}

async function loadOfficeChat({ quiet = false } = {}) {
  try {
    const projectId = state.projectId;
    const data = await fetchJson(`/api/chat?limit=300&projectId=${encodeURIComponent(projectId)}`);
    if (projectId !== state.projectId) return;
    state.officeChatMessages = data.messages || [];
    state.chatMessages = state.officeChatMessages.filter((message) => ["user", "manager"].includes(message.kind)).map((message) => ({ role: message.kind === "user" ? "user" : "agent", text: message.text }));
    renderChat();
    state.officeChatMembers = data.members || [];
    renderOffice(); renderSelectedAgent();
    renderOfficeChat({ preserveScroll: true });
  } catch (error) {
    if (!quiet) showToast(error.message, true);
  }
}

async function postOfficeChat(payload) {
  payload = { ...payload, projectId: state.projectId };
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function currentChatReply() {
  return [...state.chatMessages].reverse().find((message) => message.role === "agent" && message.streaming);
}

function renderTasks() {
  const data = { tasks: allTasks(), projectId: state.projectId, projects: state.projects };
  component('task-summary').data = data;
  taskQueue.data = data;
  renderSelectedAgent();
}

function loadSharedWorkspace(options) { return workspace.load(options); }

function renderOperationAgentOptions() { operationsPanel.data = { workers: state.workers }; }

function renderOperations() { operationsPanel.data = { operations: state.operations, projectId: state.projectId }; }

function loadMemory(options) { return memory.load(options); }

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
      status: worker.status === "connected" ? (previous.get(worker.name)?.status === "running" ? "running" : "ready") : "offline",
    };
  });
  state.agents = normalized;
  if (!officeAgents().some((agent) => (agent.selectionKey || agent.name) === state.selectedAgent)) {
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
  payload = { ...payload, projectId: state.projectId };
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
    body: JSON.stringify({ id, action: "cancel", projectId: state.projectId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function deleteTask(id) {
  const response = await fetch("/api/tasks", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, action: "delete", projectId: state.projectId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function refreshDashboard({ quiet = false } = {}) {
  try {
    const projectId = state.projectId;
    const [health, subAgents, operations, officeTasks] = await Promise.all([
      fetchJson("/api/health"),
      fetchJson("/api/sub-agents"),
      fetchJson(`/api/operations?projectId=${encodeURIComponent(projectId)}`),
      fetchJson(`/api/tasks?projectId=${encodeURIComponent(projectId)}`),
    ]);
    if (projectId !== state.projectId) return;
    state.health = health;
    navigation.data = { context: `v${health.version || "0.0.0"} · Workspace ${health.workspace || "—"}`, online: true };
    state.orchestrator = subAgents.orchestrator;
    state.officeTasks = officeTasks.tasks || [];
    state.workers = subAgents.workers || [];
    state.workerTokenConfigured = subAgents.workerTokenConfigured === true;
    state.workerTokenName = subAgents.workerTokenName || "";
    state.operations = operations.operations || [];
    mergeConfiguredAgents(state.workers);

    renderOffice(); renderAgentRegistry(); renderWorkerTokenState(); renderOperationAgentOptions(); renderOperations(); renderTasks();
    renderChat();
    if (!quiet) addLog("System", "Agent configuration synchronized", "success");
  } catch (error) {
    navigation.data = { online: false };
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
    addLog("Network", "Orchestration channel ready", "success");
    renderChat(); renderOffice(); renderSelectedAgent();
    return;
  }
  if (message.type === "info") {
    addActivity(message.message);
    addLog("System", message.message);
    return;
  }
  if (message.type === "tool") {
    addActivity(`Dispatching ${message.name}`, "tool");
    addLog("Coordinator", `Tool call: ${message.name}`, "tool");
    updateRunningTask({ progress: Math.min(88, (state.localTasks.find((task) => task.id === state.runningTaskId)?.progress || 22) + 13) });
    return;
  }
  if (message.type === "agent_event") {
    const label = eventLabel(message.event || {});
    if (label) {
      const tone = message.event?.type === "final" ? "success" : "";
      addActivity(label, tone);
      addLog("Orchestrator", label, tone);
    }
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
    addActivity("Workflow paused at a safe boundary");
    return;
  }
  if (message.type === "run_resumed") {
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
      managerChat.focusInput();
      return;
    }
    updateRunningTask({ status: "completed", progress: 100, result: message.text });
    addActivity("✓ Task completed", "success");
    addLog("Coordinator", "Task completed successfully", "success");
    setAgentState("Coordinator", "ready");
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
    state.runningTaskId = null;
    showToast(message.error, true);
  }
}

function connectSocket() {
  let socket;
  try {
    socket = new WebSocket(createOfficeWebSocketUrl(location, {
      allowInsecure: state.health?.allowInsecureWebSocket === true,
      configuredUrl: state.health?.webSocketUrl,
    }));
  } catch (error) {
    state.socketReady = false;
    const message = error.name === "SecurityError"
      ? "Browser blocked the WebSocket connection. An HTTPS dashboard normally requires a wss:// endpoint."
      : `Unable to connect to Office: ${error.message}`;
    addLog("Network", message, "error");
    showToast(message, true);
    return;
  }
  state.socket = socket;
  socket.addEventListener("open", () => addLog("System", "Live orchestration channel opened", "success"));
  socket.addEventListener("message", (event) => {
    try { handleSocketMessage(JSON.parse(event.data)); } catch (error) { addLog("System", error.message, "error"); }
  });
  socket.addEventListener("close", () => {
    addLog("Network", "Orchestration channel disconnected", "error");
    state.socketReady = false;
    if (state.runningTaskId || state.chatRunning) handleSocketMessage({ type: "error", error: "Orchestration channel disconnected." });
    renderChat(); renderOffice(); renderSelectedAgent();
    setTimeout(connectSocket, 1800);
  });
  socket.addEventListener("error", () => {
    state.socketReady = false;
    addLog("Network", "Orchestration channel error", "error");
  });
}

function refreshOrchestratorConnection() {
  if (!state.runningTaskId && !state.chatRunning && state.socket && state.socket.readyState < WebSocket.CLOSING) {
    state.socket.close(1000, "Configuration changed");
  }
}

const router = new Router({ fallback: PAGES.dashboard.path });
registerProjectRoutes(router, {
  pages: PAGES,
  getProjectId: () => state.projectId,
  selectProject: (id) => {
    const selected = state.projects.some((project) => project.id === id) ? id : "central-office";
    if (selected !== id) showToast("Project not found. Showing Central Office.", true);
    if (state.projectId !== selected) void switchProject(selected, { navigate: false });
    return selected;
  },
  renderPage,
});

shell.addEventListener('office-search', ({ detail }) => {
  router.navigate(`/search?${new URLSearchParams({ q: detail.query, project: state.projectId })}`);
});
shell.addEventListener('new-task', () => {
  router.navigate(projectPagePath('tasks', state.projectId));
  taskQueue.open();
});
shell.addEventListener('search-result-open', async ({ detail }) => {
  if (detail.type === 'Files') {
    router.navigate(projectPagePath('workspace', state.projectId));
    void workspace.openFile(detail.href);
    return;
  }
  router.navigate(detail.href);
  if (detail.agent) { state.selectedAgent = detail.agent; renderOffice(); renderSelectedAgent(); }
  if (detail.taskId) taskQueue.revealTask(detail.taskId);
});

shell.addEventListener('office-navigate', ({ detail }) => router.navigate(detail.href));
shell.addEventListener('project-select', ({ detail }) => void switchProject(detail.id));
shell.addEventListener('agent-select', ({ detail }) => {
  state.selectedAgent = detail.selectionKey || detail.name;
  renderOffice(); renderSelectedAgent();
});
shell.addEventListener('configuration-change', refreshOrchestratorConnection);
shell.addEventListener('operations-change', ({ detail }) => { state.operations = detail.operations; });
shell.addEventListener('worker-token-change', ({ detail }) => {
  state.workerTokenConfigured = detail.configured; state.workerTokenName = detail.name;
});
handleRequest('task-create', async ({ title, priority }) => {
  const projectId = state.projectId;
  const result = await createTask({ title, priority });
  if (projectId !== state.projectId) return result;
  state.officeTasks = revealCreatedTask(state.officeTasks, result.task, 'all').officeTasks;
  renderTasks();
  return result;
});
handleRequest('task-stop', ({ id }) => stopTask(id));
handleRequest('task-delete', ({ id }) => deleteTask(id));
handleRequest('dashboard-refresh', () => refreshDashboard({ quiet: true }));
handleRequest('chat-send', ({ text }) => postOfficeChat({ text }));
handleRequest('chat-refresh', () => loadOfficeChat());
handleRequest('project-create', async ({ name, description }) => {
  const project = await saveProject({ name, description });
  await switchProject(project.id);
  return project;
});

setInterval(renderSelectedAgent, 1000);
setInterval(() => void refreshDashboard({ quiet: true }), 2500);
setInterval(() => void loadMemory({ quiet: true }), 5000);
setInterval(() => {
  if (["chat", "dashboard"].includes(document.body.dataset.page)) void loadOfficeChat({ quiet: true });
  if (document.body.dataset.page === "workspace") void loadSharedWorkspace({ quiet: true });
  if (document.body.dataset.page === "dashboard") void loadSystemLogs();
}, 2000);

renderOffice(); renderAgentRegistry(); renderWorkerTokenState(); renderOperationAgentOptions(); renderOperations(); renderLogs(); renderTasks(); renderSelectedAgent(); renderChat(); renderOfficeChat();
void settings.load();
if (signedInUser.role === 'admin') void component("knowledge").load();
void loadMemory();

void loadSystemLogs();

function renderProjects() {
  navigation.data = { projects: state.projects, projectId: state.projectId };
  topbar.data = { projects: state.projects, projectId: state.projectId };
  workspace.data = { projectId: state.projectId };
  memory.data = { projectId: state.projectId };
  operationsPanel.data = { projectId: state.projectId };
  renderOfficeChat();
  document.body.dataset.projectId = state.projectId;
  if (document.body.dataset.page === 'search') {
    const params = new URLSearchParams(location.search);
    params.set('project', state.projectId);
    history.replaceState(null, '', `/search?${params}`);
    runSearch();
  }
}
async function loadProjects() {
  const data = await fetchJson("/api/projects");
  state.projects = data.projects;
  if (!state.projects.some((entry) => entry.id === state.projectId)) state.projectId = "central-office";
  renderProjects();
}
async function switchProject(id, { navigate = true } = {}) {
  if (navigate && PROJECT_PAGES.has(document.body.dataset.page)) {
    router.navigate(projectPagePath(document.body.dataset.page, id));
    return;
  }
  state.projectId = id;
  localStorage.setItem("office-project", id);
  state.officeChatMessages = [];
  state.chatMessages = [];
  managerChat.clearDraft();
  state.officeTasks = [];
  state.localTasks = [];
  state.operations = [];
  operationsPanel.close();
  renderOperations(); memory.data = { memoryRecords: [] };
  workspace.reset();
  chat.clearDraft();
  dashboardChat.clearDraft();
  renderProjects(); renderChat(); renderOfficeChat(); renderTasks();
  window.dispatchEvent(new Event("projectchange"));
  await Promise.all([loadOfficeChat(), refreshDashboard({ quiet: true }), loadSharedWorkspace({ quiet: true }), loadMemory({ quiet: true })]);
}
async function saveProject(payload, method = "POST") {
  const response = await fetch("/api/projects", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  await loadProjects();
  return data.project;
}
void loadProjects().then(async () => {
  router.start();
  await switchProject(state.projectId, { navigate: false });
  connectSocket();
}).catch((error) => showToast(error.message, true));
