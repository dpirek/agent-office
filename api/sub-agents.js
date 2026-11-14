import { canAccessProject } from '../lib/project-access.js';
import { json, methodNotAllowed, readRequestBody } from './http.js';

export function createSubAgentApiHandlers({ subAgentManager, uiStateStore }) {
  return { '/api/sub-agents': async (req, res) => {
    if (req.method === 'GET') {
      const rigs = uiStateStore?.getRigConfigurations?.();
      const active = rigs?.configurations?.find(entry => entry.id === rigs.activeConfigurationId);
      return json(res, 200, {
        ok: true, transport: 'a2a', protocolVersion: '1.0', supportedBindings: ['JSONRPC', 'HTTP+JSON'],
        workers: subAgentManager?.listRegisteredWorkers?.() || subAgentManager?.listWorkers() || [],
        tasks: (subAgentManager?.listTasks() || []).filter(task => !req.user || canAccessProject(req.user, task.projectId || 'central-office')),
        orchestrator: active ? { id: active.id, name: active.name, provider: active.providerSettings?.provider, model: active.providerSettings?.model, tools: Object.entries(active.toolPermissions || {}).filter(([, enabled]) => enabled).map(([name]) => name) } : null,
      });
    }
    if (!['POST', 'DELETE'].includes(req.method)) return methodNotAllowed(res, 'GET, POST, DELETE');
    if (req.user?.role !== 'admin') return json(res, 403, { ok: false, error: 'Administrator access required.' });
    try {
      const body = JSON.parse(await readRequestBody(req, 32_000) || '{}');
      if (req.method === 'DELETE') {
        subAgentManager.removeWorker(String(body.name || ''));
        return json(res, 200, { ok: true });
      }
      const worker = await subAgentManager.registerWorker({ url: String(body.url || ''), ...(body.name ? { name: String(body.name) } : {}), ...(body.cardPath !== undefined ? { cardPath: String(body.cardPath) } : {}), ...(body.token ? { token: String(body.token) } : {}), ...(body.headers ? { headers: body.headers } : {}) });
      return json(res, 201, { ok: true, worker });
    } catch (error) { return json(res, 400, { ok: false, error: error.message }); }
  } };
}
