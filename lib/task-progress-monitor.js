const DEFAULT_TASK_PROGRESS_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MIN_TASK_PROGRESS_CHECK_INTERVAL_MS = 10 * 1000;
const MAX_TASK_PROGRESS_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TASK_PROGRESS_CHECK_ENV = "AI_HARNESS_TASK_PROGRESS_CHECK_INTERVAL_MS";

function resolveTaskProgressCheckInterval(env = process.env) {
  const raw = env[TASK_PROGRESS_CHECK_ENV];
  if (raw === undefined || String(raw).trim() === "") return DEFAULT_TASK_PROGRESS_CHECK_INTERVAL_MS;
  const interval = Number(raw);
  if (!Number.isInteger(interval) || interval < MIN_TASK_PROGRESS_CHECK_INTERVAL_MS || interval > MAX_TASK_PROGRESS_CHECK_INTERVAL_MS) {
    throw new Error(`${TASK_PROGRESS_CHECK_ENV} must be an integer between ${MIN_TASK_PROGRESS_CHECK_INTERVAL_MS} and ${MAX_TASK_PROGRESS_CHECK_INTERVAL_MS}.`);
  }
  return interval;
}

class TaskProgressMonitor {
  constructor({
    uiStateStore,
    subAgentManager,
    intervalMs = DEFAULT_TASK_PROGRESS_CHECK_INTERVAL_MS,
    now = () => Date.now(),
    onCheck = () => {},
    onStatus = () => {},
    onError = () => {},
  } = {}) {
    this.uiStateStore = uiStateStore;
    this.subAgentManager = subAgentManager;
    this.intervalMs = intervalMs;
    this.now = now;
    this.onCheck = onCheck;
    this.onStatus = onStatus;
    this.onError = onError;
    this.lastCheckedAt = new Map();
    this.pendingByTask = new Map();
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.now();
      const runningTasks = this.uiStateStore.getOfficeTasks({ status: "running", limit: 500 });
      const runningIds = new Set(runningTasks.map((task) => task.id));
      for (const taskId of this.lastCheckedAt.keys()) {
        if (!runningIds.has(taskId)) this.lastCheckedAt.delete(taskId);
      }
      for (const taskId of this.pendingByTask.keys()) {
        if (!runningIds.has(taskId)) this.pendingByTask.delete(taskId);
      }
      for (const task of runningTasks) {
        const startedAt = Number(task.startedAt) || Number(task.createdAt) || now;
        const lastCheckedAt = this.lastCheckedAt.get(task.id) || startedAt;
        if (now - startedAt < this.intervalMs || now - lastCheckedAt < this.intervalMs || this.pendingByTask.has(task.id)) continue;
        const text = `Status check for task “${task.title}” (${task.id}). Briefly report progress completed so far, current blockers, the next step, and estimated time remaining. Continue working after replying.`;
        try {
          const directMessage = this.subAgentManager.sendDirectMessage({
            agent: task.agent,
            text,
            timeoutMs: this.intervalMs,
            purpose: "task_progress_check",
            officeTaskId: task.id,
            projectId: task.projectId,
          });
          this.lastCheckedAt.set(task.id, now);
          this.pendingByTask.set(task.id, directMessage.messageId);
          this.onCheck({ task, text, directMessage, checkedAt: now });
        } catch (error) {
          this.lastCheckedAt.set(task.id, now);
          this.onError(error, { task, checkedAt: now });
        }
      }
    } finally {
      this.running = false;
    }
  }

  handleDirectMessage(state, message) {
    if (message?.purpose !== "task_progress_check" || !message.officeTaskId) return false;
    this.pendingByTask.delete(message.officeTaskId);
    const task = this.uiStateStore.getOfficeTasks({ limit: 500 })
      .find((entry) => entry.id === message.officeTaskId);
    if (!task || task.status !== "running") return true;
    if (state === "completed") this.onStatus({ task, message, checkedAt: this.now() });
    else this.onError(new Error(message.error || "The worker did not answer the progress check."), { task, message, checkedAt: this.now() });
    return true;
  }
}

export {
  DEFAULT_TASK_PROGRESS_CHECK_INTERVAL_MS,
  MAX_TASK_PROGRESS_CHECK_INTERVAL_MS,
  MIN_TASK_PROGRESS_CHECK_INTERVAL_MS,
  TASK_PROGRESS_CHECK_ENV,
  TaskProgressMonitor,
  resolveTaskProgressCheckInterval,
};
