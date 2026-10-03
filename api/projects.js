import { clearManagedDirectory } from "../lib/factory-reset.js";
import { json, methodNotAllowed, readRequestBody } from "./http.js";
import { projectWorkspace } from "../lib/projects.js";
import { canAccessProject, requireProjectAccess } from '../lib/project-access.js';

export function createProjectApiHandlers({ uiStateStore, sharedWorkspaceRoot, userStore, subAgentManager, isProjectManagerBusy = () => false }) {
  return {
    '/api/projects/clear': async (req, res) => {
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
      try {
        const body = JSON.parse(await readRequestBody(req, 20000) || '{}');
        if (!body.projectId) throw new Error('Choose a project.');
        const project = uiStateStore.requireProject(body.projectId);
        requireProjectAccess(req.user, project.id, project);
        if (req.user.role !== 'admin' && project.ownerId !== req.user.id) return json(res, 403, { ok: false, error: 'Only the project owner or an administrator can clear project data.' });
        if (!['chats', 'tasks', 'workspace', 'operations', 'memory'].includes(body.section)) throw new Error('Choose a project section to clear.');
        const belongsHere = task => (task.projectId || 'central-office') === project.id;
        const activeWorkers = (subAgentManager?.listTasks() || []).some(task => belongsHere(task) && !['completed', 'failed', 'timed_out', 'cancelled'].includes(task.state));
        const activeMessages = (subAgentManager?.listDirectMessages() || []).some(belongsHere);
        const activeTasks = uiStateStore.getOfficeTasks({ projectId: project.id, status: 'running', limit: 500 }).length > 0;
        if (isProjectManagerBusy(project.id) || activeWorkers || activeMessages || activeTasks) return json(res, 409, { ok: false, error: 'Stop active work in this project before clearing its data.' });
        const removed = body.section === 'workspace'
          ? await clearManagedDirectory(await projectWorkspace(sharedWorkspaceRoot, project.id), { protectedPaths: [sharedWorkspaceRoot] })
          : uiStateStore.clearProjectData(project.id, body.section);
        json(res, 200, { ok: true, projectId: project.id, section: body.section, removed });
      } catch (error) { json(res, error.statusCode || 400, { ok: false, error: error.message }); }
    },
    '/api/project-invitations': async (req, res) => {
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
      try {
        const body = JSON.parse(await readRequestBody(req, 20000) || '{}');
        if (!body.projectId) throw new Error('Choose a project.');
        const project = uiStateStore.requireProject(body.projectId);
        requireProjectAccess(req.user, project.id, project);
        const [invitation] = userStore.createInvitations(project.id, [body.email], req.user.id);
        json(res, 201, { ok: true, invitation });
      } catch (error) { json(res, error.statusCode || 400, { ok: false, error: error.message }); }
    },
    '/api/project-members': (req, res) => {
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
      json(res, 200, { ok: true, users: (userStore?.list() || []).filter(user => !user.disabled && user.role !== 'pending' && user.id !== req.user?.id).map(({ id, name, email, avatar }) => ({ id, name, email, avatar })) });
    },
    "/api/projects": async (req, res) => {
    if (!["GET", "POST", "PUT"].includes(req.method)) return methodNotAllowed(res, "GET, POST, PUT");
    try {
      if (req.method === "GET") return json(res, 200, { ok: true, projects: uiStateStore.getProjects().filter(project => !req.user || canAccessProject(req.user, project.id, project)) });
      const body = JSON.parse(await readRequestBody(req, 20000) || "{}");
      if (req.user && req.method === 'PUT') requireProjectAccess(req.user, body.id);
      if (body.isPublic !== undefined && typeof body.isPublic !== 'boolean') throw new Error('Choose public or private.');
      const memberIds = body.isPublic ? [] : body.memberIds || [];
      const emails = body.isPublic ? [] : body.inviteEmails || [];
      if (!Array.isArray(memberIds) || memberIds.length > 50 || !Array.isArray(emails) || emails.length > 50) throw new Error('Add at most 50 members or invitations.');
      if (emails.some(email => typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) throw new Error('Enter valid invitation email addresses.');
      const available = userStore?.list() || [];
      if (memberIds.some(id => !available.some(user => user.id === id && !user.disabled && user.role !== 'pending'))) throw new Error('Choose active registered users.');
      if ((emails.length || memberIds.length) && !req.user) throw new Error('Sign in to invite members.');
      const project = req.method === "POST" ? uiStateStore.createProject({ name: body.name, description: body.description, isPublic: body.isPublic || false, ownerId: req.user?.id || null }) : uiStateStore.updateProject(body);
      if (req.method === 'POST' && req.user?.role === 'member') userStore.grantProject(req.user.id, project.id);
      await projectWorkspace(sharedWorkspaceRoot, project.id);
      let invitations = [];
      if (req.method === 'POST') {
        for (const id of new Set(memberIds)) userStore.grantProject(id, project.id);
        if (emails.length) invitations = userStore.createInvitations(project.id, emails, req.user.id);
      }
      json(res, req.method === "POST" ? 201 : 200, { ok: true, project, invitations });
    } catch (error) { json(res, error.statusCode || 400, { ok: false, error: error.message }); }
  } };
}
