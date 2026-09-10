import path from "node:path";
import { fileURLToPath } from "node:url";

const applicationRoot = fileURLToPath(new URL("../", import.meta.url));

export function resolveOfficeWorkspaceRoot({
  cwd = applicationRoot,
  configuredWorkspace = process.env.AI_HARNESS_WORKSPACE,
} = {}) {
  const configured = String(configuredWorkspace || "").trim();
  return path.resolve(cwd, configured || ".workspace");
}

export function resolveSharedWorkspaceRoot({
  officeWorkspaceRoot,
  cwd = applicationRoot,
  configuredSharedWorkspace = process.env.AI_HARNESS_SHARED_WORKSPACE,
} = {}) {
  const configured = String(configuredSharedWorkspace || "").trim();
  return configured
    ? path.resolve(cwd, configured)
    : path.resolve(officeWorkspaceRoot, "deliverables");
}

export function isPathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
