export function workspaceFileUrl(filePath) {
  return `/files/${String(filePath).replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/")}`;
}

export function normalizeFileUrl(value) {
  const source = String(value || "");
  if (!source.startsWith("/api/shared-workspace-file?")) return source;
  const url = new URL(source, "http://office.invalid");
  const filePath = url.searchParams.get("path");
  return filePath ? workspaceFileUrl(filePath) + url.hash : source;
}
