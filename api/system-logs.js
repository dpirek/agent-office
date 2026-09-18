import { json, methodNotAllowed, readRequestBody } from "./http.js";

// Older/open tabs may still post telemetry. With no destination, discard it
// before authentication and HTTP activity recording; never ingest the body.
export function discardDisabledLogPost(req, res, url, store) {
  if (req.method !== 'POST' || url.pathname !== '/api/system-logs') return false;
  if (store.liveLoggingEnabled !== false && store.getObservabilityProviders().some(provider => provider.enabled)) return false;
  req.resume();
  res.writeHead(204, { 'cache-control': 'no-store' });
  res.end();
  return true;
}

export function createSystemLogApiHandlers({ uiStateStore }) {
  async function handleSystemLogsApi(req, res, url) {
    if (uiStateStore.liveLoggingEnabled === false) {
      if (req.method === "GET") json(res, 200, { ok: true, logs: [], liveLoggingEnabled: false, forwardingEnabled: false });
      else if (req.method === "POST") { req.resume(); res.writeHead(204); res.end(); }
      else methodNotAllowed(res, "GET, POST");
      return;
    }
    if (req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || 200);
      json(res, 200, {
        ok: true,
        logs: req.user?.role === 'member' ? [] : uiStateStore.getSystemActivity({ limit }),
        forwardingEnabled: uiStateStore.getObservabilityProviders().some(provider => provider.enabled),
      });
      return;
    }
    if (req.method !== "POST") {
      methodNotAllowed(res, "GET, POST");
      return;
    }
    try {
      const body = JSON.parse((await readRequestBody(req)) || "{}");
      if (!String(body.message || "").trim()) throw new Error("System log message is required.");
      const record = uiStateStore.recordSystemActivity({
        category: body.category || "browser",
        source: body.source || "UI",
        message: body.message,
        tone: body.tone,
        metadata: body.metadata,
      });
      json(res, 201, { ok: true, record });
    } catch (error) {
      json(res, 400, { ok: false, error: error.message });
    }
  }

  return { "/api/system-logs": handleSystemLogsApi };
}
