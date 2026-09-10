import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "./api/index.js";
import { createModelClient } from "./lib/openai.js";
import { CodingAgent, resolveDisabledSteps } from "./lib/agent.js";
import { serveStatic } from "./lib/response.js";
import { createTools } from "./lib/tools/index.js";
import { loadMcpTools } from "./lib/mcp.js";
import { SubAgentManager } from "./lib/sub-agents.js";
import { PeriodicOperationScheduler } from "./lib/operations.js";
import { agentUsername, createOfficeChatService } from "./lib/office-chat.js";
import {
  createUiStateStore,
  normalizeStoredToolPermissions as normalizeToolPermissions,
} from "./lib/ui-state.js";
import { attachWebSocketServer, createWebSocketHandler } from "./lib/ws.js";
import { createWorkerWebSocketHandler } from "./lib/worker-ws.js";
import { createSharedWorkspace } from "./lib/shared-workspace.js";
import { FAILURE_RECOVERY_POLICY, SEQUENTIAL_ORCHESTRATION_POLICY, TaskReviewTrigger } from "./lib/task-review-trigger.js";
import { TaskProgressMonitor, resolveTaskProgressCheckInterval } from "./lib/task-progress-monitor.js";
import { formatConversationContext } from "./lib/conversation-context.js";
import { clearManagedDirectory } from "./lib/factory-reset.js";
import {
  defaultBaseUrlForProvider,
  defaultModelForProvider,
  normalizeProvider,
  resolveProviderApiKey,
} from "./lib/provider-config.js";
import {
  applyEnvironmentSettings,
  environmentDisablesFileAccess,
  loadEnvironmentFile,
} from "./lib/env-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageMetadata = JSON.parse(await fs.readFile(path.join(__dirname, "package.json"), "utf8"));
const appVersion = String(packageMetadata.version || "0.0.0");
const environmentFilePath = path.join(__dirname, ".env");
const environmentFileDetected = loadEnvironmentFile(environmentFilePath);
const fileAccessDisabledByEnvironment = environmentFileDetected
  && environmentDisablesFileAccess(process.env);
const publicDir = path.join(__dirname, "public");
const runtimeRoot = path.resolve(process.env.AI_HARNESS_DATA_DIR || process.cwd());
const defaultWorkspace = path.resolve(process.env.AI_HARNESS_WORKSPACE || process.cwd());
const configPath = path.join(runtimeRoot, ".ai-harness/config.toml");
const databaseDir = path.join(runtimeRoot, "db");
const uiStateDatabasePath = path.join(databaseDir, "ui-state.sqlite");
const sharedWorkspaceRoot = path.resolve(process.env.AI_HARNESS_SHARED_WORKSPACE || path.join(runtimeRoot, ".office-workspace"));

const defaultPort = Number(process.env.PORT || 8010);
await fs.mkdir(databaseDir, { recursive: true });
await fs.mkdir(sharedWorkspaceRoot, { recursive: true });
const connections = new Set();
let storeClosed = false;
let server;
let officeChatService;
let officeManagerBoardRunning = false;
let officeManagerQueue = Promise.resolve();
let taskReviewTrigger;
let taskProgressMonitor;

