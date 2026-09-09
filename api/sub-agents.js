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

  return { "/api/sub-agents": handleSubAgentsApi };
}
