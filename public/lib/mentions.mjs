function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function appendUniqueMention(value, username) {
  const current = String(value || "");
  const normalizedUsername = String(username || "").trim().replace(/^@+/, "");
  if (!normalizedUsername) return current;
  const mentionPattern = new RegExp(
    `(^|[^A-Za-z0-9_-])@${escapeRegExp(normalizedUsername)}(?![A-Za-z0-9_-])`,
    "i",
  );
  if (mentionPattern.test(current)) return current;
  const prefix = current.trimEnd();
  return `${prefix ? `${prefix} ` : ""}@${normalizedUsername} `;
}