const sharedWorkspace = createSharedWorkspace({ root: sharedWorkspaceRoot });
const subAgentManager = new SubAgentManager({
  materializeArtifacts: (task, artifacts) => sharedWorkspace.storeTaskArtifacts(task, artifacts),
  onWorkerRegistered(worker) {
    uiStateStore.upsertRegisteredWorker(worker);
    uiStateStore.recordSystemActivity({
      category: "agent", source: worker.name,
      message: `Worker connected · ${worker.url}`, tone: "success",
      metadata: { url: worker.url, tokenName: worker.tokenName || "" },
    });
  },
  onWorkerDisconnected(worker) {
    uiStateStore.markRegisteredWorkerOffline(worker.name);
    uiStateStore.recordSystemActivity({
      category: "agent", source: worker.name,
      message: `Worker disconnected · ${worker.url}`, tone: "error",
      metadata: { url: worker.url },
    });
  },
  onDirectMessage(state, message) {
    uiStateStore.recordSystemActivity({
      category: "agent", source: message.agent || "Worker",
      message: `Direct message ${state}${message.error ? ` · ${message.error}` : ""}`,
      tone: state === "completed" ? "success" : state === "failed" ? "error" : "",
      metadata: { messageId: message.messageId },
    });
    officeChatService?.postMessage(state === "completed" ? {
      author: message.agent,
      username: message.agent,
      kind: "agent",
      text: message.text,
    } : {
      author: "Office Manager",
      username: "office-manager",
      kind: "system",
      text: `Direct message to @${String(message.agent || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-")} failed: ${message.error}`,
    });
    taskProgressMonitor?.handleDirectMessage(state, message);
  },
  onTaskAssigned(task) {
    uiStateStore.recordSystemActivity({
      category: "task", source: task.agent || "Office Manager",
      message: `Task assigned · ${task.title || task.taskId}`, tone: "tool",
      metadata: { taskId: task.taskId, messageId: task.messageId },
    });
    officeChatService?.postAssignment(task);
  },
  onTaskEvent(event, task) {
    uiStateStore.recordSystemActivity({
      category: "task", source: task.agent || "Worker",
      message: `Task ${event} · ${task.title || task.taskId}`,
      tone: event === "completed" ? "success" : ["failed", "timed_out", "cancelled"].includes(event) ? "error" : "",
      metadata: { taskId: task.taskId, messageId: task.messageId },
    });
    const summary = String(task.text || task.error || "").slice(0, 20_000);
    uiStateStore.recordOfficeMemory({
      kind: "task",
      status: event,
      title: task.title || "Delegated task",
      summary,
      agent: task.agent,
      sourceId: task.taskId || task.messageId,
      artifacts: task.deliveredWork || [],
      occurredAt: task.finishedAt ? Date.parse(task.finishedAt) : Date.now(),
      details: {
        messageId: task.messageId,
        taskId: task.taskId,
        workerUrl: task.workerUrl,
        priority: task.priority,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
      },
    });
    if (["working", "completed", "failed", "timed_out", "cancelled"].includes(event)) {
      officeChatService?.postTaskResult(event, task);
    }
    taskReviewTrigger?.notify(event, task);
  },
});

async function initializeUiStateStore(databasePath, initialMcpConfigPath) {
  const store = createUiStateStore(databasePath);
  if (store.getMcpConfig() === undefined) {
    try {
      store.setMcpConfig(await fs.readFile(initialMcpConfigPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return store;
}

async function resolveWorkspace(requested) {
  if (typeof requested !== "string" || !requested.trim()) {
    throw new Error("Select a workspace before sending a prompt.");
  }
  if (requested.length > 4096) throw new Error("Workspace path is too long.");
  const root = path.resolve(defaultWorkspace, requested.trim());
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error(`Workspace is not a directory: ${requested}`);
  return fs.realpath(root);
}

async function createAgentSession({
  disabledSteps = [],
  emit,
  onTextDelta,
  providerSettings = {},
  root,
  toolPermissions,
}) {
  const storedSettings = uiStateStore.getAll().providerSettings || {};
  const settings = { ...storedSettings, ...providerSettings };
  const provider = normalizeProvider(settings.provider || process.env.AI_PROVIDER);
  const model = settings.model ||
    process.env.AI_MODEL ||
    defaultModelForProvider(provider);
  const approveMcp = async () => true;
  const onInfo = (message) => emit({ type: "info", message });
  const onTool = ({ name, args }) => emit({ type: "tool", name, args });
  const onEvent = (event) => emit({ type: "agent_event", event });

  const apiKey = resolveProviderApiKey(provider, settings.apiKey);
  if (provider === "openai" && !apiKey) {
    throw new Error("Save an OpenAI API key in Provider settings first.");
  }

  const client = createModelClient({
    provider,
    apiKey,
    baseUrl: settings.baseUrl || defaultBaseUrlForProvider(provider),
  });
  // Enabling a built-in tool in the web Tools settings is the user's
  // authorization to execute it. Disabled tools are not exposed to the model.
  const disabled = new Set(disabledSteps);
  const localTools = disabled.has("tools") ? [] : createTools({
    root,
    approve: async () => true,
    subAgentManager,
    uiStateStore,
  }).filter((tool) => (
    toolPermissions[tool.name] === true &&
    (tool.name !== "delegate_to_sub_agent" || subAgentManager.listWorkers().length > 0)
  ));
  const mcpTools = disabled.has("mcp") ? [] : await loadMcpTools({
      root,
      configContent: uiStateStore.getMcpConfig() || "",
      approve: approveMcp,
      onInfo,
      autoApprove: true,
    });
  return new CodingAgent({
    client,
    tools: [...localTools, ...mcpTools],
    model,
    root,
    approve: approveMcp,
    onInfo,
    onTool,
    onEvent,
    onTextDelta,
    systemPrompts: uiStateStore.getSystemPrompts(),
    skills: uiStateStore.getSelectedSkills(),
    disabledSteps,
  });
}

function startServer({ port = defaultPort, host } = {}) {
  if (server.listening) {
    const address = server.address();
    const activePort = typeof address === "object" ? address.port : port;
    return Promise.resolve({ server, port: activePort, url: `http://127.0.0.1:${activePort}` });
  }

  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      const address = server.address();
      const activePort = typeof address === "object" ? address.port : port;
      const displayHost = host || "localhost";
      const url = `http://${displayHost}:${activePort}`;
      console.log(`AI Harness web UI listening on ${url}`);
      resolve({ server, port: activePort, url });
    });
  });
}

