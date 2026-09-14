import { json, methodNotAllowed, readRequestBody } from "./http.js";

const UNIT_MILLISECONDS = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

export function operationIntervalMs(operation) {
  return operation.intervalValue * UNIT_MILLISECONDS[operation.intervalUnit];
}

function normalizeOperation(body, workers) {
  const name = String(body.name || "").trim();
  const task = String(body.task || "").trim();
  const agent = String(body.agent || "auto");
  const intervalValue = Number(body.intervalValue);
  const intervalUnit = String(body.intervalUnit || "hours");
  const priority = String(body.priority || "medium");
  const enabled = body.enabled !== false;
  if (!name) throw new Error("Operation name is required.");
  if (name.length > 100) throw new Error("Operation name must be 100 characters or fewer.");
  if (!task) throw new Error("Task instructions are required.");
  if (task.length > 100_000) throw new Error("Task instructions are too long.");
  if (!Number.isInteger(intervalValue) || intervalValue < 1 || intervalValue > 10_000) {
    throw new Error("Interval must be a whole number from 1 to 10,000.");
  }
  if (!Object.hasOwn(UNIT_MILLISECONDS, intervalUnit)) throw new Error("Unsupported interval unit.");
  if (!["low", "medium", "high"].includes(priority)) throw new Error("Unsupported priority.");
  if (agent !== "auto" && !workers.some((worker) => worker.name === agent)) {
    throw new Error(`Unknown agent: ${agent}`);
  }
  return {
    name, task, agent, intervalValue, intervalUnit, priority, enabled,
    nextRunAt: enabled ? Date.now() + intervalValue * UNIT_MILLISECONDS[intervalUnit] : null,
  };
}

export function createOperationsApiHandlers({ uiStateStore, subAgentManager }) {
  async function handleOperationsApi(req, res, url) {
    if (req.method === "GET") {
      try {
        const projectId = url?.searchParams.get("projectId") || "central-office";
        uiStateStore.requireProject(projectId);
        json(res, 200, { ok: true, operations: uiStateStore.getPeriodicOperations({ projectId }) });
      } catch (error) { json(res, 400, { ok: false, error: error.message }); }
      return;
    }
    if (!["POST", "PUT", "DELETE"].includes(req.method)) {
      methodNotAllowed(res, "GET, POST, PUT, DELETE");
      return;
    }
    try {
      const body = JSON.parse(await readRequestBody(req, 120_000) || "{}");
      const projectId = body.projectId || "central-office";
      uiStateStore.requireProject(projectId);
      if (req.method !== "POST" && !uiStateStore.getPeriodicOperations({ projectId }).some((operation) => operation.id === body.id)) throw new Error("Operation is outside the current project.");
      if (req.method === "DELETE") {
        uiStateStore.deletePeriodicOperation(body.id);
        json(res, 200, { ok: true, operations: uiStateStore.getPeriodicOperations({ projectId }) });
        return;
      }
      const operation = { ...normalizeOperation(body, subAgentManager?.listWorkers() || []), projectId };
      const saved = req.method === "POST"
        ? uiStateStore.createPeriodicOperation(operation)
        : uiStateStore.updatePeriodicOperation(body.id, operation);
      json(res, req.method === "POST" ? 201 : 200, {
        ok: true,
        operation: saved,
        operations: uiStateStore.getPeriodicOperations({ projectId }),
      });
    } catch (error) {
      json(res, 400, { ok: false, error: error.message });
    }
  }

  return { "/api/operations": handleOperationsApi };
}
