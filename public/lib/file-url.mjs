export function workspaceFileUrl(filePath) {
  return `/files/${String(filePath).replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/")}`;
}

export function normalizeFileUrl(value) {
  const source = String(value || "");
  let url;
  try { url = new URL(source, "http://office.invalid"); } catch { return source; }
  const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
  if (url.origin !== "http://office.invalid" && !localHost) return source;
  if (url.pathname.startsWith("/files/")) return url.pathname + url.search + url.hash;
  if (url.pathname !== "/api/shared-workspace-file") return source;
  const filePath = url.searchParams.get("path");
  return filePath ? workspaceFileUrl(filePath) + url.hash : source;
}