const handleWebSocket = createWebSocketHandler({
  createAgentSession,
  getRigConfigurations: () => uiStateStore.getRigConfigurations(),
  normalizeToolPermissions,
  onConnectionEvent(state, details) {
    uiStateStore.recordSystemActivity({
      category: "network", source: "Office Manager",
      message: `Orchestration WebSocket ${state}${details.detail ? ` · ${details.detail}` : ""}`,
      tone: state === "connected" ? "success" : "error",
      metadata: details,
    });
  },
  resolveWorkspace,
});

const uiStateStore = await initializeUiStateStore(uiStateDatabasePath, configPath);
uiStateStore.recordSystemActivity({
  category: "system", source: "System",
  message: "Agent Office server initialized", tone: "success",
});
async function runOfficeManager(request, { refine = true } = {}) {
    const rigConfigurations = uiStateStore.getRigConfigurations();
    const activeConfiguration = rigConfigurations.configurations.find(
      (configuration) => configuration.id === rigConfigurations.activeConfigurationId,
    );
    const disabledSteps = resolveDisabledSteps([], activeConfiguration?.componentState?.effects);
    const agent = await createAgentSession({
      disabledSteps,
      emit: () => {},
      onTextDelta: () => {},
      root: await resolveWorkspace(defaultWorkspace),
      toolPermissions: normalizeToolPermissions(activeConfiguration?.toolPermissions),
    });
    const prompt = !refine || disabledSteps.includes("composer")
      ? request
      : await agent.refinePrompt(request, { disabledSteps });
    const output = await agent.run({ text: prompt }, { disabledSteps });
    officeChatService.postMessage({
      author: "Office Manager",
      username: "office-manager",
      kind: "manager",
      text: output || "Done.",
    });
    return output;
}

function enqueueOfficeManager(run) {
  const execute = async () => {
    officeManagerBoardRunning = true;
    try { return await run(); } finally { officeManagerBoardRunning = false; }
  };
  const result = officeManagerQueue.then(execute, execute);
  officeManagerQueue = result.catch(() => undefined);
  return result;
}

function handleOfficeManagerMention({ message, text }) {
  return enqueueOfficeManager(async () => {
    const recent = officeChatService.list({ limit: 40 }).messages
      .filter((entry) => entry.id !== message.id)
      .map((entry) => ({ label: entry.author, text: entry.text, isUser: entry.kind === "user" }));
    const conversation = formatConversationContext(recent, text);
    const request = `You were addressed as @office-manager in #central-office. Respond to the current request and coordinate work through the office task tools when delegation is needed. Any task assignment you make will be announced on the board automatically.\n\n${SEQUENTIAL_ORCHESTRATION_POLICY}\n\n${conversation}`;
    return runOfficeManager(request);
  });
}

