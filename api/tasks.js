import { json, methodNotAllowed, readRequestBody } from "./http.js";
import { assignOfficeTask, createOfficeTask, readOfficeTasks } from "../lib/office-tasks.js";

export function createTaskApiHandlers({ subAgentManager, uiStateStore }) {
  async function handleTasksApi(req, res) {
    if (!subAgentManager) {
      json(res, 503, { ok: false, error: "Sub-agent support is not configured." });
      return;
    }
    if (req.method === "GET") {
      json(res, 200, { ok: true, ...readOfficeTasks(uiStateStore, subAgentManager) });
      return;
    }
    if (!["POST", "PUT"].includes(req.method)) {
      methodNotAllowed(res, "GET, POST, PUT");
      return;
    }

    try {
      const body = JSON.parse(await readRequestBody(req, 100_000) || "{}");
      const task = req.method === "POST"
        ? createOfficeTask(uiStateStore, body)
        : assignOfficeTask(uiStateStore, subAgentManager, { id: body.id, agent: body.agent });
      json(res, req.method === "POST" ? 201 : 202, { ok: true, task });
    } catch (error) {
      json(res, 400, { ok: false, error: error.message });
    }
  }

  return { "/api/tasks": handleTasksApi };
}
