import fs from 'node:fs/promises';
import path from 'node:path';
import { json, readRequestBody } from './http.js';
import { requireProjectAccess } from '../lib/project-access.js';

// Authentication runs before this guard. Worker endpoints have separate bearer authorization.
export async function guardProjectRequest(req, res, url, { uiStateStore, sharedWorkspaceRoot }) {
  if (req.user?.role !== 'member') return false;
  const route = url.pathname;
  try {
    if (route === '/api/projects') return false;
    if (route === '/api/project-members' && req.method === 'GET') return false;
    if (['/api/health', '/api/sub-agents', '/api/system-logs'].includes(route) && req.method === 'GET') return false;
    if (route === '/api/system-logs' && req.method === 'POST') return false;
    if (route === '/api/workspace-file-asset' && req.method === 'GET' && url.searchParams.has('projectId')) {
      const project = uiStateStore.requireProject(url.searchParams.get('projectId'));
      requireProjectAccess(req.user, project.id, project);
      return false;
    }
    if (route === '/api/skills' && req.method === 'GET') { json(res, 200, { ok: true, skills: [] }); return true; }
    if (['/api/tasks', '/api/chat', '/api/operations', '/api/memory', '/api/shared-workspace', '/api/project-invitations'].includes(route)) {
      let projectId = url.searchParams.get('projectId') || 'central-office';
      if (!['GET', 'HEAD'].includes(req.method)) {
        const body = JSON.parse(await readRequestBody(req, 120_000) || '{}');
        projectId = body.projectId || 'central-office';
        if (route === '/api/tasks' && req.method !== 'POST') {
          const task = uiStateStore.getOfficeTasks({ id: String(body.id), limit: 1 })[0];
          if (!task) throw Object.assign(new Error('Task not found.'), { statusCode: 404 });
          requireProjectAccess(req.user, task.projectId || 'central-office');
        }
        for (const id of body.dependsOn || body.depends_on || []) {
          const task = uiStateStore.getOfficeTasks({ id: String(id), limit: 1 })[0];
          if (!task || task.projectId !== projectId) throw Object.assign(new Error('Task dependency is outside this project.'), { statusCode: 403 });
        }
      } else if (!url.searchParams.get('projectId')) {
        // These APIs otherwise allow an unscoped, office-wide listing.
        url.searchParams.set('projectId', projectId);
      }
      requireProjectAccess(req.user, projectId);
      return false;
    }
    if (route.startsWith('/files/') || route === '/api/shared-workspace-file') {
      const requested = route.startsWith('/files/') ? decodeURIComponent(route.slice(7)) : url.searchParams.get('path');
      const parts = String(requested || '').split('/');
      if (parts.some(part => part === '..' || part === '.') || String(requested).includes('\\')) throw new Error('Invalid file path.');
      requireProjectAccess(req.user, parts[0]);
      const base = await fs.realpath(sharedWorkspaceRoot);
      const file = await fs.realpath(path.resolve(base, requested));
      const relative = path.relative(base, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid file path.');
      requireProjectAccess(req.user, relative.split(path.sep)[0]);
      return false;
    }
    if (route.startsWith('/downloads/tasks/')) {
      requireProjectAccess(req.user, decodeURIComponent(route.split('/')[3] || ''));
      return false;
    }
    throw Object.assign(new Error('Administrator access required.'), { statusCode: 403 });
  } catch (error) {
    json(res, error.statusCode || 403, { ok: false, error: error.statusCode ? error.message : 'Project access denied.' });
    return true;
  }
}
