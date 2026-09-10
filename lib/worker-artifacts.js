import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_WORKER_ARTIFACT_BYTES = 100 * 1024 * 1024;
const MAX_ARTIFACTS_PER_TASK = 100;

const MIME_TYPES = new Map([
  [".zip", "application/zip"],
  [".json", "application/json"],
  [".pdf", "application/pdf"],
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".html", "text/html"],
  [".css", "text/css"],
  [".js", "text/javascript"],
  [".mjs", "text/javascript"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
]);

function safeTokenEqual(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function normalizeFilename(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 255 || /[\\/\0]/.test(name) || path.basename(name) !== name || name === "." || name === "..") {
    throw new Error("Artifact name must be a plain filename between 1 and 255 characters.");
  }
  return name;
}

function artifactMimeType(name) {
  return MIME_TYPES.get(path.extname(name).toLowerCase()) || "application/octet-stream";
}

function createWorkerArtifactStore({ root } = {}) {
  const stagingRoot = path.join(path.resolve(root), ".worker-uploads");
  const tasks = new Map();

  function authorize(taskId, token) {
    const entry = tasks.get(String(taskId || ""));
    if (!entry || !safeTokenEqual(token, entry.token)) {
      const error = new Error("Artifact upload credentials were rejected.");
      error.statusCode = 401;
      throw error;
    }
    return { ...entry.task };
  }

  async function clearStaleUploads() {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }

  function issueTaskUpload(task) {
    const taskId = String(task?.taskId || "");
    if (!taskId) throw new Error("Task ID is required for artifact uploads.");
    const token = crypto.randomBytes(32).toString("base64url");
    tasks.set(taskId, { task: { ...task }, token, artifacts: new Map() });
    return {
      url: `/api/worker-artifacts?taskId=${encodeURIComponent(taskId)}&name=<filename>`,
      token,
      method: "POST",
      contentType: "application/octet-stream",
    };
  }

  async function upload({ taskId, token, name, content }) {
    authorize(taskId, token);
    const entry = tasks.get(String(taskId));
    const filename = normalizeFilename(name);
    if (!Buffer.isBuffer(content)) throw new Error("Artifact content must be raw bytes.");
    if (!content.length) throw new Error("Artifact file is empty.");
    if (content.length > MAX_WORKER_ARTIFACT_BYTES) {
      const error = new Error("Artifact exceeds the 100 MB upload limit.");
      error.statusCode = 413;
      throw error;
    }
    if (entry.artifacts.size >= MAX_ARTIFACTS_PER_TASK) throw new Error("A task may upload at most 100 artifacts.");
    const artifactId = `artifact-${crypto.randomUUID()}`;
    const taskDirectory = path.join(stagingRoot, encodeURIComponent(String(taskId)));
    await fs.mkdir(taskDirectory, { recursive: true });
    const file = path.join(taskDirectory, artifactId);
    await fs.writeFile(file, content, { flag: "wx", mode: 0o600 });
    const artifact = {
      artifactId,
      artifactName: filename,
      name: filename,
      mimeType: artifactMimeType(filename),
      size: content.length,
      file,
      metadata: { size: content.length, uploaded: true },
    };
    entry.artifacts.set(artifactId, artifact);
    return { ...artifact, task: { ...entry.task } };
  }

  function resolve(taskId, artifactIds = []) {
    const entry = tasks.get(String(taskId || ""));
    if (!entry) throw new Error("Artifact uploads are no longer available for this task.");
    if (!Array.isArray(artifactIds)) throw new Error("uploadedArtifactIds must be an array.");
    if (artifactIds.length > MAX_ARTIFACTS_PER_TASK) throw new Error("A task may reference at most 100 uploaded artifacts.");
    const unique = new Set(artifactIds.map(String));
    if (unique.size !== artifactIds.length) throw new Error("uploadedArtifactIds cannot contain duplicates.");
    return artifactIds.map((artifactId) => {
      const artifact = entry.artifacts.get(String(artifactId));
      if (!artifact) throw new Error(`Unknown uploaded artifact: ${artifactId}`);
      return { ...artifact };
    });
  }

  async function discardTask(taskId) {
    const normalizedTaskId = String(taskId || "");
    if (!normalizedTaskId) return;
    tasks.delete(normalizedTaskId);
    await fs.rm(path.join(stagingRoot, encodeURIComponent(normalizedTaskId)), { recursive: true, force: true });
  }

  return { authorize, clearStaleUploads, discardTask, issueTaskUpload, resolve, upload };
}

export { createWorkerArtifactStore, MAX_WORKER_ARTIFACT_BYTES };
