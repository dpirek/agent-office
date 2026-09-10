import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SYSTEM_PROMPTS, SYSTEM_PROMPT_TITLES } from "./system-prompts.js";
import { defaultModelForProvider, normalizeProvider } from "./provider-config.js";
import { normalizeSubAgentWorkers } from "./sub-agents.js";

const ALLOWED_KEYS = new Set([
  "sessions",
  "providerSettings",
  "providers",
  "toolPermissions",
]);

const DEFAULT_TOOL_PERMISSIONS = {
  manage_office_tasks: true,
  read_office_memory: true,
  list_files: true,
  read_file: true,
  write_file: true,
  search_files: true,
  curl: true,
  run_command: true,
  chrome_devtools: true,
  delegate_to_sub_agent: true,
};

const RIG_EFFECT_KEYS = ["composer", "tools", "mcp", "validation"];
const DEFAULT_PROVIDER_SETTINGS = {
  provider: "openai",
  model: "gpt-5.1-codex",
  baseUrl: "",
  apiKey: "",
};

function normalizeRigModelDisplay(value) {
  return value === "synth" ? "synth" : "engine";
}

function normalizeStoredToolPermissions(value = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_TOOL_PERMISSIONS).map(([name, defaultValue]) => [
      name,
      typeof value[name] === "boolean" ? value[name] : defaultValue,
    ]),
  );
}

export { normalizeStoredToolPermissions };

function normalizeRigComponentState(value = {}) {
  const effects = Object.fromEntries(RIG_EFFECT_KEYS.map((key) => [
    key,
    value?.effects?.[key] !== false,
  ]));
  return {
    inputSource: value?.inputSource === "keyboard" ? "keyboard" : "microphone",
    modelDisplay: normalizeRigModelDisplay(value?.modelDisplay),
    effects,
  };
}

function normalizeRigSystemPrompts(value = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_SYSTEM_PROMPTS).map(([key, defaultValue]) => [
    key,
    typeof value?.[key] === "string" ? value[key] : defaultValue,
  ]));
}

function normalizeRigProviderSettings(value = {}, fallback = DEFAULT_PROVIDER_SETTINGS) {
  const provider = normalizeProvider(value?.provider || value?.type || fallback?.provider || fallback?.type);
  const fallbackProvider = normalizeProvider(fallback?.provider || fallback?.type || provider);
  const fallbackModel = typeof fallback?.model === "string" ? fallback.model.trim() : "";
  const model = typeof value?.model === "string" && value.model.trim()
    ? value.model.trim()
    : fallbackModel && fallbackProvider === provider
      ? fallbackModel
      : defaultModelForProvider(provider);
  return {
    provider,
    model,
    baseUrl: typeof value?.baseUrl === "string" ? value.baseUrl : String(fallback?.baseUrl || ""),
    apiKey: typeof value?.apiKey === "string" ? value.apiKey : String(fallback?.apiKey || ""),
  };
}

function normalizeRigConfiguration(config = {}, index = 0) {
  return {
    id: String(config.id || crypto.randomUUID()),
    name: String(config.name || `Preset ${index + 1}`),
    componentState: normalizeRigComponentState(config.componentState),
    systemPrompts: normalizeRigSystemPrompts(config.systemPrompts),
    providerSettings: normalizeRigProviderSettings(config.providerSettings),
    toolPermissions: normalizeStoredToolPermissions(config.toolPermissions),
    skillIds: [...new Set((Array.isArray(config.skillIds) ? config.skillIds : []).map((id) => String(id)))],
    mcpConfig: String(config.mcpConfig || ""),
    subAgents: normalizeSubAgentWorkers(config.subAgents),
    updatedAt: Number(config.updatedAt) || Date.now(),
    selected: config.selected === true,
  };
}

