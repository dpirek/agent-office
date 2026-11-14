import crypto from 'node:crypto';
import { canAccessProject } from '../lib/project-access.js';
import { json, methodNotAllowed, readRequestBody } from './http.js';

export function createSubAgentApiHandlers({ subAgentManager, uiStateStore }) {
  return { '/api/worker-token': async (req, res) => {
    if (req.user?.role !== 'admin') return json(res, 403, { ok: false, error: 'Administrator access required.' });
    if (req.method === 'GET') return json(res, 200, { ok: true, configured: Boolean(uiStateStore.getWorkerToken()), name: uiStateStore.getWorkerTokenName() });
    if (req.method !== 'POST') return methodNotAllowed(res, 'GET, POST');
    try {
      const body = JSON.parse(await readRequestBody(req, 32_000) || '{}');
      const name = String(body.name || '').trim();
      if (!name || name.length > 100) throw new Error('Token name must be between 1 and 100 characters.');
      const token = crypto.randomBytes(32).toString('base64url');
      uiStateStore.setWorkerToken(token, name);
      res.setHeader?.('cache-control', 'no-store');
      return json(res, 201, { ok: true, name, token, environmentVariable: `AI_HARNESS_WORKER_TOKEN=${token}` });
    } catch (error) { return json(res, 400, { ok: false, error: error.message }); }
  }, '/api/sub-agents': async (req, res) => {
    if (req.method === 'GET') {
      const rigs = uiStateStore?.getRigConfigurations?.();
      const active = rigs?.configurations?.find(entry => entry.id === rigs.activeConfigurationId);
      return json(res, 200, {
        ok: true, transport: 'a2a', transports: ['a2a', 'websocket'], workerSocketPath: '/ws/workers',
        workerTokenConfigured: Boolean(uiStateStore?.getWorkerToken?.()), workerTokenName: uiStateStore?.getWorkerTokenName?.() || '', protocolVersion: '1.0', supportedBindings: ['JSONRPC', 'HTTP+JSON'],
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
