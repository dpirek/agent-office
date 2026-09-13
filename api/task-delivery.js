import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { json, methodNotAllowed } from "./http.js";
import { taskDeliveryFiles, streamTaskZip } from "../lib/task-delivery-zip.js";

export function createTaskDeliveryHandlers({ uiStateStore, sharedWorkspaceRoot }) {
  return { "/downloads/tasks/": async (req, res, url) => {
    if (!["GET", "HEAD"].includes(req.method)) return methodNotAllowed(res, "GET, HEAD");
    try {
      const match = /^\/downloads\/tasks\/([A-Za-z0-9-]+)\/([A-Za-z0-9-]+)\.zip$/.exec(url.pathname);
      if (!match) throw new Error("Task download not found.");
      const [, projectId, taskId] = match;
      uiStateStore.requireProject(projectId);
      const task = uiStateStore.getOfficeTasks({ id: taskId, projectId, limit: 1 })[0];
      if (!task) throw new Error("Task download not found.");
      const files = await taskDeliveryFiles(sharedWorkspaceRoot, task);
      const filename = (task.title || "delivered-work").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80) + ".zip";
      res.writeHead(200, {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      if (req.method === "HEAD") res.end();
      else await pipeline(Readable.from(streamTaskZip(files)), res);
    } catch (error) {
      if (res.headersSent) { res.destroy(error); return; }
      json(res, 404, { ok: false, error: ["ENOENT", "ENOTDIR"].includes(error.code) ? "A delivered file is no longer available." : error.message });
    }
  } };
}
