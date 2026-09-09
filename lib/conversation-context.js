const DEFAULT_MAX_MESSAGES = 24;
const DEFAULT_ACTIVE_MESSAGES = 8;
const MAX_MESSAGE_LENGTH = 6_000;

const RECENCY_CONTEXT_POLICY = `Conversation context rules:
- The current request has highest priority.
- The active recent topic has higher priority than older background topics.
- Resolve ambiguous references such as "it", "that project", "the site", or "continue" from the active recent topic by default.
- Do not mix names, requirements, files, or decisions from older topics into the active project unless the current request explicitly refers to them.
- Use older background only when the active context requires it. Ask a concise clarification only when the active recent topic does not identify the intended project.`;

function normalizeConversationEntries(entries) {
  return (Array.isArray(entries) ? entries : []).flatMap((entry) => {
    const text = typeof entry?.text === "string" ? entry.text.trim() : "";
    if (!text) return [];
    const label = String(entry.label || entry.author || (entry.role === "agent" ? "Assistant" : "User"))
      .trim().slice(0, 100) || "Participant";
    const isUser = entry.isUser === true || entry.role === "user" || entry.kind === "user" || /^(?:user|you)$/i.test(label);
    return [{ label, text: text.slice(0, MAX_MESSAGE_LENGTH), isUser }];
  });
}

function renderEntries(entries) {
  return entries.map(({ label, text }) => `${label}: ${text}`).join("\n\n");
}

function formatConversationContext(entries, currentRequest, {
  maxMessages = DEFAULT_MAX_MESSAGES,
  activeMessages = DEFAULT_ACTIVE_MESSAGES,
} = {}) {
  const normalized = normalizeConversationEntries(entries).slice(-Math.max(1, maxMessages));
  const recentStart = Math.max(0, normalized.length - Math.max(1, activeMessages));
  const lastUserIndex = normalized.findLastIndex((entry) => entry.isUser);
  const activeStart = Math.max(recentStart, lastUserIndex);
  const background = normalized.slice(0, activeStart);
  const active = normalized.slice(activeStart);
  const sections = [RECENCY_CONTEXT_POLICY];
  if (background.length) {
    sections.push(`Older background — lowest priority:\n${renderEntries(background)}`);
  }
  if (active.length) {
    sections.push(`Active recent topic — use this as the default project context:\n${renderEntries(active)}`);
  }
  sections.push(`Current request — highest priority:\n${String(currentRequest || "").trim()}`);
  return sections.join("\n\n");
}

export {
  DEFAULT_ACTIVE_MESSAGES,
  DEFAULT_MAX_MESSAGES,
  RECENCY_CONTEXT_POLICY,
  formatConversationContext,
  normalizeConversationEntries,
};
