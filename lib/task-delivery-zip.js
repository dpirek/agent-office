import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { crc32 } from "node:zlib";

const MAX_BUNDLE_BYTES = 500 * 1024 * 1024;

export async function taskDeliveryFiles(root, task) {
  const base = await fs.realpath(root);
  const files = [];
  const seen = new Set();
  const names = new Set();
  let total = 0;
  if (!task.deliveredWork?.length) throw new Error("This task has no delivered files.");
  if (task.deliveredWork.length > 5000) throw new Error("A download may contain at most 5000 files.");
  for (const artifact of task.deliveredWork) {
    if (!artifact.workspacePath) throw new Error("A delivered file is not stored in the workspace.");
    const file = await fs.realpath(path.resolve(base, artifact.workspacePath));
    const relative = path.relative(base, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Delivered file is outside the workspace.");
    if (seen.has(file)) continue;
    seen.add(file);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("A delivered file is unavailable.");
    total += stat.size;
    if (total > MAX_BUNDLE_BYTES) throw new Error("Task download exceeds the 500 MB limit.");
    const name = String(artifact.name || path.basename(file)).replaceAll("\\", "/");
    if (!name || name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.includes("\0") || name.split("/").some((part) => !part || part === "." || part === "..") || Buffer.byteLength(name) > 65535) throw new Error("Invalid delivered filename.");
    if (names.has(name)) throw new Error("Delivered filenames conflict in the ZIP archive.");
    names.add(name);
    files.push({ file, name, size: stat.size });
  }
  return files;
}

// ZIP store entries are streamed with data descriptors, so downloads never
// buffer entire deliveries in memory. UTF-8 paths preserve website structure.
export async function* streamTaskZip(files) {
  const central = [];
  let offset = 0;
  let total = 0;
  for (const entry of files) {
    const name = Buffer.from(entry.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0808, 6);
    local.writeUInt16LE(33, 12); // 1980-01-01
    local.writeUInt16LE(name.length, 26);
    const start = offset;
    yield local; yield name;
    offset += local.length + name.length;
    let checksum = 0;
    let size = 0;
    for await (const chunk of createReadStream(entry.file)) {
      size += chunk.length;
      total += chunk.length;
      if (total > MAX_BUNDLE_BYTES) throw new Error("Task download exceeds the 500 MB limit.");
      checksum = crc32(chunk, checksum);
      yield chunk;
      offset += chunk.length;
    }
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50);
    descriptor.writeUInt32LE(checksum, 4);
    descriptor.writeUInt32LE(size, 8);
    descriptor.writeUInt32LE(size, 12);
    yield descriptor;
    offset += descriptor.length;
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0808, 8);
    header.writeUInt16LE(33, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(size, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(start, 42);
    central.push(header, name);
  }
  const directory = Buffer.concat(central);
  yield directory;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  yield end;
}
