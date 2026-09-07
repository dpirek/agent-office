import { json, methodNotAllowed, readRequestBody } from "./http.js";

export function createSubAgentApiHandlers({
  subAgentManager,
  uiStateStore,
  onRigConfigurationsChanged = () => {},
}) {
  function activeRigSnapshot() {
    const rigs = uiStateStore?.getRigConfigurations?.();
    const active = rigs?.configurations?.find(
      (configuration) => configuration.id === rigs.activeConfigurationId,
    );
    if (!active) throw new Error("No active rig configuration is available.");
    return { rigs, active };
  }

  function updateActiveWorkers(update) {
    const { rigs, active } = activeRigSnapshot();
    const subAgents = update(active.subAgents.map((worker) => ({ ...worker })));
    const configurations = rigs.configurations.map((configuration) => (
      configuration.id === active.id
        ? { ...configuration, subAgents, updatedAt: Date.now() }
        : configuration
    ));
    const result = uiStateStore.setRigConfigurations(configurations, active.id);
    onRigConfigurationsChanged(result);
    return subAgentManager?.listWorkers() || [];
  }

  async function handleSubAgentsApi(req, res) {
    if (req.method === "GET") {
      const rigs = uiStateStore?.getRigConfigurations?.();
      const active = rigs?.configurations?.find(
        (configuration) => configuration.id === rigs.activeConfigurationId,
      );
      json(res, 200, {
        ok: true,
        workers: subAgentManager?.listWorkers() || [],
        tasks: subAgentManager?.listTasks() || [],
        orchestrator: active ? {
          id: active.id,
          name: active.name,
          provider: active.providerSettings?.provider,
          model: active.providerSettings?.model,
          tools: Object.entries(active.toolPermissions || {})
            .filter(([, enabled]) => enabled)
            .map(([name]) => name),
        } : null,
      });
      return;
    }

    if (!["POST", "PUT", "DELETE"].includes(req.method)) {
      methodNotAllowed(res, "GET, POST, PUT, DELETE");
      return;
    }

    try {
      const body = JSON.parse(await readRequestBody(req, 20_000) || "{}");
      let workers;
      if (req.method === "POST") {
        workers = updateActiveWorkers((current) => {
          if (current.some((worker) => worker.name === body.name)) {
            throw new Error(`An agent named ${body.name} already exists.`);
          }
          return [...current, { name: body.name, url: body.url }];
        });
        json(res, 201, { ok: true, workers });
        return;
      }
      if (req.method === "PUT") {
        workers = updateActiveWorkers((current) => {
          const index = current.findIndex((worker) => worker.name === body.originalName);
          if (index < 0) throw new Error(`Unknown agent: ${body.originalName || "(empty)"}`);
          if (current.some((worker, workerIndex) => workerIndex !== index && worker.name === body.name)) {
            throw new Error(`An agent named ${body.name} already exists.`);
          }
          current[index] = { name: body.name, url: body.url };
          return current;
        });
        json(res, 200, { ok: true, workers });
        return;
      }
      workers = updateActiveWorkers((current) => {
        const next = current.filter((worker) => worker.name !== body.name);
        if (next.length === current.length) throw new Error(`Unknown agent: ${body.name || "(empty)"}`);
        return next;
      });
      json(res, 200, { ok: true, workers });
    } catch (error) {
      json(res, 400, { ok: false, error: error.message });
    }
  }

  async function handleSubAgentCallbackApi(req, res) {
    if (req.method !== "POST") {
      methodNotAllowed(res, "POST");
      return;
    }
    if (!subAgentManager) {
      json(res, 503, { ok: false, error: "Sub-agent support is not configured." });
      return;
    }
    try {
      const payload = JSON.parse(await readRequestBody(req, 1_000_000) || "{}");
      const result = subAgentManager.receiveCallback(req.headers.authorization, payload);
      json(res, result.status, result.body);
    } catch (error) {
      json(res, 400, { ok: false, error: error.message });
    }
  }

  return {
    "/api/sub-agents": handleSubAgentsApi,
    "/api/sub-agents/callback": handleSubAgentCallbackApi,
  };
}
