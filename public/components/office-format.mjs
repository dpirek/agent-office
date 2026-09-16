const OFFICE_SPRITES = ["researcher", "developer", "designer", "qa-tester", "deployment-engineer", "analyst", "support-agent"];

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function clock(value = Date.now()) {
  return new Date(value).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function shortTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function scheduleTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function officeSprite(agent, index = 0) {
  if (agent.internal) return "manager";
  const identity = `${agent.name} ${agent.role}`.toLowerCase();
  const roleSprite = [
    ["research", "researcher"], ["develop", "developer"], ["cod", "developer"],
    ["design", "designer"], ["qa", "qa-tester"], ["test", "qa-tester"],
    ["deploy", "deployment-engineer"], ["devops", "deployment-engineer"],
    ["analy", "analyst"], ["support", "support-agent"],
  ].find(([keyword]) => identity.includes(keyword))?.[1];
  return roleSprite || OFFICE_SPRITES[Math.max(0, index - 1) % OFFICE_SPRITES.length];
}

export async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
