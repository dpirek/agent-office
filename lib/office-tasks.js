const PRIORITIES = new Set(["low", "medium", "high"]);
const MAX_WORKER_PROMPT_LENGTH = 100_000;
const MAX_PREREQUISITE_RESULT_LENGTH = 20_000;

function prerequisiteTasks(task, tasksById) {
  const ordered = [];
  const visited = new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    visited.add(id);
    const dependency = tasksById.get(id);
    if (!dependency) return;
    for (const parentId of dependency.dependsOn || []) visit(parentId);
    ordered.push(dependency);
  };
  for (const id of task.dependsOn || []) visit(id);
  return ordered;
}

function artifactReference(artifact) {
  const references = [
    artifact.workspacePath ? `workspace path: ${artifact.workspacePath}` : "",
    artifact.uri ? `URI: ${artifact.uri}` : "",
  ].filter(Boolean);
  return `- ${artifact.name || "Delivered file"}${references.length ? ` (${references.join("; ")})` : ""}`;
}

export function buildDependentTaskPrompt(task, tasks) {
  const dependencies = prerequisiteTasks(task, new Map(tasks.map((entry) => [entry.id, entry])));
  if (dependencies.length === 0) return task.title;
  const sections = dependencies.map((dependency) => {
    const result = String(dependency.result || "No written result was provided.")
      .slice(0, MAX_PREREQUISITE_RESULT_LENGTH);
    const artifacts = (dependency.deliveredWork || []).map(artifactReference).join("\n") || "- None";
    return `## ${dependency.title}\nTask ID: ${dependency.id}\n\nResult:\n${result}\n\nDelivered files:\n${artifacts}`;
  });
  const suffix = `\n\n# Current task\n${task.title}\n\nUse the prerequisite results and delivered files above as authoritative input. Continue from that work; do not redo or ignore it.`;
  const prefix = "# Prerequisite work\n\n";
  const available = MAX_WORKER_PROMPT_LENGTH - prefix.length - suffix.length;
  if (available < 0) throw new Error("Task instructions are too long to include required prerequisite context.");
  const context = sections.join("\n\n").slice(0, available);
  return `${prefix}${context}${suffix}`;
}

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
  const workerPrompt = buildDependentTaskPrompt(task, tasks);
  const queued = subAgentManager.queue({
    agent: worker.name,
    task: workerPrompt,
    title: task.title,
    priority: task.priority,
  });
  const assigned = uiStateStore.assignOfficeTask(task.id, { agent: worker.name, messageId: queued.task.messageId });
  void queued.completion.then((result) => {
    uiStateStore.completeOfficeTask(task.id, {
      status: result.ok ? "completed" : ["timed_out", "cancelled"].includes(result.status) ? result.status : "failed",
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

export function cancelOfficeTask(uiStateStore, subAgentManager, { id, reason } = {}) {
  const task = uiStateStore.getOfficeTasks({ limit: 500 }).find((entry) => entry.id === String(id));
  if (!task) throw new Error(`Unknown task: ${id || "(empty)"}`);
  if (task.status !== "running") throw new Error(`Only running tasks can be stopped; task is ${task.status}.`);
  const normalizedReason = String(reason || "").trim().slice(0, 1_000) || "Task stopped by the office manager.";
  subAgentManager.cancelTask({ messageId: task.messageId, reason: normalizedReason });
  return uiStateStore.completeOfficeTask(task.id, { status: "cancelled", error: normalizedReason });
}
