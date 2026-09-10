import { json, methodNotAllowed, readRequestBody } from "./http.js";

export function createSystemLogApiHandlers({ uiStateStore }) {
  async function handleSystemLogsApi(req, res, url) {
    if (req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || 200);
      json(res, 200, { ok: true, logs: uiStateStore.getSystemActivity({ limit }) });
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
