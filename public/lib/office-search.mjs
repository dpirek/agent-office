import { projectPagePath } from './project-routes.mjs';
import { workspaceFileUrl } from './file-url.mjs';

export function searchOfficeData(query, data, projectId = 'central-office') {
  const terms = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const entries = [];
  const add = (type, id, title, description, href, extra = {}) => entries.push({ type, id, title: String(title || ''), description: String(description || ''), href, ...extra });
  for (const worker of data.agents?.workers || []) {
    add('Agents', worker.name, worker.name, [worker.description, worker.status, ...(worker.capabilities?.tools || []), ...(worker.capabilities?.skills || []).map(skill => skill.name)].filter(Boolean).join(' · '), projectPagePath('dashboard', projectId), { agent: worker.name });
  }
  if (data.agents?.orchestrator) add('Agents', 'office-manager', 'Office Manager', 'Internal orchestrator · Coordinates tasks and agents', projectPagePath('dashboard', projectId), { agent: 'Office Manager' });
  for (const task of data.tasks?.tasks || []) {
    if ((task.projectId || 'central-office') !== projectId) continue;
    add('Tasks', task.id, task.title, [task.description, task.agent || 'Unassigned', task.status].filter(Boolean).join(' · '), projectPagePath('tasks', projectId), { taskId: task.id });
  }
  const files = nodes => {
    for (const node of nodes || []) {
      if (node.type === 'directory') files(node.children);
      else if (node.type === 'file') add('Files', node.path, node.name, node.path, workspaceFileUrl(node.path));
    }
  };
  files(data.files?.tree);
  for (const operation of data.operations?.operations || []) {
    if (operation.projectId && operation.projectId !== projectId) continue;
    add('Operations', operation.id, operation.name, `${operation.task || ''} · ${operation.enabled ? 'Enabled' : 'Disabled'}`, projectPagePath('operations', projectId));
  }
  for (const skill of data.skills?.skills || []) add('Skills', skill.id, skill.name, skill.content, '/knowledge');
  return entries.filter(entry => terms.every(term => `${entry.title} ${entry.description}`.toLowerCase().includes(term)))
    .sort((a, b) => Number(b.title.toLowerCase().includes(query.trim().toLowerCase())) - Number(a.title.toLowerCase().includes(query.trim().toLowerCase())) || a.title.localeCompare(b.title))
    .map(entry => ({ ...entry, description: entry.description.replace(/\s+/g, ' ').slice(0, 240) }));
}

export async function loadOfficeSearch(projectId, { signal, fetchImpl = fetch } = {}) {
  const project = encodeURIComponent(projectId);
  const sources = { agents: '/api/sub-agents', tasks: `/api/tasks?projectId=${project}`, files: `/api/shared-workspace?projectId=${project}`, operations: `/api/operations?projectId=${project}`, skills: '/api/skills' };
  const entries = Object.entries(sources);
  const results = await Promise.allSettled(entries.map(async ([, url]) => {
    const response = await fetchImpl(url, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }));
  if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
  const data = {}, unavailable = [];
  results.forEach((result, index) => {
    const name = entries[index][0];
    if (result.status === 'fulfilled') data[name] = result.value;
    else unavailable.push(name);
  });
  return { data, unavailable };
}
