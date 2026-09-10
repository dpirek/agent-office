import crypto from "node:crypto";
import { json, methodNotAllowed, readRequestBody } from "./http.js";

export function createSubAgentApiHandlers({ subAgentManager, uiStateStore }) {
  function handleSubAgentsApi(req, res) {
    if (req.method !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }
    const rigs = uiStateStore?.getRigConfigurations?.();
    const active = rigs?.configurations?.find((configuration) => configuration.id === rigs.activeConfigurationId);
    const liveWorkers = subAgentManager?.listWorkers() || [];
    const workers = new Map((uiStateStore?.getRegisteredWorkers?.() || []).map((worker) => [worker.name, worker]));
    for (const worker of liveWorkers) workers.set(worker.name, worker);
    json(res, 200, {
      ok: true,
      transport: "websocket",
      workerSocketPath: "/ws/workers",
      authentication: "bearer-token",
      workerTokenConfigured: Boolean(uiStateStore?.getWorkerToken?.()),
      workerTokenName: uiStateStore?.getWorkerTokenName?.() || "",
      workers: [...workers.values()].sort((left, right) => (
        Number(right.status === "connected") - Number(left.status === "connected") || left.name.localeCompare(right.name)
      )),
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

  async function handleWorkerTokenApi(req, res) {
    if (req.method === "GET") {
      json(res, 200, {
        ok: true,
        configured: Boolean(uiStateStore?.getWorkerToken?.()),
        name: uiStateStore?.getWorkerTokenName?.() || "",
      });
      return;
    }
    if (req.method !== "POST") {
      methodNotAllowed(res, "GET, POST");
      return;
    }
    const body = JSON.parse((await readRequestBody(req)) || "{}");
    const name = String(body.name || "").trim();
    if (!name || name.length > 100) {
      json(res, 400, { ok: false, error: "Token name must be between 1 and 100 characters." });
      return;
    }
    const token = crypto.randomBytes(32).toString("base64url");
    uiStateStore.setWorkerToken(token, name);
    json(res, 201, { ok: true, name, token, environmentVariable: `AI_HARNESS_WORKER_TOKEN=${token}` });
  }

  return { "/api/sub-agents": handleSubAgentsApi, "/api/worker-token": handleWorkerTokenApi };
}
