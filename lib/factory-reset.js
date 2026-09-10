import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function canonicalPath(value) {
  const resolved = path.resolve(value);
  try {
    return await fs.realpath(resolved);
  } catch (error) {
    if (error.code === "ENOENT") return resolved;
    throw error;
  }
}

async function clearManagedDirectory(directory, { protectedPaths = [] } = {}) {
  const requestedRoot = path.resolve(directory);
  await fs.mkdir(requestedRoot, { recursive: true });
  const root = await canonicalPath(requestedRoot);
  const protectedRoots = await Promise.all([os.homedir(), ...protectedPaths].map(canonicalPath));
  if (root === path.parse(root).root || protectedRoots.includes(root)) {
    throw new Error(`Refusing to clear unsafe shared workspace path: ${root}`);
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  await Promise.all(entries.map((entry) => (
    fs.rm(path.join(root, entry.name), { recursive: true, force: true })
  )));
  return entries.length;
}

export { clearManagedDirectory };
