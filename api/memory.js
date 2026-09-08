import { json, methodNotAllowed } from "./http.js";

export function createMemoryApiHandlers({ uiStateStore }) {
  async function handleMemoryApi(req, res, url) {
    if (req.method !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }
    try {
      const limit = Number(url.searchParams.get("limit") || 100);
      const kind = url.searchParams.get("kind") || undefined;
      const status = url.searchParams.get("status") || undefined;
      const query = url.searchParams.get("query") || undefined;
      json(res, 200, {
        ok: true,
        records: uiStateStore.getOfficeMemory({ limit, kind, status, query }),
      });
    } catch (error) {
      json(res, 400, { ok: false, error: error.message });
    }
  }

  return { "/api/memory": handleMemoryApi };
}