export function createUiStateStore(databasePath) {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);

  const sessionColumns = database.prepare(
    "SELECT name FROM pragma_table_info('sessions')",
  ).all().map(({ name }) => name);
  if (sessionColumns.includes("messages") || sessionColumns.includes("events")) {
    database.exec("ALTER TABLE sessions RENAME TO sessions_legacy_json");
  }
  const providerColumns = database.prepare(
    "SELECT name FROM pragma_table_info('providers')",
  ).all().map(({ name }) => name);
  if (providerColumns.includes("provider") && !providerColumns.includes("id")) {
    database.exec(`
      ALTER TABLE providers RENAME TO providers_legacy_single;
      ALTER TABLE provider_settings RENAME TO provider_settings_legacy_single;
    `);
  }
  const hasLegacyPresetTable = database.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'rig_configurations'",
  ).get()?.present === 1;
  const hasPresetTable = database.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'presets'",
  ).get()?.present === 1;
  if (hasLegacyPresetTable && !hasPresetTable) {
    database.exec("ALTER TABLE rig_configurations RENAME TO presets");
  }
  database.exec("DROP TABLE IF EXISTS layout; DROP TABLE IF EXISTS tool_permissions");

  database.exec(`

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      sort_order INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS messages (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      message_order INTEGER NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      images TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (session_id, message_order)
    ) STRICT, WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS events (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      event_order INTEGER NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      input_prompt TEXT,
      server_response TEXT,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (session_id, event_order)
    ) STRICT, WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS token_usage (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      prompt_order INTEGER NOT NULL,
      prompt_id TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (session_id, prompt_order)
    ) STRICT, WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('openai', 'ollama', 'custom')),
      base_url TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS provider_settings (
      provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
      model TEXT NOT NULL DEFAULT '',
      selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS one_selected_provider
      ON provider_settings(selected) WHERE selected = 1;

    CREATE TABLE IF NOT EXISTS mcp_configuration (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      content TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS system_prompts (
      key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      component_state TEXT NOT NULL,
      system_prompts TEXT NOT NULL,
      provider_settings TEXT NOT NULL DEFAULT '{}',
      tool_permissions TEXT NOT NULL,
      skill_ids TEXT NOT NULL DEFAULT '[]',
      mcp_config TEXT NOT NULL DEFAULT '',
      sub_agents TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1))
    ) STRICT;

    DROP INDEX IF EXISTS one_selected_rig_configuration;
    CREATE UNIQUE INDEX IF NOT EXISTS one_selected_preset
      ON presets(selected) WHERE selected = 1;

    CREATE TABLE IF NOT EXISTS periodic_operations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      task TEXT NOT NULL,
      agent TEXT NOT NULL,
      interval_value INTEGER NOT NULL CHECK (interval_value > 0),
      interval_unit TEXT NOT NULL CHECK (interval_unit IN ('minutes', 'hours', 'days')),
      priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_run_at INTEGER,
      next_run_at INTEGER,
      last_status TEXT,
      last_error TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS office_memory (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('task', 'operation', 'system')),
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      agent TEXT,
      source_id TEXT,
      details TEXT NOT NULL DEFAULT '{}',
      artifacts TEXT NOT NULL DEFAULT '[]',
      occurred_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS office_memory_occurred_at
      ON office_memory(occurred_at DESC);

    CREATE TABLE IF NOT EXISTS office_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'timed_out', 'cancelled')),
      agent TEXT,
      message_id TEXT,
      worker_task_id TEXT,
      result TEXT,
      error TEXT,
      depends_on TEXT NOT NULL DEFAULT '[]',
      artifacts TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    ) STRICT;

    CREATE INDEX IF NOT EXISTS office_tasks_created_at ON office_tasks(created_at DESC);

    CREATE TABLE IF NOT EXISTS office_chat_messages (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      username TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('user', 'manager', 'agent', 'system')),
      text TEXT NOT NULL,
      artifacts TEXT NOT NULL DEFAULT '[]',
      task_id TEXT,
      created_at INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS office_chat_messages_created_at
      ON office_chat_messages(created_at, id);

    CREATE TABLE IF NOT EXISTS system_activity_logs (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      tone TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS system_activity_logs_created_at
      ON system_activity_logs(created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS worker_credentials (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      token TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Default worker token',
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS worker_registry (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '{}',
      model TEXT,
      token_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('connected', 'offline')),
      registered_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    ) STRICT;

  `);
  const seedPrompt = database.prepare(
    "INSERT OR IGNORE INTO system_prompts (key, title, content, updated_at) VALUES (?, ?, ?, ?)",
  );
  const seedSystemPromptDefaults = () => {
    const now = Date.now();
    for (const [key, content] of Object.entries(DEFAULT_SYSTEM_PROMPTS)) {
      seedPrompt.run(key, SYSTEM_PROMPT_TITLES[key], content, now);
    }
  };
  seedSystemPromptDefaults();

  const eventColumns = database.prepare(
    "SELECT name FROM pragma_table_info('events')",
  ).all().map(({ name }) => name);
  if (!eventColumns.includes("input_prompt")) database.exec("ALTER TABLE events ADD COLUMN input_prompt TEXT");
  if (!eventColumns.includes("server_response")) database.exec("ALTER TABLE events ADD COLUMN server_response TEXT");
  const workerCredentialColumns = database.prepare(
    "SELECT name FROM pragma_table_info('worker_credentials')",
  ).all().map(({ name }) => name);
  if (!workerCredentialColumns.includes("name")) {
    database.exec("ALTER TABLE worker_credentials ADD COLUMN name TEXT NOT NULL DEFAULT 'Default worker token'");
  }
  // A new server process has no live sockets yet, so records left connected by
  // an unclean shutdown must begin offline until their workers register again.
  database.exec("UPDATE worker_registry SET status = 'offline' WHERE status = 'connected'");
  const presetColumns = database.prepare(
    "SELECT name FROM pragma_table_info('presets')",
  ).all().map(({ name }) => name);
  if (!presetColumns.includes("provider_settings")) {
    database.exec("ALTER TABLE presets ADD COLUMN provider_settings TEXT NOT NULL DEFAULT '{}'");
  }
  const addedPresetSkillIds = !presetColumns.includes("skill_ids");
  if (addedPresetSkillIds) {
    database.exec("ALTER TABLE presets ADD COLUMN skill_ids TEXT NOT NULL DEFAULT '[]'");
  }
  const officeTaskColumns = database.prepare(
    "SELECT name FROM pragma_table_info('office_tasks')",
  ).all().map(({ name }) => name);
  if (!officeTaskColumns.includes("depends_on")) {
    database.exec("ALTER TABLE office_tasks ADD COLUMN depends_on TEXT NOT NULL DEFAULT '[]'");
  }
  const officeTaskSchema = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'office_tasks'",
  ).get()?.sql || "";
  if (!officeTaskSchema.includes("'cancelled'")) {
    database.exec(`
      BEGIN IMMEDIATE;
      DROP INDEX IF EXISTS office_tasks_created_at;
      ALTER TABLE office_tasks RENAME TO office_tasks_before_cancelled;
      CREATE TABLE office_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'timed_out', 'cancelled')),
        agent TEXT,
        message_id TEXT,
        worker_task_id TEXT,
        result TEXT,
        error TEXT,
        depends_on TEXT NOT NULL DEFAULT '[]',
        artifacts TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER
      ) STRICT;
      INSERT INTO office_tasks
        (id, title, priority, status, agent, message_id, worker_task_id, result, error,
         depends_on, artifacts, created_at, updated_at, started_at, finished_at)
      SELECT id, title, priority, status, agent, message_id, worker_task_id, result, error,
        depends_on, artifacts, created_at, updated_at, started_at, finished_at
      FROM office_tasks_before_cancelled;
      DROP TABLE office_tasks_before_cancelled;
      CREATE INDEX office_tasks_created_at ON office_tasks(created_at DESC);
      COMMIT;
    `);
  }
  if (!presetColumns.includes("sub_agents")) {
    database.exec("ALTER TABLE presets ADD COLUMN sub_agents TEXT NOT NULL DEFAULT '[]'");
  }
  const skillColumns = database.prepare(
    "SELECT name FROM pragma_table_info('skills')",
  ).all().map(({ name }) => name);
  if (skillColumns.includes("source_path")) {
    database.exec(`
      BEGIN IMMEDIATE;
      DROP TABLE IF EXISTS skills_without_source;
      CREATE TABLE skills_without_source (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
        updated_at INTEGER NOT NULL
      ) STRICT;
      INSERT INTO skills_without_source (id, name, content, selected, updated_at)
        SELECT id, name, content, selected, updated_at FROM skills;
      DROP TABLE skills;
      ALTER TABLE skills_without_source RENAME TO skills;
      COMMIT;
    `);
  }
  if (addedPresetSkillIds) {
    const selectedSkillIds = database.prepare("SELECT id FROM skills WHERE selected = 1 ORDER BY id")
      .all().map(({ id }) => id);
    database.prepare("UPDATE presets SET skill_ids = ?").run(JSON.stringify(selectedSkillIds));
  }

  const replaceSession = database.prepare(`
    INSERT INTO sessions (id, title, workspace, updated_at, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertMessage = database.prepare(`
    INSERT INTO messages (session_id, message_order, role, text, images) VALUES (?, ?, ?, ?, ?)
  `);
  const insertEvent = database.prepare(`
    INSERT INTO events
      (session_id, event_order, title, detail, input_prompt, server_response, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTokenUsage = database.prepare(`
    INSERT INTO token_usage
      (session_id, prompt_order, prompt_id, prompt_text, input_tokens, output_tokens, total_tokens, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertProvider = database.prepare(`
    INSERT INTO providers (id, name, type, base_url, api_key, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type,
      base_url = excluded.base_url, api_key = excluded.api_key, updated_at = excluded.updated_at
  `);
  const updateProviderSettings = database.prepare(`
    INSERT INTO provider_settings (provider_id, model, selected, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(provider_id) DO UPDATE SET model = excluded.model,
      selected = excluded.selected, updated_at = excluded.updated_at
  `);
  const insertPreset = database.prepare(`
    INSERT INTO presets
      (id, name, component_state, system_prompts, provider_settings, tool_permissions, skill_ids, mcp_config, sub_agents, updated_at, sort_order, selected)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const readPresetRows = database.prepare(`
    SELECT id, name, component_state, system_prompts, provider_settings, tool_permissions, skill_ids, mcp_config, sub_agents, updated_at, selected
    FROM presets ORDER BY sort_order
  `);
  const upsertMcpConfiguration = database.prepare(`
    INSERT INTO mcp_configuration (id, content, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `);
  const updateSystemPromptContent = database.prepare(`
    UPDATE system_prompts SET content = ?, updated_at = ? WHERE key = ?
  `);
  const insertSkill = database.prepare(`
    INSERT INTO skills (id, name, content, selected, updated_at)
    VALUES (?, ?, ?, 0, ?)
  `);
  const updateSkill = database.prepare(`
    UPDATE skills SET name = ?, content = ?, updated_at = ? WHERE id = ?
  `);
  const deleteSkill = database.prepare("DELETE FROM skills WHERE id = ?");
  const clearSelectedSkills = database.prepare("UPDATE skills SET selected = 0");
  const selectSkill = database.prepare("UPDATE skills SET selected = 1 WHERE id = ?");
  const insertPeriodicOperation = database.prepare(`
    INSERT INTO periodic_operations
      (id, name, task, agent, interval_value, interval_unit, priority, enabled,
       created_at, updated_at, last_run_at, next_run_at, last_status, last_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL)
  `);
  const updatePeriodicOperation = database.prepare(`
    UPDATE periodic_operations SET name = ?, task = ?, agent = ?, interval_value = ?,
      interval_unit = ?, priority = ?, enabled = ?, updated_at = ?, next_run_at = ?
    WHERE id = ?
  `);
  const deletePeriodicOperation = database.prepare("DELETE FROM periodic_operations WHERE id = ?");
  const updatePeriodicOperationRun = database.prepare(`
    UPDATE periodic_operations SET last_run_at = ?, next_run_at = ?, last_status = ?,
      last_error = ?, updated_at = ? WHERE id = ?
  `);
  const updatePeriodicOperationResult = database.prepare(`
    UPDATE periodic_operations SET last_status = ?, last_error = ?, updated_at = ? WHERE id = ?
  `);
  const insertOfficeMemory = database.prepare(`
    INSERT INTO office_memory
      (id, kind, status, title, summary, agent, source_id, details, artifacts, occurred_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOfficeTask = database.prepare(`
    INSERT INTO office_tasks
      (id, title, priority, status, depends_on, created_at, updated_at, artifacts)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, '[]')
  `);
  const assignOfficeTask = database.prepare(`
    UPDATE office_tasks SET status = 'running', agent = ?, message_id = ?,
      started_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'
  `);
  const completeOfficeTask = database.prepare(`
    UPDATE office_tasks SET status = ?, worker_task_id = ?, result = ?, error = ?,
      artifacts = ?, finished_at = ?, updated_at = ? WHERE id = ?
  `);
  const cancelOfficeTaskRecord = database.prepare(`
    UPDATE office_tasks SET status = 'cancelled', error = ?, finished_at = ?, updated_at = ?
    WHERE id = ? AND status IN ('pending', 'running')
  `);
  const deleteOfficeTaskRecord = database.prepare("DELETE FROM office_tasks WHERE id = ?");
  const readOfficeTaskDependencyRows = database.prepare(
    "SELECT id, title, status, depends_on FROM office_tasks ORDER BY created_at DESC",
  );
  const insertOfficeChatMessage = database.prepare(`
    INSERT INTO office_chat_messages
      (id, author, username, kind, text, artifacts, task_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertWorkerToken = database.prepare(`
    INSERT INTO worker_credentials (id, token, name, updated_at) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET token = excluded.token, name = excluded.name,
      updated_at = excluded.updated_at
  `);
  const upsertRegisteredWorker = database.prepare(`
    INSERT INTO worker_registry
      (name, description, url, capabilities, model, token_name, status, registered_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, 'connected', ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      url = excluded.url,
      capabilities = excluded.capabilities,
      model = excluded.model,
      token_name = excluded.token_name,
      status = 'connected',
      last_seen_at = excluded.last_seen_at
  `);
  const markRegisteredWorkerOffline = database.prepare(`
    UPDATE worker_registry SET status = 'offline', last_seen_at = ? WHERE name = ?
  `);

  const readOfficeChatMessages = ({ after = 0, limit = 200 } = {}) => {
    const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 200));
    return database.prepare(`
      SELECT id, author, username, kind, text, artifacts, task_id, created_at
      FROM office_chat_messages
      WHERE created_at > ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(Math.max(0, Number(after) || 0), boundedLimit).map((row) => ({
      id: row.id,
      author: row.author,
      username: row.username,
      kind: row.kind,
      text: row.text,
      artifacts: JSON.parse(row.artifacts),
      taskId: row.task_id,
      createdAt: row.created_at,
    }));
  };

  const readOfficeTasks = ({ limit = 200, status } = {}) => {
    const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 200));
    const rows = status
      ? database.prepare(`SELECT * FROM office_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?`).all(String(status), boundedLimit)
      : database.prepare(`SELECT * FROM office_tasks ORDER BY created_at DESC LIMIT ?`).all(boundedLimit);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      priority: row.priority,
      status: row.status,
      agent: row.agent,
      messageId: row.message_id,
      workerTaskId: row.worker_task_id,
      result: row.result,
      error: row.error,
      dependsOn: JSON.parse(row.depends_on || "[]"),
      deliveredWork: JSON.parse(row.artifacts),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    }));
  };

  const readOfficeMemory = ({ limit = 100, kind, status, query } = {}) => {
    const conditions = [];
    const values = [];
    if (kind) { conditions.push("kind = ?"); values.push(String(kind)); }
    if (status) { conditions.push("status = ?"); values.push(String(status)); }
    if (query) {
      conditions.push("(lower(title) LIKE ? OR lower(summary) LIKE ? OR lower(coalesce(agent, '')) LIKE ?)");
      const pattern = `%${String(query).toLowerCase()}%`;
      values.push(pattern, pattern, pattern);
    }
    const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const rows = database.prepare(`
      SELECT id, kind, status, title, summary, agent, source_id, details, artifacts,
        occurred_at, created_at FROM office_memory
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY occurred_at DESC LIMIT ?
    `).all(...values, boundedLimit);
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      title: row.title,
      summary: row.summary,
      agent: row.agent,
      sourceId: row.source_id,
      details: JSON.parse(row.details),
      artifacts: JSON.parse(row.artifacts),
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
    }));
  };

  const readPeriodicOperations = () => database.prepare(`
    SELECT id, name, task, agent, interval_value, interval_unit, priority, enabled,
      created_at, updated_at, last_run_at, next_run_at, last_status, last_error
    FROM periodic_operations ORDER BY enabled DESC, next_run_at, lower(name)
  `).all().map((row) => ({
    id: row.id,
    name: row.name,
    task: row.task,
    agent: row.agent,
    intervalValue: row.interval_value,
    intervalUnit: row.interval_unit,
    priority: row.priority,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
  }));

  const readSkills = () => database.prepare(`
    SELECT id, name, content, selected, updated_at
    FROM skills
    ORDER BY selected DESC, lower(name), id
  `).all().map((row) => ({
    id: row.id,
    name: row.name,
    content: row.content,
    selected: row.selected === 1,
    updatedAt: row.updated_at,
  }));

  const readCurrentProviderSettings = () => {
    const provider = database.prepare(`
      SELECT p.type, p.base_url, p.api_key, ps.model
      FROM providers p JOIN provider_settings ps ON ps.provider_id = p.id
      WHERE ps.selected = 1
      LIMIT 1
    `).get();
    return normalizeRigProviderSettings(provider
      ? {
        provider: provider.type,
        model: provider.model,
        baseUrl: provider.base_url,
        apiKey: provider.api_key,
      }
      : {});
  };

  const readProviders = () => database.prepare(`
    SELECT p.id, p.name, p.type, p.base_url, p.api_key, ps.model, ps.selected
    FROM providers p JOIN provider_settings ps ON ps.provider_id = p.id
    ORDER BY ps.selected DESC, p.name
  `).all().map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    model: row.model,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    selected: row.selected === 1,
  }));

  const matchingProviderId = (settings) => {
    const normalized = normalizeRigProviderSettings(settings, readCurrentProviderSettings());
    const providers = readProviders();
    const exact = providers.find((provider) => (
      provider.type === normalized.provider &&
      provider.model === normalized.model &&
      provider.baseUrl === normalized.baseUrl &&
      provider.apiKey === normalized.apiKey
    ));
    if (exact) return exact.id;
    const sameConnection = providers.find((provider) => (
      provider.type === normalized.provider &&
      provider.baseUrl === normalized.baseUrl &&
      provider.apiKey === normalized.apiKey
    ));
    if (sameConnection) return sameConnection.id;
    return normalized.provider;
  };

  const setCurrentProviderSettings = (settings, now = Date.now()) => {
    const normalized = normalizeRigProviderSettings(settings, readCurrentProviderSettings());
    const providerId = matchingProviderId(normalized);
    const existing = readProviders().find((provider) => provider.id === providerId);
    database.exec("UPDATE provider_settings SET selected = 0");
    upsertProvider.run(
      providerId,
      existing?.name || normalized.provider,
      normalized.provider,
      normalized.baseUrl,
      normalized.apiKey,
      now,
    );
    updateProviderSettings.run(providerId, normalized.model, 1, now);
    return normalized;
  };

  const readPresets = () => readPresetRows.all().map((row) => ({
    id: row.id,
    name: row.name,
    componentState: normalizeRigComponentState(JSON.parse(row.component_state)),
    systemPrompts: normalizeRigSystemPrompts(JSON.parse(row.system_prompts)),
    providerSettings: normalizeRigProviderSettings(JSON.parse(row.provider_settings), readCurrentProviderSettings()),
    toolPermissions: normalizeStoredToolPermissions(JSON.parse(row.tool_permissions)),
    skillIds: [...new Set(JSON.parse(row.skill_ids).map((id) => String(id)))],
    mcpConfig: row.mcp_config || "",
    subAgents: normalizeSubAgentWorkers(JSON.parse(row.sub_agents || "[]")),
    updatedAt: row.updated_at,
    selected: row.selected === 1,
  }));

  const applyRigConfigurationSnapshot = (configuration, { syncProviderSettings = true } = {}) => {
    if (!configuration) return;
    const prompts = normalizeRigSystemPrompts(configuration.systemPrompts);
    for (const [key, content] of Object.entries(prompts)) {
      updateSystemPromptContent.run(String(content), Date.now(), key);
    }
    if (syncProviderSettings) setCurrentProviderSettings(configuration.providerSettings, Date.now());
    const knownSkillIds = new Set(readSkills().map((skill) => skill.id));
    clearSelectedSkills.run();
    configuration.skillIds.filter((id) => knownSkillIds.has(id)).forEach((id) => selectSkill.run(id));
    upsertMcpConfiguration.run(String(configuration.mcpConfig || ""), Date.now());
  };

  const buildDefaultRigConfiguration = (name = "Default") => ({
    id: crypto.randomUUID(),
    name,
    componentState: normalizeRigComponentState(),
    systemPrompts: normalizeRigSystemPrompts(
      Object.fromEntries(database.prepare("SELECT key, content FROM system_prompts").all().map(({ key, content }) => [key, content])),
    ),
    providerSettings: readCurrentProviderSettings(),
    toolPermissions: normalizeStoredToolPermissions(),
    skillIds: readSkills().filter((skill) => skill.selected).map((skill) => skill.id),
    mcpConfig: database.prepare("SELECT content FROM mcp_configuration WHERE id = 1").get()?.content || "",
    subAgents: [],
    updatedAt: Date.now(),
    selected: true,
  });

  const replaceRigConfigurations = (configurations = [], activeConfigurationId = null, options = {}) => {
    const currentProviderSettings = readCurrentProviderSettings();
    const currentSkillIds = readSkills().filter((skill) => skill.selected).map((skill) => skill.id);
    const knownSkillIds = new Set(readSkills().map((skill) => skill.id));
    const normalized = (Array.isArray(configurations) && configurations.length
      ? configurations.map((configuration, index) => normalizeRigConfiguration({
        ...configuration,
        providerSettings: configuration?.providerSettings || currentProviderSettings,
        skillIds: Array.isArray(configuration?.skillIds) ? configuration.skillIds : currentSkillIds,
      }, index))
      : [buildDefaultRigConfiguration()]).map((configuration, index) => ({
      ...configuration,
      skillIds: configuration.skillIds.filter((id) => knownSkillIds.has(id)),
      selected: configuration.selected === true && activeConfigurationId == null ? true : false,
      sortOrder: index,
    }));
    const effectiveActiveConfigurationId = normalized.some((configuration) => configuration.id === activeConfigurationId)
      ? String(activeConfigurationId)
      : normalized.find((configuration) => configuration.selected)?.id || normalized[0].id;
    database.exec("DELETE FROM presets");
    normalized.forEach((configuration, index) => {
      insertPreset.run(
        configuration.id,
        configuration.name,
        JSON.stringify(configuration.componentState),
        JSON.stringify(configuration.systemPrompts),
        JSON.stringify(normalizeRigProviderSettings(configuration.providerSettings, readCurrentProviderSettings())),
        JSON.stringify(configuration.toolPermissions),
        JSON.stringify(configuration.skillIds),
        configuration.mcpConfig,
        JSON.stringify(configuration.subAgents),
        Number(configuration.updatedAt) || Date.now(),
        index,
        configuration.id === effectiveActiveConfigurationId ? 1 : 0,
      );
    });
    applyRigConfigurationSnapshot(
      normalized.find((configuration) => configuration.id === effectiveActiveConfigurationId),
      options,
    );
    return {
      configurations: normalized.map(({ sortOrder, ...configuration }) => ({
        ...configuration,
        selected: configuration.id === effectiveActiveConfigurationId,
      })),
      activeConfigurationId: effectiveActiveConfigurationId,
    };
  };

  function writeValues(values) {
    const entries = Object.entries(values || {}).filter(([key]) => ALLOWED_KEYS.has(key));
    if (entries.length === 0) throw new Error("No valid UI state keys were provided.");
    const now = Date.now();
    if (Object.hasOwn(values, "sessions")) {
      database.exec("DELETE FROM sessions");
      for (const [index, session] of (Array.isArray(values.sessions) ? values.sessions : []).entries()) {
        replaceSession.run(
          String(session.id),
          String(session.title || "New chat"),
          String(session.workspace || "."),
          Number(session.updatedAt) || now,
          index,
        );
        for (const [messageOrder, message] of (Array.isArray(session.messages) ? session.messages : []).entries()) {
          insertMessage.run(
            String(session.id), messageOrder, String(message.role || "user"), String(message.text || ""),
            JSON.stringify(Array.isArray(message.images) ? message.images : []),
          );
        }
        for (const [eventOrder, event] of (Array.isArray(session.events) ? session.events : []).entries()) {
          const eventDetail = event.detail && typeof event.detail === "object"
            ? { ...event.detail }
            : event.detail;
          const inputPrompt = eventDetail?.inputPrompt;
          const serverResponse = eventDetail?.serverResponse;
          if (eventDetail && typeof eventDetail === "object") {
            delete eventDetail.inputPrompt;
            delete eventDetail.serverResponse;
          }
          insertEvent.run(
            String(session.id), eventOrder, String(event.title || "Event"),
            eventDetail === undefined ? null : JSON.stringify(eventDetail),
            inputPrompt === undefined ? null : JSON.stringify(inputPrompt),
            serverResponse === undefined ? null : JSON.stringify(serverResponse),
            Number(event.timestamp) || now,
          );
        }
        for (const [promptOrder, entry] of (Array.isArray(session.tokenHistory) ? session.tokenHistory : []).entries()) {
          const inputTokens = Math.max(0, Number(entry.inputTokens) || 0);
          const outputTokens = Math.max(0, Number(entry.outputTokens) || 0);
          insertTokenUsage.run(
            String(session.id),
            promptOrder,
            String(entry.id || `${session.id}-${promptOrder}`),
            String(entry.prompt || ""),
            inputTokens,
            outputTokens,
            Math.max(0, Number(entry.totalTokens) || (inputTokens + outputTokens)),
            Number(entry.timestamp) || now,
          );
        }
      }
    }
    if (Array.isArray(values.providers)) {
      database.exec("DELETE FROM provider_settings; DELETE FROM providers");
      for (const item of values.providers) {
        const id = String(item.id);
        upsertProvider.run(id, String(item.name || item.type || "Provider"), String(item.type || "openai"),
          String(item.baseUrl || ""), String(item.apiKey || ""), now);
        updateProviderSettings.run(id, String(item.model || ""), item.selected === true ? 1 : 0, now);
      }
      const active = readPresets().find((configuration) => configuration.selected);
      if (active) {
        replaceRigConfigurations(
          readPresets().map((configuration) => (
            configuration.id === active.id
              ? {
                ...configuration,
                providerSettings: readCurrentProviderSettings(),
                updatedAt: Date.now(),
              }
              : configuration
          )),
          active.id,
        );
      }
    } else if (values.providerSettings && typeof values.providerSettings === "object") {
      const providerSettings = setCurrentProviderSettings(values.providerSettings, now);
      const active = readPresets().find((configuration) => configuration.selected);
      if (active) {
        replaceRigConfigurations(
          readPresets().map((configuration) => (
            configuration.id === active.id
              ? {
                ...configuration,
                providerSettings,
                updatedAt: Date.now(),
              }
              : configuration
          )),
          active.id,
        );
      }
    }
    if (values.toolPermissions && typeof values.toolPermissions === "object") {
      const active = readPresets().find((configuration) => configuration.selected);
      if (active) {
        replaceRigConfigurations(
          readPresets().map((configuration) => (
            configuration.id === active.id
              ? {
                ...configuration,
                toolPermissions: normalizeStoredToolPermissions(values.toolPermissions),
                updatedAt: Date.now(),
              }
              : configuration
          )),
          active.id,
        );
      }
    }
  }

  const legacyProvidersTable = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'providers_legacy_single'",
  ).get();
  if (legacyProvidersTable) {
    const legacyProviders = database.prepare(`
      SELECT p.provider AS id, p.provider AS name, p.provider AS type, p.base_url, p.api_key,
        ps.model, CASE WHEN ps.id = 1 THEN 1 ELSE 0 END AS selected
      FROM providers_legacy_single p
      LEFT JOIN provider_settings_legacy_single ps ON ps.provider = p.provider
    `).all().map((row) => ({ ...row, baseUrl: row.base_url, apiKey: row.api_key, selected: row.selected === 1 }));
    database.exec("BEGIN IMMEDIATE");
    try {
      writeValues({ providers: legacyProviders });
      database.exec("DROP TABLE provider_settings_legacy_single; DROP TABLE providers_legacy_single");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  const legacySessionsTable = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions_legacy_json'",
  ).get();
  if (legacySessionsTable) {
    const sessions = database.prepare(`
      SELECT id, title, workspace, messages, events, updated_at, sort_order
      FROM sessions_legacy_json ORDER BY sort_order
    `).all().map((row) => ({
      id: row.id,
      title: row.title,
      workspace: row.workspace,
      messages: JSON.parse(row.messages),
      events: JSON.parse(row.events),
      updatedAt: row.updated_at,
    }));
    database.exec("BEGIN IMMEDIATE");
    try {
      writeValues({ sessions });
      database.exec("DROP TABLE sessions_legacy_json");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  const legacyTable = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ui_state'",
  ).get();
  if (legacyTable) {
    const legacyState = Object.fromEntries(
      database.prepare("SELECT key, value FROM ui_state").all().flatMap(({ key, value }) => {
        try { return [[key, JSON.parse(value)]]; } catch { return []; }
      }),
    );
    const migratable = Object.fromEntries(
      Object.entries(legacyState).filter(([key]) => ALLOWED_KEYS.has(key)),
    );
    database.exec("BEGIN IMMEDIATE");
    try {
      if (Object.keys(migratable).length > 0) writeValues(migratable);
      database.exec("DROP TABLE ui_state");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  if (readPresets().length === 0) {
    database.exec("BEGIN IMMEDIATE");
    try {
      replaceRigConfigurations([buildDefaultRigConfiguration()], null, { syncProviderSettings: false });
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    getAll() {
      const readMessages = database.prepare(`
        SELECT role, text, images FROM messages WHERE session_id = ? ORDER BY message_order
      `);
      const readEvents = database.prepare(`
        SELECT title, detail, input_prompt, server_response, timestamp
        FROM events WHERE session_id = ? ORDER BY event_order
      `);
      const readTokenUsage = database.prepare(`
        SELECT prompt_id, prompt_text, input_tokens, output_tokens, total_tokens, timestamp
        FROM token_usage WHERE session_id = ? ORDER BY prompt_order
      `);
      const sessions = database.prepare(`
        SELECT id, title, workspace, updated_at FROM sessions ORDER BY sort_order
      `).all().map((row) => ({
        id: row.id,
        title: row.title,
        workspace: row.workspace,
        messages: readMessages.all(row.id).map((message) => {
          const images = JSON.parse(message.images);
          return { role: message.role, text: message.text, ...(images.length > 0 ? { images } : {}) };
        }),
        events: readEvents.all(row.id).map((event) => {
          const detail = event.detail === null ? undefined : JSON.parse(event.detail);
          if (event.input_prompt !== null || event.server_response !== null) {
            const restored = detail && typeof detail === "object" ? detail : {};
            if (event.input_prompt !== null) restored.inputPrompt = JSON.parse(event.input_prompt);
            if (event.server_response !== null) restored.serverResponse = JSON.parse(event.server_response);
            return { title: event.title, detail: restored, timestamp: event.timestamp };
          }
          return { title: event.title, ...(detail === undefined ? {} : { detail }), timestamp: event.timestamp };
        }),
        tokenHistory: readTokenUsage.all(row.id).map((entry) => ({
          id: entry.prompt_id,
          prompt: entry.prompt_text,
          inputTokens: entry.input_tokens,
          outputTokens: entry.output_tokens,
          totalTokens: entry.total_tokens,
          timestamp: entry.timestamp,
        })),
        updatedAt: row.updated_at,
      }));
      const providers = readProviders();
      const provider = providers.find((item) => item.selected);
      const activePreset = readPresets().find((configuration) => configuration.selected);
      return {
        ...(sessions.length > 0 ? { sessions } : {}),
        ...(provider ? { providerSettings: {
          provider: provider.type,
          model: provider.model,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
        } } : {}),
        ...(providers.length > 0 ? { providers } : {}),
        toolPermissions: normalizeStoredToolPermissions(activePreset?.toolPermissions),
      };
    },
    set(values) {
      database.exec("BEGIN IMMEDIATE");
      try {
        writeValues(values);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      database.close();
    },
    factoryReset() {
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(`
          DELETE FROM office_chat_messages;
          DELETE FROM system_activity_logs;
          DELETE FROM office_memory;
          DELETE FROM office_tasks;
          DELETE FROM periodic_operations;
          DELETE FROM sessions;
          DELETE FROM presets;
          DELETE FROM skills;
          DELETE FROM mcp_configuration;
          DELETE FROM provider_settings;
          DELETE FROM providers;
          DELETE FROM system_prompts;
          DELETE FROM worker_registry;
          DELETE FROM worker_credentials;
        `);
        seedSystemPromptDefaults();
        replaceRigConfigurations([buildDefaultRigConfiguration()], null, { syncProviderSettings: false });
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return {
        sessions: 0,
        tasks: 0,
        messages: 0,
        memory: 0,
        operations: 0,
        skills: 0,
      };
    },
    getProviders() {
      return readProviders();
    },
    getSelectedProvider() {
      return readProviders().find((provider) => provider.selected) || null;
    },
    setSelectedProvider(providerId) {
      const id = String(providerId);
      const providers = readProviders();
      if (!providers.some((provider) => provider.id === id)) {
        throw new Error(`Unknown provider: ${id}`);
      }
      this.set({
        providers: providers.map((provider) => ({
          ...provider,
          selected: provider.id === id,
        })),
      });
      return this.getSelectedProvider();
    },
    getMcpConfig() {
      return database.prepare("SELECT content FROM mcp_configuration WHERE id = 1").get()?.content;
    },
    setMcpConfig(content) {
      const nextContent = String(content);
      upsertMcpConfiguration.run(nextContent, Date.now());
      const active = readPresets().find((configuration) => configuration.selected);
      if (!active) return;
      this.setRigConfigurations(
        readPresets().map((configuration) => (
          configuration.id === active.id ? { ...configuration, mcpConfig: nextContent, updatedAt: Date.now() } : configuration
        )),
        active.id,
      );
    },
    getSystemPrompts() {
      return Object.fromEntries(database.prepare(
        "SELECT key, content FROM system_prompts ORDER BY key",
      ).all().map(({ key, content }) => [key, content]));
    },
    getSystemPromptRows() {
      return database.prepare("SELECT key, title, content FROM system_prompts ORDER BY title").all();
    },
    setSystemPrompt(key, content) {
      const result = updateSystemPromptContent.run(String(content), Date.now(), String(key));
      if (result.changes === 0) throw new Error("Unknown system prompt.");
      const active = readPresets().find((configuration) => configuration.selected);
      if (!active) return;
      this.setRigConfigurations(
        readPresets().map((configuration) => (
          configuration.id === active.id
            ? {
              ...configuration,
              systemPrompts: { ...configuration.systemPrompts, [key]: String(content) },
              updatedAt: Date.now(),
            }
            : configuration
        )),
        active.id,
      );
    },
    getRigConfigurations() {
      const configurations = readPresets();
      return {
        configurations,
        activeConfigurationId: configurations.find((configuration) => configuration.selected)?.id || null,
      };
    },
    setRigConfigurations(configurations, activeConfigurationId) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = replaceRigConfigurations(configurations, activeConfigurationId);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    getPeriodicOperations() {
      return readPeriodicOperations();
    },
    createPeriodicOperation(operation) {
      const id = crypto.randomUUID();
      const now = Date.now();
      insertPeriodicOperation.run(
        id, operation.name, operation.task, operation.agent, operation.intervalValue,
        operation.intervalUnit, operation.priority, operation.enabled ? 1 : 0,
        now, now, operation.nextRunAt,
      );
      return readPeriodicOperations().find((entry) => entry.id === id);
    },
    updatePeriodicOperation(id, operation) {
      const result = updatePeriodicOperation.run(
        operation.name, operation.task, operation.agent, operation.intervalValue,
        operation.intervalUnit, operation.priority, operation.enabled ? 1 : 0,
        Date.now(), operation.nextRunAt, String(id),
      );
      if (result.changes === 0) throw new Error(`Unknown periodic operation: ${id}`);
      return readPeriodicOperations().find((entry) => entry.id === String(id));
    },
    deletePeriodicOperation(id) {
      const result = deletePeriodicOperation.run(String(id));
      if (result.changes === 0) throw new Error(`Unknown periodic operation: ${id}`);
    },
    recordPeriodicOperationRun(id, { lastRunAt, nextRunAt, status, error = null }) {
      const result = updatePeriodicOperationRun.run(
        lastRunAt, nextRunAt, status, error, Date.now(), String(id),
      );
      return result.changes > 0;
    },
    recordPeriodicOperationResult(id, { status, error = null }) {
      const result = updatePeriodicOperationResult.run(status, error, Date.now(), String(id));
      return result.changes > 0;
    },
    getOfficeMemory(filters = {}) {
      return readOfficeMemory(filters);
    },
    recordOfficeMemory(entry) {
      const now = Date.now();
      const kind = ["task", "operation", "system"].includes(entry.kind) ? entry.kind : "system";
      const id = String(entry.id || crypto.randomUUID());
      insertOfficeMemory.run(
        id,
        kind,
        String(entry.status || "info"),
        String(entry.title || "Office event"),
        String(entry.summary || ""),
        entry.agent ? String(entry.agent) : null,
        entry.sourceId ? String(entry.sourceId) : null,
        JSON.stringify(entry.details && typeof entry.details === "object" ? entry.details : {}),
        JSON.stringify(Array.isArray(entry.artifacts) ? entry.artifacts : []),
        Number(entry.occurredAt) || now,
        now,
      );
      return readOfficeMemory({ limit: 1 }).find((record) => record.id === id) || { id };
    },
    getOfficeTasks(filters = {}) {
      return readOfficeTasks(filters);
    },
    createOfficeTask({ title, priority = "medium", dependsOn = [] }) {
      const id = crypto.randomUUID();
      const now = Date.now();
      insertOfficeTask.run(id, String(title), priority, JSON.stringify(dependsOn), now, now);
      return readOfficeTasks().find((task) => task.id === id);
    },
    assignOfficeTask(id, { agent, messageId }) {
      const now = Date.now();
      const result = assignOfficeTask.run(String(agent), String(messageId), now, now, String(id));
      if (result.changes === 0) throw new Error("Task is unknown or has already been assigned.");
      return readOfficeTasks().find((task) => task.id === String(id));
    },
    completeOfficeTask(id, { status, workerTaskId = null, result = null, error = null, deliveredWork = [] }) {
      const now = Date.now();
      const update = completeOfficeTask.run(
        String(status), workerTaskId ? String(workerTaskId) : null,
        result ? String(result) : null, error ? String(error) : null,
        JSON.stringify(Array.isArray(deliveredWork) ? deliveredWork : []), now, now, String(id),
      );
      if (update.changes === 0) throw new Error(`Unknown task: ${id}`);
      return readOfficeTasks().find((task) => task.id === String(id));
    },
    cancelOfficeTask(id, { error = "Task stopped by the office manager." } = {}) {
      const now = Date.now();
      cancelOfficeTaskRecord.run(String(error), now, now, String(id));
      const task = readOfficeTasks({ limit: 500 }).find((entry) => entry.id === String(id));
      if (!task) throw new Error(`Unknown task: ${id}`);
      return task;
    },
    getOfficeTaskDependents(id) {
      const taskId = String(id);
      return readOfficeTaskDependencyRows.all().flatMap((row) => {
        const dependencies = JSON.parse(row.depends_on || "[]");
        return dependencies.includes(taskId)
          ? [{ id: row.id, title: row.title, status: row.status }]
          : [];
      });
    },
    deleteOfficeTask(id) {
      const result = deleteOfficeTaskRecord.run(String(id));
      if (result.changes === 0) throw new Error(`Unknown task: ${id}`);
      return true;
    },
    getOfficeChatMessages(filters = {}) {
      return readOfficeChatMessages(filters);
    },
    recordSystemActivity(entry) {
      const id = String(entry?.id || crypto.randomUUID());
      const createdAt = Number(entry?.createdAt) || Date.now();
      database.prepare(`
        INSERT INTO system_activity_logs
          (id, category, source, message, tone, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        String(entry?.category || "system").slice(0, 40),
        String(entry?.source || "System").slice(0, 100),
        String(entry?.message || "").slice(0, 20_000),
        String(entry?.tone || "").slice(0, 20),
        JSON.stringify(entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : {}),
        createdAt,
      );
      database.prepare(`
        DELETE FROM system_activity_logs WHERE id IN (
          SELECT id FROM system_activity_logs ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET 5000
        )
      `).run();
      return { id, createdAt };
    },
    getSystemActivity({ limit = 200 } = {}) {
      const boundedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
      return database.prepare(`
        SELECT id, category, source, message, tone, metadata, created_at
        FROM system_activity_logs
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `).all(boundedLimit).reverse().map((row) => ({
        id: row.id,
        category: row.category,
        source: row.source,
        message: row.message,
        tone: row.tone,
        metadata: JSON.parse(row.metadata || "{}"),
        createdAt: row.created_at,
      }));
    },
    getWorkerToken() {
      return database.prepare("SELECT token FROM worker_credentials WHERE id = 1").get()?.token || "";
    },
    getWorkerTokenName() {
      return database.prepare("SELECT name FROM worker_credentials WHERE id = 1").get()?.name || "";
    },
    setWorkerToken(token, name = "Default worker token") {
      const normalized = String(token || "").trim();
      const normalizedName = String(name || "").trim();
      if (normalized.length < 32) throw new Error("Worker token must be at least 32 characters.");
      if (!normalizedName || normalizedName.length > 100) throw new Error("Token name must be between 1 and 100 characters.");
      upsertWorkerToken.run(normalized, normalizedName, Date.now());
      return true;
    },
    upsertRegisteredWorker(worker) {
      const normalized = normalizeSubAgentWorkers([worker])[0];
      const now = Date.now();
      upsertRegisteredWorker.run(
        normalized.name,
        normalized.description,
        normalized.url,
        JSON.stringify(normalized.capabilities),
        normalized.model ? JSON.stringify(normalized.model) : null,
        String(worker?.tokenName || "").trim(),
        now,
        now,
      );
      return this.getRegisteredWorkers().find((entry) => entry.name === normalized.name);
    },
    markRegisteredWorkerOffline(name) {
      markRegisteredWorkerOffline.run(Date.now(), String(name || ""));
      return true;
    },
    getRegisteredWorkers() {
      return database.prepare(`
        SELECT name, description, url, capabilities, model, token_name, status,
          registered_at, last_seen_at
        FROM worker_registry
        ORDER BY CASE status WHEN 'connected' THEN 0 ELSE 1 END, name COLLATE NOCASE
      `).all().map((row) => ({
        name: row.name,
        description: row.description,
        url: row.url,
        capabilities: JSON.parse(row.capabilities || "{}"),
        ...(row.model ? { model: JSON.parse(row.model) } : {}),
        tokenName: row.token_name,
        status: row.status,
        registeredAt: row.registered_at,
        lastSeenAt: row.last_seen_at,
      }));
    },
    createOfficeChatMessage(message) {
      const id = String(message.id || crypto.randomUUID());
      const createdAt = Number(message.createdAt) || Date.now();
      insertOfficeChatMessage.run(
        id,
        String(message.author),
        String(message.username),
        String(message.kind),
        String(message.text),
        JSON.stringify(Array.isArray(message.artifacts) ? message.artifacts : []),
        message.taskId ? String(message.taskId) : null,
        createdAt,
      );
      return readOfficeChatMessages({ after: Math.max(0, createdAt - 1), limit: 500 })
        .find((entry) => entry.id === id) || null;
    },
    getSkills() {
      return readSkills();
    },
    getSelectedSkills() {
      return readSkills().filter((skill) => skill.selected);
    },
    createSkill({ name, content }) {
      const normalizedName = String(name || "").trim();
      if (!normalizedName) throw new Error("Skill name is required.");
      if (readSkills().some((skill) => skill.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) {
        throw new Error(`A skill named ${normalizedName} already exists.`);
      }
      const id = crypto.randomUUID();
      insertSkill.run(id, normalizedName, String(content || ""), Date.now());
      const skills = readSkills();
      return { skill: skills.find((skill) => skill.id === id), skills };
    },
    updateSkill(skillId, { name, content }) {
      const id = String(skillId);
      const normalizedName = String(name || "").trim();
      const skills = readSkills();
      if (!skills.some((skill) => skill.id === id)) throw new Error(`Unknown skill: ${id}`);
      if (!normalizedName) throw new Error("Skill name is required.");
      if (skills.some((skill) => (
        skill.id !== id && skill.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase()
      ))) {
        throw new Error(`A skill named ${normalizedName} already exists.`);
      }
      updateSkill.run(normalizedName, String(content || ""), Date.now(), id);
      const updatedSkills = readSkills();
      return { skill: updatedSkills.find((skill) => skill.id === id), skills: updatedSkills };
    },
    deleteSkill(skillId) {
      const id = String(skillId);
      const configurations = readPresets();
      const activeId = configurations.find((configuration) => configuration.selected)?.id;
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = deleteSkill.run(id);
        if (result.changes === 0) throw new Error(`Unknown skill: ${id}`);
        replaceRigConfigurations(configurations.map((configuration) => ({
          ...configuration,
          skillIds: configuration.skillIds.filter((skillIdEntry) => skillIdEntry !== id),
          updatedAt: Date.now(),
        })), activeId);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return { skills: readSkills() };
    },
    setSelectedSkills(skillIds = []) {
      const ids = [...new Set((Array.isArray(skillIds) ? skillIds : []).map((id) => String(id)))];
      const skills = readSkills();
      const known = new Set(skills.map((skill) => skill.id));
      for (const id of ids) {
        if (!known.has(id)) throw new Error(`Unknown skill: ${id}`);
      }
      database.exec("BEGIN IMMEDIATE");
      try {
        clearSelectedSkills.run();
        ids.forEach((id) => selectSkill.run(id));
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      const active = readPresets().find((configuration) => configuration.selected);
      if (active) {
        this.setRigConfigurations(
          readPresets().map((configuration) => (
            configuration.id === active.id
              ? { ...configuration, skillIds: ids, updatedAt: Date.now() }
              : configuration
          )),
          active.id,
        );
      }
      return this.getSelectedSkills();
    },
  };
}
