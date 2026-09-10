export function createOfficeWebSocketUrl(location, { allowInsecure = false } = {}) {
  const protocol = allowInsecure || location.protocol !== "https:" ? "ws:" : "wss:";
  return `${protocol}//${location.host}/ws`;
}
