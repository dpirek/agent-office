import { workspaceFileUrl } from "../public/lib/file-url.mjs";
import { DEFAULT_PROJECT_ID, projectWorkspace } from "./projects.js";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";

const inflateRaw = promisify(zlib.inflateRaw);
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 500 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5_000;

function safeSegment(value, fallback = "task") {
  const normalized = String(value || "").normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function safeArchivePath(name) {
  const normalized = path.posix.normalize(String(name || "").replaceAll("\\", "/"));
  if (!normalized || normalized === "." || normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || normalized.includes("\0")) {
    throw new Error(`Unsafe ZIP entry path: ${name || "(empty)"}`);
  }
  return normalized;
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Invalid ZIP file: central directory was not found.");
}

async function extractZip(buffer, destination) {
  const end = findEndOfCentralDirectory(buffer);
  if (buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0) throw new Error("Multi-disk ZIP files are not supported.");
  const entryCount = buffer.readUInt16LE(end + 10);
  if (buffer.readUInt16LE(end + 8) !== entryCount) throw new Error("Invalid ZIP entry count.");
  const centralSize = buffer.readUInt32LE(end + 12);
  const centralOffset = buffer.readUInt32LE(end + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error("ZIP64 files are not supported.");
  if (centralOffset + centralSize > end) throw new Error("Invalid ZIP central directory bounds.");
  if (entryCount > MAX_ZIP_ENTRIES) throw new Error(`ZIP contains more than ${MAX_ZIP_ENTRIES} entries.`);
  let offset = centralOffset;
  let extractedBytes = 0;
  const files = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid ZIP central directory.");
    const flags = buffer.readUInt16LE(offset + 8);
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    if (flags & 0x1) throw new Error("Encrypted ZIP files are not supported.");
    if (![0, 8].includes(compression)) throw new Error(`Unsupported ZIP compression method: ${compression}.`);
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000) throw new Error("ZIP symbolic links are not allowed.");
    const nameEnd = offset + 46 + nameLength;
    if (nameEnd > buffer.length) throw new Error("Invalid ZIP entry name.");
    const relativePath = safeArchivePath(buffer.subarray(offset + 46, nameEnd).toString("utf8"));
    offset = nameEnd + extraLength + commentLength;

    const target = path.join(destination, ...relativePath.split("/"));
    if (relativePath.endsWith("/")) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Invalid ZIP local header.");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error("ZIP entry extends beyond the archive.");
    const compressed = buffer.subarray(dataStart, dataEnd);
    if (extractedBytes + uncompressedSize > MAX_EXTRACTED_BYTES) throw new Error("ZIP expands beyond the 500 MB limit.");
    const content = compression === 0
      ? Buffer.from(compressed)
      : await inflateRaw(compressed, { maxOutputLength: MAX_EXTRACTED_BYTES - extractedBytes });
    if (content.length !== uncompressedSize) throw new Error(`ZIP entry size mismatch: ${relativePath}`);
    extractedBytes += content.length;
    if (extractedBytes > MAX_EXTRACTED_BYTES) throw new Error("ZIP expands beyond the 500 MB limit.");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, { flag: "wx" });
    files.push({ relativePath, size: content.length });
  }
  return files;
}

