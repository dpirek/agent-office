import { json, methodNotAllowed, readRequestBody } from "./http.js";
import { projectWorkspace } from "../lib/projects.js";

export function createProjectApiHandlers({ uiStateStore, sharedWorkspaceRoot }) {
  return { "/api/projects": async (req, res) => {
    if (!["GET", "POST", "PUT"].includes(req.method)) return methodNotAllowed(res, "GET, POST, PUT");
    try {
      if (req.method === "GET") return json(res, 200, { ok: true, projects: uiStateStore.getProjects() });
      const body = JSON.parse(await readRequestBody(req, 20000) || "{}");
      const project = req.method === "POST" ? uiStateStore.createProject(body) : uiStateStore.updateProject(body);
      await projectWorkspace(sharedWorkspaceRoot, project.id);
      json(res, req.method === "POST" ? 201 : 200, { ok: true, project });
    } catch (error) { json(res, 400, { ok: false, error: error.message }); }
  } };
}
