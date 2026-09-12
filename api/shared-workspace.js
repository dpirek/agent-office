import { workspaceFileUrl } from "../public/lib/file-url.mjs";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { projectWorkspace } from "../lib/projects.js";
import fs from "node:fs/promises";
import path from "node:path";
import { json, methodNotAllowed } from "./http.js";

const CONTENT_TYPES = {
  ".htm": "text/html; charset=utf-8", ".ico": "image/x-icon", ".avif": "image/avif",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".wasm": "application/wasm", ".map": "application/json; charset=utf-8",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg",
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

export function createSharedWorkspaceApiHandlers({ sharedWorkspaceRoot, uiStateStore }) {
  async function handleSharedWorkspaceApi(req, res, url) {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    try {
      await fs.mkdir(sharedWorkspaceRoot, { recursive: true });
      const projectId = url?.searchParams.get("projectId");
      if (projectId) uiStateStore.requireProject(projectId);
      const root = projectId ? await projectWorkspace(sharedWorkspaceRoot, projectId) : sharedWorkspaceRoot;
      const tree = await listDirectory(sharedWorkspaceRoot, root);
      json(res, 200, { ok: true, root, tree });
    } catch (error) {
      json(res, 500, { ok: false, error: error.message });
    }
  }

  async function handleSharedWorkspaceFileApi(req, res, url) {
    if (!["GET", "HEAD"].includes(req.method)) return methodNotAllowed(res, "GET, HEAD");
    try {
      const { relative } = await resolveSharedFile(sharedWorkspaceRoot, url.searchParams.get("path"));
      res.writeHead(302, { location: workspaceFileUrl(relative), "cache-control": "no-store" });
      res.end();
    } catch (error) {
      json(res, 404, { ok: false, error: error.message });
    }
  }

  async function handleStaticWorkspaceFile(req, res, url) {
    if (!["GET", "HEAD"].includes(req.method)) return methodNotAllowed(res, "GET, HEAD");
    try {
      const requested = decodeURIComponent(url.pathname.slice("/files/".length));
      if (requested.includes("\\") || requested.includes("\0") || requested.split("/").some((part) => part.startsWith("."))) {
        throw new Error("Invalid workspace file path.");
      }
      const base = await fs.realpath(sharedWorkspaceRoot);
      let file = await fs.realpath(path.resolve(base, requested));
      const withinRoot = (candidate) => {
        const relative = path.relative(base, candidate);
        return !relative.startsWith("..") && !path.isAbsolute(relative);
      };
      if (!withinRoot(file)) throw new Error("File is outside the shared workspace.");
      let stat = await fs.stat(file);
      if (stat.isDirectory()) {
        if (!url.pathname.endsWith("/")) {
          res.writeHead(308, { location: url.pathname + "/" + url.search, "cache-control": "no-store" });
          res.end();
          return;
        }
        file = await fs.realpath(path.join(file, "index.html"));
        if (!withinRoot(file)) throw new Error("File is outside the shared workspace.");
        stat = await fs.stat(file);
      }
      if (!stat.isFile()) throw new Error("Selected path is not a file.");
      res.writeHead(200, {
        "content-type": CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
        "content-length": stat.size,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      if (req.method === "HEAD") res.end();
      else await pipeline(createReadStream(file), res);
    } catch (error) {
      if (res.headersSent) { res.destroy(error); return; }
      json(res, 404, { ok: false, error: "Workspace file not found." });
    }
  }

  return {
    "/api/shared-workspace": handleSharedWorkspaceApi,
    "/api/shared-workspace-file": handleSharedWorkspaceFileApi,
    "/files/": handleStaticWorkspaceFile,
  };
}
