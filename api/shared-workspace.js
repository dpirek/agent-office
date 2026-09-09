import fs from "node:fs/promises";
import path from "node:path";
import { json, methodNotAllowed } from "./http.js";

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8", ".gif": "image/gif", ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".pdf": "application/pdf", ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".webp": "image/webp",
};

async function resolveSharedFile(root, requestedPath) {
  const base = await fs.realpath(root);
  const requested = String(requestedPath || "");
  if (!requested) throw new Error("Select a shared workspace file.");
  const file = await fs.realpath(path.resolve(base, requested));
  const relative = path.relative(base, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("File is outside the shared workspace.");
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error("Selected path is not a file.");
  return { file, relative, stat };
}

async function listDirectory(root, directory = root, state = { count: 0 }) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    if (state.count >= 5_000) break;
    state.count += 1;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push({ name: entry.name, type: "directory", path: path.relative(root, absolute), children: await listDirectory(root, absolute, state) });
    } else if (entry.isFile()) {
      const stat = await fs.stat(absolute);
      output.push({ name: entry.name, type: "file", path: path.relative(root, absolute), size: stat.size, modifiedAt: stat.mtimeMs });
    }
  }
  return output;
}

export function createSharedWorkspaceApiHandlers({ sharedWorkspaceRoot }) {
  async function handleSharedWorkspaceApi(req, res) {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    try {
      await fs.mkdir(sharedWorkspaceRoot, { recursive: true });
      const tree = await listDirectory(sharedWorkspaceRoot);
      json(res, 200, { ok: true, root: sharedWorkspaceRoot, tree });
    } catch (error) {
      json(res, 500, { ok: false, error: error.message });
    }
  }

  async function handleSharedWorkspaceFileApi(req, res, url) {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    try {
      const { file, stat } = await resolveSharedFile(sharedWorkspaceRoot, url.searchParams.get("path"));
      const contentType = CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, {
        "content-type": contentType,
        "content-length": stat.size,
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(await fs.readFile(file));
    } catch (error) {
      json(res, 404, { ok: false, error: error.message });
    }
  }

  return { "/api/shared-workspace": handleSharedWorkspaceApi, "/api/shared-workspace-file": handleSharedWorkspaceFileApi };
}
