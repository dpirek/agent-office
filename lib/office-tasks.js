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
  const instructions = task.description ? `${task.title}\n\n${task.description}` : task.title;
  if (dependencies.length === 0) return instructions;
  const sections = dependencies.map((dependency) => {
    const result = String(dependency.result || "No written result was provided.")
      .slice(0, MAX_PREREQUISITE_RESULT_LENGTH);
    const artifacts = (dependency.deliveredWork || []).map(artifactReference).join("\n") || "- None";
    return `## ${dependency.title}\nTask ID: ${dependency.id}\n\nResult:\n${result}\n\nDelivered files:\n${artifacts}`;
  });
  const suffix = `\n\n# Current task\n${instructions}\n\nUse the prerequisite results and delivered files above as authoritative input. Continue from that work; do not redo or ignore it.`;
  const prefix = "# Prerequisite work\n\n";
  const available = MAX_WORKER_PROMPT_LENGTH - prefix.length - suffix.length;
  if (available < 0) throw new Error("Task instructions are too long to include required prerequisite context.");
  const context = sections.join("\n\n").slice(0, available);
  return `${prefix}${context}${suffix}`;
}

export function createOfficeTask(uiStateStore, { title, description = "", priority = "medium", projectId = "central-office", dependsOn, depends_on: dependsOnSnake } = {}) {
  uiStateStore.requireProject?.(projectId);
  const normalizedTitle = String(title || "").trim();
  if (!normalizedTitle) throw new Error("Task instructions are required.");
  if (normalizedTitle.length > 100_000) throw new Error("Task instructions are too long.");
  const normalizedDescription = String(description || "").trim();
  if (normalizedTitle.length + normalizedDescription.length > MAX_WORKER_PROMPT_LENGTH - 2) throw new Error("Task instructions are too long.");
  const normalizedPriority = PRIORITIES.has(priority) ? priority : "medium";
  const suppliedDependencies = Array.isArray(dependsOn)
    ? dependsOn
    : Array.isArray(dependsOnSnake) ? dependsOnSnake : [];
  const dependencyIds = [...new Set(suppliedDependencies.map((id) => String(id || "").trim()).filter(Boolean))];
  if (dependencyIds.length > 20) throw new Error("A task cannot have more than 20 dependencies.");
  const knownIds = new Set(uiStateStore.getOfficeTasks({ limit: 500, projectId }).map((task) => task.id));
  const unknown = dependencyIds.find((id) => !knownIds.has(id));
  if (unknown) throw new Error(`Unknown task dependency: ${unknown}`);
  return uiStateStore.createOfficeTask({ title: normalizedTitle, description: normalizedDescription, priority: normalizedPriority, dependsOn: dependencyIds, projectId });
}

export function readOfficeTasks(uiStateStore, subAgentManager, filters = {}) {
  return {
    tasks: uiStateStore.getOfficeTasks(filters).map(task => {
      const remote = subAgentManager?.listTasks?.().find(entry => entry.messageId === task.messageId);
      return remote ? { ...task, a2aState: remote.state, remoteTaskId: remote.remoteTaskId, contextId: remote.contextId, agentMessage: remote.text, connectionError: remote.connectionError } : task;
    }),
    workers: subAgentManager?.listWorkers() || [],
  };
}

