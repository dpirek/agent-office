import { saveChatImages } from '../lib/chat-images.js';
import { MAX_CHAT_BODY_BYTES } from '../public/lib/chat-image-limits.mjs';
import { requireProjectAccess } from '../lib/project-access.js';
import { json, methodNotAllowed, readRequestBody } from "./http.js";

export function createChatApiHandlers({ officeChatService, uiStateStore, sharedWorkspaceRoot }) {
  async function handleChatApi(req, res, url) {
    if (!officeChatService) {
      json(res, 503, { ok: false, error: "Office chat is not configured." });
      return;
    }
    if (req.method === "GET") {
      try {
        json(res, 200, { ok: true, ...officeChatService.list({
          user: req.user,
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
    let upload;
    try {
      const body = JSON.parse(await readRequestBody(req, MAX_CHAT_BODY_BYTES) || "{}");
      const projectId = body.projectId || 'central-office';
      const project = uiStateStore.requireProject(projectId);
      requireProjectAccess(req.user, projectId, project);
      if (typeof body.text !== 'string' || body.text.length > 100_000) throw new Error('Message must be text of at most 100000 characters.');
      if (body.replyToId && !uiStateStore.getOfficeChatMessage(body.replyToId, projectId)) throw new Error('Reply target not found in this project.');
      upload = await saveChatImages(sharedWorkspaceRoot, projectId, body.images);
      const result = officeChatService.postUserMessage({ text: body.text, priority: body.priority, replyToId: body.replyToId, projectId, artifacts: upload.artifacts, images: body.images || [], user: req.user });
      json(res, 201, { ok: true, ...result });
    } catch (error) {
      await upload?.rollback();
      json(res, error.statusCode || 400, { ok: false, error: error.message });
    }
  }

  return { "/api/chat": handleChatApi };
}
