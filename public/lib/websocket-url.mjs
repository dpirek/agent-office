export function normalizeOfficeWebSocketUrl(value) {
  const configured = String(value || "").trim();
  if (!configured) return "";
  let url;
  try { url = new URL(configured); } catch {
    throw new Error("AI_HARNESS_WEBSOCKET_URL must be an absolute HTTP(S) or WS(S) URL.");
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password || configured.includes("#")) {
    throw new Error("AI_HARNESS_WEBSOCKET_URL must use HTTP(S) or WS(S), without credentials or fragments.");
  }
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.pathname === "/") url.pathname = "/ws";
  return url.href;
}

export function createOfficeWebSocketUrl(location, { allowInsecure = false, configuredUrl = "" } = {}) {
  const endpoint = normalizeOfficeWebSocketUrl(configuredUrl);
  if (endpoint) return endpoint;
  const protocol = allowInsecure || location.protocol !== "https:" ? "ws:" : "wss:";
  return `${protocol}//${location.host}/ws`;
}
