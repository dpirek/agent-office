const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeSkillName(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function skillDraft(name) {
  const normalized = normalizeSkillName(name) || "new-skill";
  return `---\nname: ${normalized}\ndescription: Instructions for ${normalized}.\n---\n\n# ${normalized}\n\nDescribe when and how the agent should use this skill.\n`;
}

function syncSkillContentName(content, name) {
  const normalized = normalizeSkillName(name);
  const source = String(content || "");
  if (!source.startsWith("---\n")) return skillDraft(normalized);
  const boundary = source.indexOf("\n---", 4);
  if (boundary < 0) return source;
  const header = source.slice(4, boundary);
  const nextHeader = /^name\s*:/m.test(header)
    ? header.replace(/^name\s*:.*$/m, `name: ${normalized}`)
    : `name: ${normalized}\n${header}`;
  return `---\n${nextHeader}${source.slice(boundary)}`;
}

function validateSkillContent(content) {
  const source = String(content || "").trim();
  if (!source) throw new Error("Skill content is required.");
  if (Buffer.byteLength(source) > 2_000_000) throw new Error("Skill content is too large.");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
  if (!match) throw new Error("Skill content must start with YAML front matter.");
  const name = /^name\s*:\s*([^\n]+)$/m.exec(match[1])?.[1]?.trim();
  if (!name || !SKILL_NAME_PATTERN.test(name)) {
    throw new Error("Skill front matter must contain a lowercase kebab-case name.");
  }
  return `${source}\n`;
}

export { normalizeSkillName, skillDraft, syncSkillContentName, validateSkillContent };
