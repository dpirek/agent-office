import crypto from "node:crypto";
import { json, methodNotAllowed } from "./http.js";

export function createSubAgentApiHandlers({ subAgentManager, uiStateStore }) {
  function handleSubAgentsApi(req, res) {
    if (req.method !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }
    const rigs = uiStateStore?.getRigConfigurations?.();
    const active = rigs?.configurations?.find((configuration) => configuration.id === rigs.activeConfigurationId);
    json(res, 200, {
      ok: true,
      transport: "websocket",
      workerSocketPath: "/ws/workers",
      authentication: "bearer-token",
      workerTokenConfigured: Boolean(uiStateStore?.getWorkerToken?.()),
      workers: subAgentManager?.listWorkers() || [],
      tasks: subAgentManager?.listTasks() || [],
      orchestrator: active ? {
        id: active.id,
        name: active.name,
        provider: active.providerSettings?.provider,
        model: active.providerSettings?.model,
        tools: Object.entries(active.toolPermissions || {}).filter(([, enabled]) => enabled).map(([name]) => name),
      } : null,
    });
  }

  function handleWorkerTokenApi(req, res) {
    if (req.method === "GET") {
      json(res, 200, { ok: true, configured: Boolean(uiStateStore?.getWorkerToken?.()) });
      return;
    }
    if (req.method !== "POST") {
      methodNotAllowed(res, "GET, POST");
      return;
    }
    const token = crypto.randomBytes(32).toString("base64url");
    uiStateStore.setWorkerToken(token);
    json(res, 201, { ok: true, token, environmentVariable: `AI_HARNESS_WORKER_TOKEN=${token}` });
  }

  return { "/api/sub-agents": handleSubAgentsApi, "/api/worker-token": handleWorkerTokenApi };
}
