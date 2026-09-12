import { json, methodNotAllowed, readRequestBody } from "./http.js";
import { assignOfficeTask, cancelOfficeTask, createOfficeTask, deleteOfficeTask, readOfficeTasks } from "../lib/office-tasks.js";

export function createTaskApiHandlers({ subAgentManager, uiStateStore }) {
  async function handleTasksApi(req, res, url) {
    if (!subAgentManager) {
      json(res, 503, { ok: false, error: "Sub-agent support is not configured." });
      return;
    }
    if (req.method === "GET") {
      try {
        const projectId = url?.searchParams.get("projectId");
        if (projectId !== undefined && projectId !== null) uiStateStore.requireProject(projectId);
        json(res, 200, { ok: true, ...readOfficeTasks(uiStateStore, subAgentManager, projectId ? { projectId } : {}) });
      } catch (error) {
        json(res, 400, { ok: false, error: error.message });
      }
      return;
    }
    if (!["POST", "PUT", "DELETE"].includes(req.method)) {
      methodNotAllowed(res, "GET, POST, PUT, DELETE");
      return;
    }

    try {
      const body = JSON.parse(await readRequestBody(req, 100_000) || "{}");
      if (body.projectId) {
        uiStateStore.requireProject(body.projectId);
        if (req.method !== "POST" && !uiStateStore.getOfficeTasks({ id: String(body.id), projectId: body.projectId, limit: 500 }).some((task) => task.id === body.id)) throw new Error("Task is outside the current project.");
      }
      const task = req.method === "POST"
        ? createOfficeTask(uiStateStore, body)
        : req.method === "PUT"
          ? assignOfficeTask(uiStateStore, subAgentManager, { id: body.id, agent: body.agent })
          : body.action === "delete"
            ? deleteOfficeTask(uiStateStore, { id: body.id })
            : cancelOfficeTask(uiStateStore, subAgentManager, { id: body.id, reason: body.reason });
      json(res, req.method === "POST" ? 201 : req.method === "PUT" ? 202 : 200, { ok: true, task });
    } catch (error) {
      json(res, 400, { ok: false, error: error.message });
    }
  }

  return { "/api/tasks": handleTasksApi };
}