officeChatService = createOfficeChatService({
  uiStateStore,
  subAgentManager,
  onManagerMention: handleOfficeManagerMention,
  isManagerTyping: () => officeManagerBoardRunning,
});
taskReviewTrigger = new TaskReviewTrigger({
  review: async ({ event, task }) => {
    await new Promise((resolve) => setImmediate(resolve));
    return enqueueOfficeManager(async () => {
      const tasks = uiStateStore.getOfficeTasks({ limit: 200 });
      const settled = tasks.find((entry) => entry.messageId === task.messageId || entry.workerTaskId === task.taskId);
      const recent = officeChatService.list({ limit: 30 }).messages
        .map((entry) => ({ label: entry.author, text: entry.text, isUser: entry.kind === "user" }));
      const reviewRequest = `A delegated task has ${event}. Review its outcome and decide whether the next stage should be assigned. Use manage_office_tasks to read the current queue before acting.\n\nSettled task:\n${JSON.stringify(settled || task, null, 2)}\n\nCurrent task queue:\n${JSON.stringify(tasks, null, 2)}`;
      const conversation = formatConversationContext(recent, reviewRequest);
      const recovery = ["failed", "timed_out"].includes(event) ? `\n\n${FAILURE_RECOVERY_POLICY}` : "";
      const request = `${SEQUENTIAL_ORCHESTRATION_POLICY}${recovery}\n\n${conversation}`;
      return runOfficeManager(request, { refine: false });
    });
  },
  onError(error, { task }) {
    officeChatService?.postMessage({
      author: "Office Manager",
      username: "office-manager",
      kind: "system",
      text: `Automatic review after “${task.title || "task"}” failed: ${error.message}`,
    });
  },
});
const taskProgressCheckIntervalMs = resolveTaskProgressCheckInterval(process.env);
taskProgressMonitor = new TaskProgressMonitor({
  uiStateStore,
  subAgentManager,
  intervalMs: taskProgressCheckIntervalMs,
  onCheck({ task, checkedAt }) {
    officeChatService.postMessage({
      author: "Office Manager",
      username: "office-manager",
      kind: "manager",
      text: `@${agentUsername(task.agent)} Status check: “${task.title}” has been running longer than ${taskProgressCheckIntervalMs} ms. Please report progress, blockers, next step, and ETA.`,
      taskId: task.messageId,
    });
    uiStateStore.recordOfficeMemory({
      kind: "system",
      status: "requested",
      title: `Progress check: ${task.title}`,
      summary: `Requested a progress update from ${task.agent}.`,
      agent: task.agent,
      sourceId: task.id,
      occurredAt: checkedAt,
      details: { intervalMs: taskProgressCheckIntervalMs, messageId: task.messageId },
    });
  },
  onStatus({ task, message, checkedAt }) {
    uiStateStore.recordOfficeMemory({
      kind: "system",
      status: "completed",
      title: `Progress update: ${task.title}`,
      summary: String(message.text || "No status text returned.").slice(0, 20_000),
      agent: task.agent,
      sourceId: task.id,
      occurredAt: checkedAt,
      details: { intervalMs: taskProgressCheckIntervalMs, messageId: task.messageId },
    });
    void enqueueOfficeManager(async () => {
      const tasks = uiStateStore.getOfficeTasks({ limit: 200 });
      const recent = officeChatService.list({ limit: 30 }).messages
        .map((entry) => ({ label: entry.author, text: entry.text, isUser: entry.kind === "user" }));
      const progressRequest = `A periodic progress check returned for the running task below. Assess whether work is progressing, blocked, or needs a different approach. Do not create a duplicate task merely because it is still running. If it is blocked, explain the intervention and use manage_office_tasks to cancel and replan only when justified.\n\nTask:\n${JSON.stringify(task, null, 2)}\n\nWorker status:\n${message.text}\n\nCurrent task queue:\n${JSON.stringify(tasks, null, 2)}`;
      const conversation = formatConversationContext(recent, progressRequest);
      return runOfficeManager(`${SEQUENTIAL_ORCHESTRATION_POLICY}\n\n${FAILURE_RECOVERY_POLICY}\n\n${conversation}`, { refine: false });
    }).catch((error) => officeChatService.postMessage({
      author: "Office Manager",
      username: "office-manager",
      kind: "system",
      text: `Unable to review the progress update for “${task.title}”: ${error.message}`,
    }));
  },
  onError(error, { task, checkedAt }) {
    const title = task?.title || "running task";
    officeChatService.postMessage({
      author: "Office Manager",
      username: "office-manager",
      kind: "system",
      text: `Progress check for “${title}” failed: ${error.message}`,
      taskId: task?.messageId,
    });
    uiStateStore.recordOfficeMemory({
      kind: "system",
      status: "failed",
      title: `Progress check: ${title}`,
      summary: error.message,
      agent: task?.agent,
      sourceId: task?.id,
      occurredAt: checkedAt,
      details: { intervalMs: taskProgressCheckIntervalMs },
    });
  },
});
taskProgressMonitor.start();
if (environmentFileDetected) {
  applyEnvironmentSettings(uiStateStore, process.env, __dirname);
}
if (process.env.AI_HARNESS_WORKER_TOKEN?.trim() && !uiStateStore.getWorkerToken()) {
  uiStateStore.setWorkerToken(process.env.AI_HARNESS_WORKER_TOKEN, "Environment worker token");
}
const periodicOperationScheduler = new PeriodicOperationScheduler({ uiStateStore, subAgentManager });
periodicOperationScheduler.start();