export function startOfficeTask(uiStateStore, subAgentManager, { id, agent, timeoutMs }) {
  const task = uiStateStore.getOfficeTasks({ id: String(id), limit: 500 }).find((entry) => entry.id === String(id));
  if (!task) throw new Error(`Unknown task: ${id || "(empty)"}`);
  if (task.status !== "pending") throw new Error(`Task ${task.id} has already been assigned.`);
  const tasks = uiStateStore.getOfficeTasks({ projectId: task.projectId, limit: 500 });
  const byId = new Map(tasks.map((entry) => [entry.id, entry]));
  const blockedBy = (task.dependsOn || []).filter((dependencyId) => byId.get(dependencyId)?.status !== "completed");
  if (blockedBy.length) throw new Error(`Task is waiting for dependencies: ${blockedBy.join(", ")}`);
  const worker = subAgentManager?.listWorkers().find((entry) => entry.name === String(agent));
  if (!worker) throw new Error(`Unknown agent: ${agent || "(empty)"}`);
  let workerPrompt = buildDependentTaskPrompt(task, tasks);
  if (task.projectId && task.projectId !== "central-office") {
    const project = uiStateStore.requireProject(task.projectId);
    workerPrompt = `Project: ${project.name} (${project.id})\nStatus: ${project.status}\nDescription: ${project.description}\nKeep this work and its files within this project. Deliveries will be stored in workspace folder ${project.id}/.\n\n${workerPrompt}`;
  }
  const queued = subAgentManager.queue({
    agent: worker.name,
    task: workerPrompt,
    title: task.title,
    priority: task.priority,
    projectId: task.projectId,
    officeTaskId: task.id,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  const assigned = uiStateStore.assignOfficeTask(task.id, { agent: worker.name, messageId: queued.task.messageId });
  const completion = queued.completion.then((result) => {
    uiStateStore.completeOfficeTask(task.id, {
      status: result.ok ? "completed" : ["timed_out", "cancelled"].includes(result.status) ? result.status : "failed",
      workerTaskId: result.taskId,
      result: result.text,
      error: result.error,
      deliveredWork: result.deliveredWork || [],
    });
    return result;
  }).catch((error) => {
    uiStateStore.completeOfficeTask(task.id, { status: "failed", error: error.message });
    throw error;
  });
  return { task: assigned, completion };
}

export function assignOfficeTask(uiStateStore, subAgentManager, options) {
  const assignment = startOfficeTask(uiStateStore, subAgentManager, options);
  // The queue endpoint returns immediately; completion is persisted asynchronously.
  void assignment.completion.catch(() => {});
  return assignment.task;
}

export async function cancelOfficeTask(uiStateStore, subAgentManager, { id, reason } = {}) {
  const task = uiStateStore.getOfficeTasks({ id: String(id), limit: 500 }).find(entry => entry.id === String(id));
  if (!task) throw new Error(`Unknown task: ${id || '(empty)'}`);
  if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;
  if (task.status === 'pending') return uiStateStore.cancelOfficeTask(task.id, { error: reason });
  const remote = await subAgentManager.cancelTask({ messageId: task.messageId });
  if (!['completed', 'failed', 'cancelled', 'rejected'].includes(remote.state)) throw new Error('Agent has not confirmed cancellation. The task remains active.');
  return uiStateStore.completeOfficeTask(task.id, {
    status: remote.state === 'rejected' ? 'failed' : remote.state,
    workerTaskId: remote.remoteTaskId || remote.taskId, result: remote.text,
    error: remote.error, deliveredWork: remote.deliveredWork || [],
  });
}

export async function continueOfficeTask(uiStateStore, subAgentManager, { id, text }) {
  const task = uiStateStore.getOfficeTasks({ id: String(id), limit: 1 })[0];
  if (!task) throw new Error('Unknown Office task.');
  return subAgentManager.continueTask({ messageId: task.messageId, text });
}

export function deleteOfficeTask(uiStateStore, { id } = {}) {
  const task = uiStateStore.getOfficeTasks({ id: String(id), limit: 500 }).find((entry) => entry.id === String(id));
  if (!task) throw new Error(`Unknown task: ${id || "(empty)"}`);
  if (task.status === "running") throw new Error("Stop the running task before deleting it.");
  const dependents = uiStateStore.getOfficeTaskDependents(task.id);
  if (dependents.length) {
    const names = dependents.slice(0, 3).map((entry) => `“${entry.title}”`).join(", ");
    throw new Error(`Delete dependent tasks first: ${names}${dependents.length > 3 ? ` and ${dependents.length - 3} more` : ""}.`);
  }
  uiStateStore.deleteOfficeTask(task.id);
  return task;
}
