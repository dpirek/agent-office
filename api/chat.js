import { json, methodNotAllowed, readRequestBody } from "./http.js";

export function createChatApiHandlers({ officeChatService }) {
  async function handleChatApi(req, res, url) {
    if (!officeChatService) {
      json(res, 503, { ok: false, error: "Office chat is not configured." });
      return;
    }
    if (req.method === "GET") {
      try {
        json(res, 200, { ok: true, ...officeChatService.list({
          projectId: url.searchParams.get("projectId") || "central-office",
          after: Number(url.searchParams.get("after")) || 0,
          limit: Number(url.searchParams.get("limit")) || 200,
        }) });
      } catch (error) {
        json(res, 400, { ok: false, error: error.message });
      }
      return;
    }
    if (req.method !== "POST") {
      methodNotAllowed(res, "GET, POST");
      return;
    }
    try {
      const body = JSON.parse(await readRequestBody(req, 120_000) || "{}");
      const result = officeChatService.postUserMessage(body);
      json(res, 201, { ok: true, ...result });
    } catch (error) {
      json(res, 400, { ok: false, error: error.message });
    }
  }

  return { "/api/chat": handleChatApi };
}