server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const requestStartedAt = Date.now();
  res.once("finish", () => {
    try {
      uiStateStore.recordSystemActivity({
        category: "network", source: "HTTP",
        message: `${req.method} ${url.pathname} → ${res.statusCode} · ${Date.now() - requestStartedAt}ms`,
        tone: res.statusCode >= 400 ? "error" : "tool",
        metadata: { method: req.method, path: url.pathname, statusCode: res.statusCode },
      });
    } catch (error) {
      if (!storeClosed) console.error("Unable to record HTTP activity:", error);
    }
  });
  const handleApiRequest = createApiRouter({
    uiStateStore,
    defaultWorkspace,
    resolveWorkspace,
    environmentFileDetected,
    fileAccessDisabledByEnvironment,
    appVersion,
    subAgentManager,
    officeChatService,
    sharedWorkspaceRoot,
    factoryReset: async () => {
      const activeWorkerTasks = subAgentManager.listTasks().filter((task) => (
        !["completed", "failed", "timed_out", "cancelled"].includes(task.state)
      ));
      const activeDirectMessages = subAgentManager.listDirectMessages();
      if (officeManagerBoardRunning || activeWorkerTasks.length > 0 || activeDirectMessages.length > 0) {
        const error = new Error("Stop active office work before running a factory reset.");
        error.statusCode = 409;
        throw error;
      }
      periodicOperationScheduler.stop();
      try {
        const filesRemoved = await clearManagedDirectory(sharedWorkspaceRoot, {
          protectedPaths: [runtimeRoot, defaultWorkspace, __dirname],
        });
        const database = uiStateStore.factoryReset();
        return { filesRemoved, database };
      } finally {
        periodicOperationScheduler.start();
      }
    },
  });

  if (await handleApiRequest(req, res, url)) return;
  await serveStatic(req, res, publicDir);
});

const handleWorkerWebSocket = createWorkerWebSocketHandler({
  subAgentManager,
  getToken: () => uiStateStore.getWorkerToken(),
  getTokenName: () => uiStateStore.getWorkerTokenName(),
});
attachWebSocketServer(server, handleWebSocket, "/ws", { "/ws/workers": handleWorkerWebSocket });

server.on("connection", (socket) => {
  connections.add(socket);
  socket.on("error", (error) => {
    // Browser refreshes and closed WebSockets commonly reset the TCP stream.
    // Keep those disconnects from becoming unhandled process-level errors.
    if (!["ECONNRESET", "EPIPE"].includes(error.code)) {
      console.error("Client socket error:", error);
    }
  });
  socket.on("close", () => connections.delete(socket));
});

await startServer({ host: process.env.HOST || "127.0.0.1" });
