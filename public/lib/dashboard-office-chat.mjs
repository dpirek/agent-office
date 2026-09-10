import { renderChatArtifacts, renderMarkdown } from "./markdown.mjs";

const AGENT_SPRITES = ["researcher", "developer", "designer", "qa-tester", "deployment-engineer", "analyst", "support-agent"];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function shortTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function spriteFor(message) {
  if (message.username === "office-manager") return "manager";
  const identity = `${message.author || ""} ${message.username || ""}`.toLowerCase();
  const matched = [
    ["research", "researcher"], ["develop", "developer"], ["cod", "developer"],
    ["design", "designer"], ["qa", "qa-tester"], ["test", "qa-tester"],
    ["deploy", "deployment-engineer"], ["devops", "deployment-engineer"],
    ["analy", "analyst"], ["support", "support-agent"],
  ].find(([keyword]) => identity.includes(keyword))?.[1];
  if (matched) return matched;
  const hash = [...identity].reduce((total, character) => total + character.charCodeAt(0), 0);
  return AGENT_SPRITES[hash % AGENT_SPRITES.length];
}

function avatarMarkup(message) {
  if (message.kind === "user") {
    return `<svg class="human-avatar-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="3.25"></circle><path d="M5.5 20v-2.2c0-3.7 2.9-6.3 6.5-6.3s6.5 2.6 6.5 6.3V20z"></path></svg>`;
  }
  return `<img class="agent-avatar-sprite" src="/assets/avatars/${spriteFor(message)}.png" alt="" draggable="false">`;
}

export function renderDashboardOfficeChatMessages(messages = []) {
  if (!messages.length) {
    return `<div class="office-board-empty"><strong># CENTRAL-OFFICE IS READY</strong><span>Messages from the office will appear here.</span></div>`;
  }
  return messages.map((message) => `
    <article class="office-board-message ${escapeHtml(message.kind)}${message.streaming ? " streaming" : ""}">
      <div class="office-board-avatar"${message.kind === "user" ? ` title="You · Human"` : ""}>${avatarMarkup(message)}</div>
      <div class="office-board-message-body">
        <div class="office-board-message-meta"><strong>${escapeHtml(message.author)}</strong><span>@${escapeHtml(message.username)} · ${shortTime(message.createdAt)}</span></div>
        <div class="office-board-message-text markdown-body">${renderMarkdown(message.text || "")}</div>
        ${message.artifacts?.length ? `<div class="office-board-artifacts">${renderChatArtifacts(message.artifacts)}</div>` : ""}
      </div>
    </article>`).join("");
}

export function initializeDashboardOfficeChat({ documentRef = document, fetchImpl = fetch, intervalMs = 2_000 } = {}) {
  const board = documentRef.querySelector("#dashboard-office-board-messages");
  const status = documentRef.querySelector("#dashboard-office-chat-status");
  if (!board) return () => {};
  let markup = null;
  let loading = false;

  const scrollToLatest = () => {
    board.scrollTop = board.scrollHeight;
    board.querySelectorAll("img").forEach((image) => {
      if (!image.complete) image.addEventListener("load", () => { board.scrollTop = board.scrollHeight; }, { once: true });
    });
  };
  const refresh = async () => {
    if (documentRef.body.dataset.page !== "dashboard" || loading) return;
    loading = true;
    try {
      const response = await fetchImpl("/api/chat?limit=300", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const nextMarkup = renderDashboardOfficeChatMessages(data.messages || []);
      if (nextMarkup !== markup) {
        board.innerHTML = nextMarkup;
        markup = nextMarkup;
        requestAnimationFrame(scrollToLatest);
      }
      if (status) status.textContent = "LIVE FEED";
    } catch {
      if (status) status.textContent = "OFFLINE";
    } finally {
      loading = false;
    }
  };

  const timer = setInterval(refresh, intervalMs);
  window.addEventListener("routechange", refresh);
  void refresh();
  return () => {
    clearInterval(timer);
    window.removeEventListener("routechange", refresh);
  };
}

if (typeof document !== "undefined") initializeDashboardOfficeChat();
