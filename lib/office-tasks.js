const PRIORITIES = new Set(["low", "medium", "high"]);

export function createOfficeTask(uiStateStore, { title, priority = "medium" }) {
  const normalizedTitle = String(title || "").trim();
  if (!normalizedTitle) throw new Error("Task instructions are required.");
  if (normalizedTitle.length > 100_000) throw new Error("Task instructions are too long.");
  const normalizedPriority = PRIORITIES.has(priority) ? priority : "medium";
  return uiStateStore.createOfficeTask({ title: normalizedTitle, priority: normalizedPriority });
}

export function readOfficeTasks(uiStateStore, subAgentManager, filters = {}) {
  return {
    tasks: uiStateStore.getOfficeTasks(filters),
    workers: subAgentManager?.listWorkers() || [],
  };
}

export function assignOfficeTask(uiStateStore, subAgentManager, { id, agent }) {
  const task = uiStateStore.getOfficeTasks({ limit: 500 }).find((entry) => entry.id === String(id));
  if (!task) throw new Error(`Unknown task: ${id || "(empty)"}`);
  if (task.status !== "pending") throw new Error(`Task ${task.id} has already been assigned.`);
  const worker = subAgentManager?.listWorkers().find((entry) => entry.name === String(agent));
  if (!worker) throw new Error(`Unknown agent: ${agent || "(empty)"}`);
  const queued = subAgentManager.queue({ agent: worker.name, task: task.title, priority: task.priority });
  const assigned = uiStateStore.assignOfficeTask(task.id, { agent: worker.name, messageId: queued.task.messageId });
  void queued.completion.then((result) => {
    uiStateStore.completeOfficeTask(task.id, {
      status: result.ok ? "completed" : result.status === "timed_out" ? "timed_out" : "failed",
      workerTaskId: result.taskId,
      result: result.text,
      error: result.error,
      deliveredWork: result.deliveredWork || [],
    });
  }).catch((error) => {
    uiStateStore.completeOfficeTask(task.id, { status: "failed", error: error.message });
  });
  return assigned;
}
