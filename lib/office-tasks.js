const PRIORITIES = new Set(["low", "medium", "high"]);

export function createOfficeTask(uiStateStore, { title, priority = "medium", dependsOn, depends_on: dependsOnSnake } = {}) {
  const normalizedTitle = String(title || "").trim();
  if (!normalizedTitle) throw new Error("Task instructions are required.");
  if (normalizedTitle.length > 100_000) throw new Error("Task instructions are too long.");
  const normalizedPriority = PRIORITIES.has(priority) ? priority : "medium";
  const suppliedDependencies = Array.isArray(dependsOn)
    ? dependsOn
    : Array.isArray(dependsOnSnake) ? dependsOnSnake : [];
  const dependencyIds = [...new Set(suppliedDependencies.map((id) => String(id || "").trim()).filter(Boolean))];
  if (dependencyIds.length > 20) throw new Error("A task cannot have more than 20 dependencies.");
  const knownIds = new Set(uiStateStore.getOfficeTasks({ limit: 500 }).map((task) => task.id));
  const unknown = dependencyIds.find((id) => !knownIds.has(id));
  if (unknown) throw new Error(`Unknown task dependency: ${unknown}`);
  return uiStateStore.createOfficeTask({ title: normalizedTitle, priority: normalizedPriority, dependsOn: dependencyIds });
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
  const tasks = uiStateStore.getOfficeTasks({ limit: 500 });
  const byId = new Map(tasks.map((entry) => [entry.id, entry]));
  const blockedBy = (task.dependsOn || []).filter((dependencyId) => byId.get(dependencyId)?.status !== "completed");
  if (blockedBy.length) throw new Error(`Task is waiting for dependencies: ${blockedBy.join(", ")}`);
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
