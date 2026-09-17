import './office-mcp-settings.mjs';
import OfficeComponent from "./office-component.mjs";
import { escapeHtml, fetchJson } from "./office-format.mjs";

class OfficeSettings extends OfficeComponent {
  static hostAttributes = {"class": "panel settings-panel"};
  model = { systemPrompts: [], selectedPromptKey: null, settingsTab: "prompts", toolPermissions: {}, providerSettings: { provider: "openai", model: "", baseUrl: "", apiKey: "" }, mcpConfig: "", mcpDirty: false, providerDirty: false, promptDirty: false };

  render() {
    this.appendChildren(this, [
      this.createElement("header", { "class": "panel-header", children: [
        this.createElement("div", { children: [
          this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#gear" })
          ] }),
          this.createElement("h2", { textContent: "SETTINGS" })
        ] }),
        this.createElement("span", { "class": "panel-meta", "id": "settings-status", textContent: "SELECT A PROMPT" })
      ] }),
      this.createElement("nav", { "class": "settings-tabs panel-body", "role": "tablist", "aria-label": "Settings sections", children: [
        this.createElement("button", { "type": "button", "role": "tab", "aria-selected": "false", "data-settings-tab": "appearance", textContent: "APPEARANCE" }),
        this.createElement("button", { "class": "active", "type": "button", "role": "tab", "aria-selected": "true", "data-settings-tab": "prompts", textContent: "SYS PROMPTS" }),
        this.createElement("button", { "type": "button", "role": "tab", "aria-selected": "false", "data-settings-tab": "tools", textContent: "TOOLS" }),
        this.createElement("button", { "type": "button", "role": "tab", "aria-selected": "false", "data-settings-tab": "mcp", textContent: "MCP" }),
        this.createElement("button", { "type": "button", "role": "tab", "aria-selected": "false", "data-settings-tab": "provider", textContent: "PROVIDER" }),
        this.createElement("button", { "type": "button", "role": "tab", "aria-selected": "false", "data-settings-tab": "admin", textContent: "SYS ADMIN" })
      ] }),
      this.createElement("div", { "class": "settings-view appearance-settings panel-body", "data-settings-view": "appearance", "hidden": "", children: [
        this.createElement("div", { "class": "appearance-heading", children: [
          this.createElement("span", { "class": "appearance-eyebrow", textContent: "MAKE YOURSELF AT HOME" }),
          this.createElement("h3", { textContent: "Appearance" }),
          this.createElement("p", { textContent: "Choose a look for your office. Changes apply instantly and are saved in this browser." })
        ] }),
        this.createElement("fieldset", { "class": "theme-options", children: [
          this.createElement("legend", { textContent: "Office theme" }),
          this.createElement("label", { "class": "theme-option", children: [
            this.createElement("input", { "type": "radio", "name": "office-theme", "value": "terminal" }),
            this.createElement("span", { "class": "theme-preview preview-terminal", "aria-hidden": "true", children: [
              this.createElement("span", { "class": "preview-top" }),
              this.createElement("span", { "class": "preview-rail" }),
              this.createElement("span", { "class": "preview-content", children: [
                this.createElement("i", {  }),
                this.createElement("i", {  }),
                this.createElement("i", {  }),
                this.createElement("i", {  })
              ] })
            ] }),
            this.createElement("span", { "class": "theme-option-copy", children: [
              this.createElement("strong", { children: [
                document.createTextNode("Terminal "),
                this.createElement("span", { "class": "theme-selected", textContent: "Selected" })
              ] }),
              this.createElement("small", { textContent: "The original dark office, with monospace type and green accents." })
            ] })
          ] }),
          this.createElement("label", { "class": "theme-option", children: [
            this.createElement("input", { "type": "radio", "name": "office-theme", "value": "teams" }),
            this.createElement("span", { "class": "theme-preview preview-teams", "aria-hidden": "true", children: [
              this.createElement("span", { "class": "preview-top" }),
              this.createElement("span", { "class": "preview-rail" }),
              this.createElement("span", { "class": "preview-content", children: [
                this.createElement("i", {  }),
                this.createElement("i", {  }),
                this.createElement("i", {  }),
                this.createElement("i", {  })
              ] })
            ] }),
            this.createElement("span", { "class": "theme-option-copy", children: [
              this.createElement("strong", { children: [
                document.createTextNode("Teams "),
                this.createElement("span", { "class": "theme-selected", textContent: "Selected" })
              ] }),
              this.createElement("small", { textContent: "A bright workspace with soft lavender, white cards, and a purple navigation rail." })
            ] })
          ] }),
          this.createElement("label", { "class": "theme-option", children: [
            this.createElement("input", { "type": "radio", "name": "office-theme", "value": "matrix" }),
            this.createElement("span", { "class": "theme-preview preview-matrix", "aria-hidden": "true", children: [
              this.createElement("span", { "class": "preview-top" }),
              this.createElement("span", { "class": "preview-rail" }),
              this.createElement("span", { "class": "preview-content", children: [
                this.createElement("i", {  }),
                this.createElement("i", {  }),
                this.createElement("i", {  }),
                this.createElement("i", {  })
              ] })
            ] }),
            this.createElement("span", { "class": "theme-option-copy", children: [
              this.createElement("strong", { children: [
                document.createTextNode("Matrix "),
                this.createElement("span", { "class": "theme-selected", textContent: "Selected" })
              ] }),
              this.createElement("small", { textContent: "Digital rain, glowing green accents, and a midnight terminal." })
            ] })
          ] }),
          this.createElement("label", { "class": "theme-option", children: [
            this.createElement("input", { "type": "radio", "name": "office-theme", "value": "sakura" }),
            this.createElement("span", { "class": "theme-preview preview-sakura", "aria-hidden": "true", children: [
              this.createElement("span", { "class": "preview-top" }),
              this.createElement("span", { "class": "preview-rail" }),
              this.createElement("span", { "class": "preview-content", children: [
                this.createElement("i", {  }),
                this.createElement("i", {  }),
                this.createElement("i", {  }),
                this.createElement("i", {  })
              ] })
            ] }),
            this.createElement("span", { "class": "theme-option-copy", children: [
              this.createElement("strong", { children: [
                document.createTextNode("Sakura "),
                this.createElement("span", { "class": "theme-selected", textContent: "Selected" })
              ] }),
              this.createElement("small", { textContent: "Cherry blossoms, a sunset cityscape, and soft violet panels." })
            ] })
          ] })
        ] }),
        this.createElement("p", { "class": "theme-save-status", "id": "theme-save-status", "role": "status" })
      ] }),
      this.createElement("div", { "class": "settings-body settings-view panel-body", "data-settings-view": "prompts", children: [
        this.createElement("aside", { "class": "prompt-list", "id": "prompt-list", "aria-label": "System prompts" }),
        this.createElement("section", { "class": "prompt-editor", children: [
          this.createElement("div", { "class": "prompt-editor-heading", children: [
            this.createElement("span", { textContent: "EDITING" }),
            this.createElement("strong", { "id": "prompt-editor-title", textContent: "Select a system prompt" }),
            this.createElement("code", { "id": "prompt-editor-key", textContent: "—" })
          ] }),
          this.createElement("textarea", { "id": "system-prompt-content", "spellcheck": "false", "disabled": "", "placeholder": "Select a prompt from the list." }),
          this.createElement("footer", { "class": "prompt-editor-actions", children: [
            this.createElement("button", { "id": "reset-system-prompt", "type": "button", "disabled": "", textContent: "RESET CHANGES" }),
            this.createElement("button", { "class": "primary", "id": "save-system-prompt", "type": "button", "disabled": "", textContent: "SAVE PROMPT" })
          ] })
        ] })
      ] }),
      this.createElement("div", { "class": "settings-view tools-settings panel-body", "data-settings-view": "tools", "hidden": "", children: [
        this.createElement("div", { "class": "settings-section-intro", children: [
          this.createElement("strong", { textContent: "INTERNAL TOOLS" }),
          this.createElement("span", { textContent: "Choose which tools the office manager may call." })
        ] }),
        this.createElement("div", { "class": "tool-permissions", "id": "tool-permissions" })
      ] }),
      this.createElement("div", { "class": "settings-view editor-settings panel-body", "data-settings-view": "mcp", "hidden": "", children: [
        this.createElement("div", { "class": "settings-section-intro", children: [
          this.createElement("strong", { textContent: "MCP CONFIGURATION" }),
          this.createElement("span", { textContent: "Connect MCP servers with a URL and optional authentication headers. Test to discover available methods." })
        ] }),
        this.createElement('office-mcp-settings', { id: 'mcp-config-content' }),
        this.createElement("footer", { "class": "settings-actions", children: [
          this.createElement("button", { "id": "reset-mcp-config", "type": "button", textContent: "RESET CHANGES" }),
          this.createElement("button", { "class": "primary", "id": "save-mcp-config", "type": "button", textContent: "SAVE MCP" })
        ] })
      ] }),
      this.createElement("form", { "class": "settings-view provider-settings panel-body", "data-settings-view": "provider", "id": "provider-form", "hidden": "", children: [
        this.createElement("div", { "class": "settings-section-intro", children: [
          this.createElement("strong", { textContent: "MODEL PROVIDER" }),
          this.createElement("span", { textContent: "Connection used by the internal office manager." })
        ] }),
        this.createElement("div", { "class": "settings-fields", children: [
          this.createElement("label", { "for": "provider-type", textContent: "PROVIDER" }),
          this.createElement("select", { "id": "provider-type", children: [
            this.createElement("option", { "value": "openai", textContent: "OPENAI" }),
            this.createElement("option", { "value": "ollama", textContent: "OLLAMA" }),
            this.createElement("option", { "value": "custom", textContent: "CUSTOM" })
          ] }),
          this.createElement("label", { "for": "provider-model", textContent: "MODEL" }),
          this.createElement("select", { "id": "provider-model", "required": "", children: [
            this.createElement("option", { "value": "", textContent: "REFRESH MODELS TO SELECT" })
          ] }),
          this.createElement("label", { "for": "provider-base-url", textContent: "BASE URL" }),
          this.createElement("input", { "id": "provider-base-url", "type": "url", "autocomplete": "off", "placeholder": "Provider default" }),
          this.createElement("label", { "for": "provider-api-key", textContent: "API KEY" }),
          this.createElement("input", { "id": "provider-api-key", "type": "password", "autocomplete": "off", "placeholder": "Not required for local providers" })
        ] }),
        this.createElement("footer", { "class": "settings-actions", children: [
          this.createElement("span", { "class": "provider-model-status", "id": "provider-model-status", textContent: "USING SAVED MODEL LIST" }),
          this.createElement("button", { "id": "refresh-provider-models", "type": "button", textContent: "REFRESH MODELS" }),
          this.createElement("button", { "id": "reset-provider", "type": "button", textContent: "RESET CHANGES" }),
          this.createElement("button", { "class": "primary", "id": "save-provider", "type": "submit", textContent: "SAVE PROVIDER" })
        ] })
      ] }),
      this.createElement("div", { "class": "settings-view admin-settings panel-body", "data-settings-view": "admin", "hidden": "", children: [
        this.createElement("div", { "class": "settings-section-intro", children: [
          this.createElement("strong", { textContent: "SYSTEM ADMINISTRATION" }),
          this.createElement("span", { textContent: "Manage destructive, system-wide actions." })
        ] }),
        this.createElement("section", { "class": "danger-zone", "aria-labelledby": "factory-reset-title", children: [
          this.createElement("div", { "class": "danger-zone-copy", children: [
            this.createElement("span", { "class": "danger-zone-icon", "aria-hidden": "true", textContent: "!" }),
            this.createElement("div", { children: [
              this.createElement("strong", { "id": "factory-reset-title", textContent: "FACTORY RESET" }),
              this.createElement("p", { textContent: "Erase all office data and delivered files, then restore the database and settings to their original state. Source code and configured coding workspaces are not removed." })
            ] })
          ] }),
          this.createElement("button", { "class": "danger-button", "id": "factory-reset-button", "type": "button", textContent: "FACTORY RESET" })
        ] })
      ] })
    ]);
  }

  initialize() {
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);
    const $$ = (selector, root = this) => [...root.querySelectorAll(selector)];
    const showToast = (message, error = false) => this.emit("office-notify", { message, error });
    const addLog = (source, text, tone = "") => this.emit("office-log", { source, text, tone });
    const TOOL_DETAILS = {
      manage_office_tasks: ["Office tasks", "Read, create, and explicitly assign queued work."],
      read_office_memory: ["Office memory", "Read durable task and operation history."],
      list_files: ["List files", "Inspect workspace directory contents."],
      read_file: ["Read files", "Read files from the configured workspace."],
      write_file: ["Write files", "Create and update workspace files."],
      search_files: ["Search files", "Search workspace content and paths."],
      curl: ["HTTP requests", "Call external HTTP endpoints."],
      run_command: ["Run commands", "Execute approved workspace commands."],
      chrome_devtools: ["Chrome DevTools", "Inspect and validate browser-rendered output."],
      delegate_to_sub_agent: ["Delegate to agent", "Send independent work to registered agents."],
    };
    const refreshOrchestratorConnection = () => this.emit("configuration-change");
    function currentSystemPrompt() {
      return state.systemPrompts.find((prompt) => prompt.key === state.selectedPromptKey) || null;
    }

    function renderSettingsStatus() {
      const status = $("#settings-status");
      if (!status) return;
      if (state.settingsTab === "appearance") {
        status.textContent = "OFFICE THEME";
      } else if (state.settingsTab === "tools") {
        const enabled = Object.values(state.toolPermissions).filter(Boolean).length;
        status.textContent = `${enabled} TOOLS ENABLED`;
      } else if (state.settingsTab === "mcp") {
        status.textContent = state.mcpDirty ? "UNSAVED CHANGES" : "SAVED";
      } else if (state.settingsTab === "provider") {
        status.textContent = state.providerDirty ? "UNSAVED CHANGES" : "SAVED";
      } else if (state.settingsTab === "admin") {
        status.textContent = "DANGER ZONE";
      } else {
        status.textContent = state.promptDirty ? "UNSAVED CHANGES" : currentSystemPrompt() ? "SAVED" : "SELECT A PROMPT";
      }
    }

    function selectSettingsTab(tab) {
      if (!['appearance', 'prompts', 'tools', 'mcp', 'provider', 'admin'].includes(tab)) return;
      if (state.userRole !== 'admin') tab = 'appearance';
      state.settingsTab = tab;
      $$('[data-settings-tab]').forEach((button) => {
        button.hidden = state.userRole !== 'admin' && button.dataset.settingsTab !== 'appearance';
        const active = button.dataset.settingsTab === tab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
      $$('[data-settings-view]').forEach((view) => { view.hidden = view.dataset.settingsView !== tab; });
      renderSettingsStatus();
    }

    function renderToolPermissions() {
      const container = $("#tool-permissions");
      if (!container) return;
      container.innerHTML = Object.entries(state.toolPermissions).map(([name, enabled]) => {
        const [label, description] = TOOL_DETAILS[name] || [name.replaceAll('_', ' '), 'Internal office manager tool.'];
        return `<label class="tool-permission"><input type="checkbox" data-tool-permission="${escapeHtml(name)}" ${enabled ? 'checked' : ''}><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(description)}</small></span></label>`;
      }).join('') || `<div class="office-empty"><strong>NO TOOLS AVAILABLE</strong></div>`;
      renderSettingsStatus();
    }

    function providerFormValue() {
      return {
        provider: $("#provider-type").value,
        model: $("#provider-model").value.trim(),
        baseUrl: $("#provider-base-url").value.trim(),
        apiKey: $("#provider-api-key").value.trim(),
      };
    }

    function setProviderModelOptions(models = [], selected = "") {
      const select = $("#provider-model");
      const values = [...new Set(models.map((model) => String(model).trim()).filter(Boolean))];
      if (selected && !values.includes(selected)) values.unshift(selected);
      select.innerHTML = values.length
        ? values.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join("")
        : `<option value="">REFRESH MODELS TO SELECT</option>`;
      select.value = selected && values.includes(selected) ? selected : values[0] || "";
    }

    function populateProviderForm() {
      $("#provider-type").value = state.providerSettings.provider || "openai";
      setProviderModelOptions([], state.providerSettings.model || "");
      $("#provider-base-url").value = state.providerSettings.baseUrl || "";
      $("#provider-api-key").value = state.providerSettings.apiKey || "";
      $("#provider-model-status").textContent = state.providerSettings.model ? "SAVED MODEL SELECTED" : "REFRESH MODELS TO BEGIN";
      state.providerDirty = false;
      renderSettingsStatus();
    }

    async function refreshProviderModels() {
      const button = $("#refresh-provider-models");
      const status = $("#provider-model-status");
      const settings = providerFormValue();
      button.disabled = true;
      status.textContent = "LOADING MODELS…";
      try {
        const response = await fetch("/api/models", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(settings),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        if (!data.models?.length) throw new Error("The provider returned no models.");
        setProviderModelOptions(data.models, settings.model);
        state.providerDirty = JSON.stringify(providerFormValue()) !== JSON.stringify(state.providerSettings);
        status.textContent = `${data.models.length} MODELS AVAILABLE`;
        showToast(`${data.models.length} models loaded.`);
      } catch (error) {
        status.textContent = "MODEL REFRESH FAILED";
        showToast(error.message, true);
      } finally {
        button.disabled = false;
        renderSettingsStatus();
      }
    }

    function renderSystemPrompts() {
      const list = $("#prompt-list");
      if (!list) return;
      list.innerHTML = state.systemPrompts.length ? state.systemPrompts.map((prompt) => `
        <button type="button" data-prompt="${escapeHtml(prompt.key)}" class="${prompt.key === state.selectedPromptKey ? "active" : ""}">
          <strong>${escapeHtml(prompt.title)}</strong><small>${escapeHtml(prompt.key)}</small>
        </button>`).join("") : `<div class="office-empty"><strong>NO SYSTEM PROMPTS</strong></div>`;
      const prompt = currentSystemPrompt();
      $("#prompt-editor-title").textContent = prompt?.title || "Select a system prompt";
      $("#prompt-editor-key").textContent = prompt?.key || "—";
      $("#system-prompt-content").disabled = !prompt;
      $("#reset-system-prompt").disabled = !prompt || !state.promptDirty;
      $("#save-system-prompt").disabled = !prompt || !state.promptDirty;
      renderSettingsStatus();
    }

    function selectSystemPrompt(key, { force = false } = {}) {
      if (!force && state.promptDirty && !window.confirm("Discard unsaved system prompt changes?")) return;
      const prompt = state.systemPrompts.find((entry) => entry.key === key);
      if (!prompt) return;
      state.selectedPromptKey = prompt.key;
      state.promptDirty = false;
      $("#system-prompt-content").value = prompt.content;
      renderSystemPrompts();
    }

    async function loadSystemPrompts() {
      try {
        const data = await fetchJson("/api/system-prompts");
        state.systemPrompts = data.prompts || [];
        const selected = state.systemPrompts.some((prompt) => prompt.key === state.selectedPromptKey)
          ? state.selectedPromptKey
          : state.systemPrompts[0]?.key;
        if (selected) selectSystemPrompt(selected, { force: true });
        else renderSystemPrompts();
      } catch (error) {
        showToast(error.message, true);
      }
    }

    async function loadConfigurationSettings() {
      try {
        const [uiState, mcp] = await Promise.all([fetchJson("/api/ui-state"), fetchJson("/api/config")]);
        state.toolPermissions = uiState.state?.toolPermissions || {};
        state.providerSettings = { ...state.providerSettings, ...(uiState.state?.providerSettings || {}) };
        state.mcpConfig = mcp.content || "";
        state.mcpDirty = false;
        $("#mcp-config-content").value = state.mcpConfig;
        renderToolPermissions();
        populateProviderForm();
      } catch (error) {
        showToast(error.message, true);
      }
    }

    async function saveUiState(statePatch) {
      const response = await fetch("/api/ui-state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: statePatch }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    }

    async function saveSystemPrompt() {
      const prompt = currentSystemPrompt();
      if (!prompt) return;
      const content = $("#system-prompt-content").value;
      const response = await fetch("/api/system-prompts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: prompt.key, content }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      prompt.content = content;
      state.promptDirty = false;
      renderSystemPrompts();
    }
    $("#prompt-list").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-prompt]");
      if (button) selectSystemPrompt(button.dataset.prompt);
    });
    $("#system-prompt-content").addEventListener("input", () => {
      const prompt = currentSystemPrompt();
      state.promptDirty = Boolean(prompt && $("#system-prompt-content").value !== prompt.content);
      renderSystemPrompts();
    });
    $("#reset-system-prompt").addEventListener("click", () => {
      const prompt = currentSystemPrompt();
      if (!prompt) return;
      $("#system-prompt-content").value = prompt.content;
      state.promptDirty = false;
      renderSystemPrompts();
    });
    $("#save-system-prompt").addEventListener("click", async () => {
      const button = $("#save-system-prompt");
      button.disabled = true;
      try {
        await saveSystemPrompt();
        refreshOrchestratorConnection();
        addLog("System", `Saved system prompt ${state.selectedPromptKey}`, "success");
        showToast("System prompt saved.");
      } catch (error) {
        showToast(error.message, true);
        renderSystemPrompts();
      }
    });

    $(".settings-tabs").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-settings-tab]");
      if (button) this.emit('office-navigate', { href: `/settings/${button.dataset.settingsTab}` });
    });
    $("#tool-permissions").addEventListener("change", async (event) => {
      const checkbox = event.target.closest("input[data-tool-permission]");
      if (!checkbox) return;
      const name = checkbox.dataset.toolPermission;
      const previous = state.toolPermissions[name];
      state.toolPermissions[name] = checkbox.checked;
      checkbox.disabled = true;
      renderSettingsStatus();
      try {
        await saveUiState({ toolPermissions: state.toolPermissions });
        refreshOrchestratorConnection();
        addLog("Settings", `${TOOL_DETAILS[name]?.[0] || name} ${checkbox.checked ? "enabled" : "disabled"}`, "success");
        showToast(`Tool ${checkbox.checked ? "enabled" : "disabled"}.`);
      } catch (error) {
        state.toolPermissions[name] = previous;
        checkbox.checked = previous;
        showToast(error.message, true);
      } finally {
        checkbox.disabled = false;
        renderSettingsStatus();
      }
    });
    $("#mcp-config-content").addEventListener("mcp-change", () => {
      state.mcpDirty = true;
      renderSettingsStatus();
    });
    $("#reset-mcp-config").addEventListener("click", () => {
      $("#mcp-config-content").value = state.mcpConfig;
      state.mcpDirty = false;
      renderSettingsStatus();
    });
    $("#save-mcp-config").addEventListener("click", async () => {
      const button = $("#save-mcp-config");
      button.disabled = true;
      try {
        const content = $("#mcp-config-content").value.trim();
        if (content) JSON.parse(content);
        const response = await fetch("/api/config", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        state.mcpConfig = content;
        state.mcpDirty = false;
        refreshOrchestratorConnection();
        addLog("Settings", "MCP configuration saved", "success");
        showToast("MCP configuration saved.");
      } catch (error) {
        showToast(error instanceof SyntaxError ? `Invalid MCP JSON: ${error.message}` : error.message, true);
      } finally {
        button.disabled = false;
        renderSettingsStatus();
      }
    });
    $("#provider-form").addEventListener("input", (event) => {
      state.providerDirty = JSON.stringify(providerFormValue()) !== JSON.stringify(state.providerSettings);
      if (event.target.id !== "provider-model") $("#provider-model-status").textContent = "REFRESH MODELS TO UPDATE";
      renderSettingsStatus();
    });
    $("#refresh-provider-models").addEventListener("click", () => void refreshProviderModels());
    $("#reset-provider").addEventListener("click", populateProviderForm);
    $("#provider-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = $("#save-provider");
      const settings = providerFormValue();
      button.disabled = true;
      try {
        await saveUiState({ providerSettings: settings });
        state.providerSettings = settings;
        state.providerDirty = false;
        refreshOrchestratorConnection();
        addLog("Settings", `Provider saved · ${settings.provider}/${settings.model}`, "success");
        showToast("Provider settings saved.");
      } catch (error) {
        showToast(error.message, true);
      } finally {
        button.disabled = false;
        renderSettingsStatus();
      }
    });

    $("#factory-reset-button").addEventListener("click", async () => {
      const confirmed = window.confirm(
        "Factory reset will permanently erase office chats, tasks, memory, operations, skills, settings, worker credentials, and delivered workspace files. Continue?",
      );
      if (!confirmed) return;
      const button = $("#factory-reset-button");
      button.disabled = true;
      button.textContent = "RESETTING…";
      try {
        const response = await fetch("/api/factory-reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmation: "FACTORY RESET" }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("agent-office.") || key.startsWith("agent-worker.")) localStorage.removeItem(key);
        }
        window.location.assign("/central-office/dashboard");
      } catch (error) {
        showToast(error.message, true);
        button.disabled = false;
        button.textContent = "FACTORY RESET";
      }
    });

    this.addEventListener('change', event => {
      if (event.target.matches('input[name="office-theme"]') && event.target.checked) this.emit('office-theme-select', { value: event.target.value });
    });
    this.onConnect = () => {
      const sync = () => $$('input[name="office-theme"]').forEach(input => { input.checked = input.value === document.documentElement.dataset.theme; });
      sync();
      window.addEventListener('office-theme-change', sync, { signal: this.connectionSignal });
      window.addEventListener('office-theme-saved', ({ detail }) => {
        $('#theme-save-status').textContent = detail.saved ? `${detail.label} theme saved.` : 'Theme applied for this visit. Browser storage is unavailable.';
      }, { signal: this.connectionSignal });
    };
    this.load = () => state.userRole === 'admin' ? Promise.all([loadSystemPrompts(), loadConfigurationSettings()]) : Promise.resolve();
    this.update = () => selectSettingsTab(state.settingsTab);
    this.selectTab = selectSettingsTab;
  }
}

customElements.define("office-settings", OfficeSettings);
export default OfficeSettings;
