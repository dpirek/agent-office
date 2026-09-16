import { json, methodNotAllowed, readRequestBody } from "./http.js";
import { projectWorkspace } from "../lib/projects.js";
import { canAccessProject, requireProjectAccess } from '../lib/project-access.js';

export function createProjectApiHandlers({ uiStateStore, sharedWorkspaceRoot, userStore }) {
  return { "/api/projects": async (req, res) => {
    if (!["GET", "POST", "PUT"].includes(req.method)) return methodNotAllowed(res, "GET, POST, PUT");
    try {
      if (req.method === "GET") return json(res, 200, { ok: true, projects: uiStateStore.getProjects().filter(project => !req.user || canAccessProject(req.user, project.id)) });
      const body = JSON.parse(await readRequestBody(req, 20000) || "{}");
      if (req.user && req.method === 'PUT') requireProjectAccess(req.user, body.id);
      const project = req.method === "POST" ? uiStateStore.createProject(body) : uiStateStore.updateProject(body);
      if (req.method === 'POST' && req.user?.role === 'member') userStore.grantProject(req.user.id, project.id);
      await projectWorkspace(sharedWorkspaceRoot, project.id);
      json(res, req.method === "POST" ? 201 : 200, { ok: true, project });
    } catch (error) { json(res, error.statusCode || 400, { ok: false, error: error.message }); }
  } };
}
