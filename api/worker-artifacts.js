import { json, methodNotAllowed, readRequestBuffer } from "./http.js";
import { MAX_WORKER_ARTIFACT_BYTES } from "../lib/worker-artifacts.js";

function bearerToken(value) {
  return /^Bearer\s+(.+)$/i.exec(String(value || ""))?.[1] || "";
}

export function createWorkerArtifactApiHandlers({ workerArtifactStore, uiStateStore }) {
  async function handleWorkerArtifactsApi(req, res, url) {
    if (req.method !== "POST") {
      methodNotAllowed(res, "POST");
      return;
    }
    const taskId = String(url.searchParams.get("taskId") || "");
    const name = String(url.searchParams.get("name") || "");
    try {
      const token = bearerToken(req.headers.authorization);
      workerArtifactStore.authorize(taskId, token);
      if (String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase() !== "application/octet-stream") {
        const error = new Error("Content-Type must be application/octet-stream.");
        error.statusCode = 415;
        throw error;
      }
      const declaredSize = Number(req.headers["content-length"]);
      if (Number.isFinite(declaredSize) && declaredSize > MAX_WORKER_ARTIFACT_BYTES) {
        const error = new Error("Artifact exceeds the 100 MB upload limit.");
        error.statusCode = 413;
        throw error;
      }
      const content = await readRequestBuffer(req, MAX_WORKER_ARTIFACT_BYTES);
      const artifact = await workerArtifactStore.upload({
        taskId,
        name,
        content,
        token,
      });
      uiStateStore.recordSystemActivity({
        category: "artifact",
        source: artifact.task.agent || "Worker",
        message: `Artifact uploaded · ${artifact.name} · ${artifact.size} bytes`,
        tone: "success",
        metadata: { taskId, artifactId: artifact.artifactId, name: artifact.name, size: artifact.size },
      });
      json(res, 200, {
        ok: true,
        artifactId: artifact.artifactId,
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: artifact.size,
      });
    } catch (error) {
      uiStateStore.recordSystemActivity({
        category: "artifact",
        source: "Worker Upload",
        message: `Artifact upload failed · ${name || "unnamed file"} · ${error.message}`,
        tone: "error",
        metadata: { taskId, name },
      });
      json(res, error.statusCode || (/too large|limit/i.test(error.message) ? 413 : 400), { ok: false, error: error.message });
    }
  }

  return { "/api/worker-artifacts": handleWorkerArtifactsApi };
}