async function download(uri, fetchImpl) {
  const response = await fetchImpl(uri, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Artifact download failed (${response.status}).`);
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_DOWNLOAD_BYTES) throw new Error("Artifact exceeds the 100 MB download limit.");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new Error("Artifact exceeds the 100 MB download limit.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

function localArtifact(folder, relativePath, source) {
  const storedPath = path.posix.join(folder, relativePath.replaceAll(path.sep, "/"));
  const { file: _stagedFile, task: _task, ...publicSource } = source;
  return {
    ...publicSource,
    name: relativePath,
    mimeType: source.mimeType === "application/zip" ? "application/octet-stream" : source.mimeType,
    uri: workspaceFileUrl(storedPath),
    workspacePath: storedPath,
  };
}

async function mergeDelivery(staging, destination, backup) {
  const files = [];
  const directories = [];
  async function inspect(directory, relative = "") {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      const target = path.join(destination, name);
      const existing = await fs.lstat(target).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (existing?.isSymbolicLink()) throw new Error(`Delivery cannot replace or traverse a symbolic link: ${name}`);
      if (entry.isDirectory()) {
        if (existing && !existing.isDirectory()) throw new Error(`Delivery folder conflicts with a file: ${name}`);
        directories.push({ target, exists: Boolean(existing) });
        await inspect(path.join(directory, entry.name), name);
      } else {
        if (existing && !existing.isFile()) throw new Error(`Delivery file conflicts with a folder: ${name}`);
        files.push({ name, target, exists: Boolean(existing) });
      }
    }
  }
  await inspect(staging);
  const created = [];
  const changes = [];
  try {
    for (const directory of directories) {
      if (!directory.exists) { await fs.mkdir(directory.target); created.push(directory.target); }
    }
    for (const file of files) {
      const saved = path.join(backup, file.name);
      if (file.exists) {
        await fs.mkdir(path.dirname(saved), { recursive: true });
        await fs.rename(file.target, saved);
      }
      const change = { ...file, saved, installed: false };
      changes.push(change);
      await fs.rename(path.join(staging, file.name), file.target);
      change.installed = true;
    }
  } catch (error) {
    for (const change of changes.reverse()) {
      if (change.installed) await fs.unlink(change.target);
      if (change.exists) await fs.rename(change.saved, change.target);
    }
    for (const directory of created.reverse()) await fs.rmdir(directory);
    throw error;
  }
}

function createSharedWorkspace({ root, fetchImpl = fetch } = {}) {
  const workspaceRoot = path.resolve(root);
  let deliveryQueue = Promise.resolve();

  async function storeDelivery(task, deliveredWork = [], uploadedWork = []) {
    if (!deliveredWork.length && !uploadedWork.length) return [];
    await fs.mkdir(workspaceRoot, { recursive: true });
    const folder = task.projectId || DEFAULT_PROJECT_ID;
    const destination = await projectWorkspace(workspaceRoot, folder);
    const temporary = await fs.mkdtemp(path.join(workspaceRoot, ".delivery-"));
    const staging = path.join(temporary, "incoming");
    const backup = path.join(temporary, "backup");
    await fs.mkdir(staging);
    const stored = [];
    try {
      for (const artifact of deliveredWork) {
        const content = await download(artifact.uri, fetchImpl);
        await storeArtifact(artifact, content, staging, folder, stored);
      }
      for (const artifact of uploadedWork) {
        const content = await fs.readFile(artifact.file);
        await storeArtifact(artifact, content, staging, folder, stored);
      }
      await mergeDelivery(staging, destination, backup);
      return stored;
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }

  async function storeArtifact(artifact, content, staging, folder, stored) {
    const filename = safeSegment(artifact.name, "artifact");
    const isZip = artifact.mimeType === "application/zip" || filename.toLowerCase().endsWith(".zip");
    if (isZip) {
      const archive = path.join(staging, `.${filename}.download`);
      await fs.writeFile(archive, content, { flag: "wx" });
      try {
        const files = await extractZip(content, staging);
        stored.push(...files.map((file) => localArtifact(folder, file.relativePath, artifact)));
      } finally {
        await fs.rm(archive, { force: true });
      }
    } else {
      const target = path.join(staging, filename);
      await fs.writeFile(target, content, { flag: "wx" });
      stored.push(localArtifact(folder, filename, artifact));
    }
  }

  function storeTaskArtifacts(task, deliveredWork = [], uploadedWork = []) {
    const delivery = deliveryQueue.then(() => storeDelivery(task, deliveredWork, uploadedWork));
    deliveryQueue = delivery.catch(() => {});
    return delivery;
  }

  return { root: workspaceRoot, storeTaskArtifacts };
}

export { createSharedWorkspace, extractZip, MAX_DOWNLOAD_BYTES, MAX_EXTRACTED_BYTES };
