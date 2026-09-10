import path from "node:path";

export function resolveOfficeWorkspaceRoot({
  cwd = process.cwd(),
  configuredWorkspace = process.env.AI_HARNESS_WORKSPACE,
} = {}) {
  const configured = String(configuredWorkspace || "").trim();
  return path.resolve(configured || path.join(cwd, ".workspace"));
}

export function resolveSharedWorkspaceRoot({
  officeWorkspaceRoot,
  configuredSharedWorkspace = process.env.AI_HARNESS_SHARED_WORKSPACE,
} = {}) {
  const configured = String(configuredSharedWorkspace || "").trim();
  return path.resolve(configured || path.join(officeWorkspaceRoot, "deliverables"));
}

export function isPathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
