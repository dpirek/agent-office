import { json, methodNotAllowed, readRequestBody } from "./http.js";

const ACTIVE_STATES = new Set(["submitting", "working", "running", "pending"]);

export function selectAutoAssignedWorker(workers, tasks) {
  if (!workers.length) throw new Error("Register at least one HTTP agent before creating a task.");
  const workload = new Map(workers.map((worker) => [worker.name, { active: 0, total: 0 }]));
  for (const task of tasks) {
    const count = workload.get(task.agent);
    if (!count) continue;
    count.total += 1;
    if (ACTIVE_STATES.has(task.state)) count.active += 1;
  }
  return [...workers].sort((left, right) => {
    const a = workload.get(left.name);
    const b = workload.get(right.name);
    return a.active - b.active || a.total - b.total || left.name.localeCompare(right.name);
  })[0];
}

export function createTaskApiHandlers({ subAgentManager }) {
  async function handleTasksApi(req, res) {
    if (!subAgentManager) {
      json(res, 503, { ok: false, error: "Sub-agent support is not configured." });
      return;
    }
    if (req.method === "GET") {
      json(res, 200, { ok: true, workers: subAgentManager.listWorkers(), tasks: subAgentManager.listTasks() });
      return;
    }
    if (req.method !== "POST") {
      methodNotAllowed(res, "GET, POST");
      return;
    }

    try {
      const body = JSON.parse(await readRequestBody(req, 100_000) || "{}");
      const title = String(body.title || body.task || "").trim();
      if (!title) throw new Error("Task instructions are required.");
      const workers = subAgentManager.listWorkers();
      const requestedAgent = String(body.agent || "auto");
      const worker = requestedAgent === "auto"
        ? selectAutoAssignedWorker(workers, subAgentManager.listTasks())
        : workers.find((entry) => entry.name === requestedAgent);
      if (!worker) throw new Error(`Unknown agent: ${requestedAgent || "(empty)"}`);
      const priority = ["low", "medium", "high"].includes(body.priority) ? body.priority : "medium";
      const queued = subAgentManager.queue({ agent: worker.name, task: title, priority });
      void queued.completion.catch(() => {});
      json(res, 202, { ok: true, autoAssigned: requestedAgent === "auto", task: queued.task });
    } catch (error) {
      json(res, 400, { ok: false, error: error.message });
    }
  }

  return { "/api/tasks": handleTasksApi };
}
