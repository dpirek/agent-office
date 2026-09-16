import { renderUserAvatar } from '../lib/user-avatars.mjs';
import OfficeComponent from "./office-component.mjs";
import { escapeHtml, clock, officeSprite } from "./office-format.mjs";

class OfficeSelectedAgent extends OfficeComponent {
  static hostAttributes = {"class": "panel selected-panel"};
  model = { agent: null, agents: [], tasks: [], activeTab: "details", activity: [], health: null, orchestrator: null };

  render() {
    this.appendChildren(this, [
      this.createElement("header", { "class": "panel-header", children: [
        this.createElement("div", { children: [
          this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#robot" })
          ] }),
          this.createElement("h2", { textContent: "SELECTED AGENT" })
        ] })
      ] }),
      this.createElement("div", { "class": "panel-body selected-body", children: [
        this.createElement("div", { "class": "agent-summary", children: [
          this.createElement("div", { "class": "portrait", "id": "selected-portrait", children: [
            this.createElement("span", { textContent: "◉" })
          ] }),
          this.createElement("div", { "class": "agent-summary-copy", children: [
            this.createElement("strong", { "id": "selected-name", textContent: "No agent selected" }),
            this.createElement("span", { children: [
              this.createElement("i", { "class": "status-dot empty" }),
              this.createElement("b", { "id": "selected-status", textContent: "unregistered" })
            ] }),
            this.createElement("small", { "id": "selected-description", textContent: "Waiting for a WebSocket worker to connect" })
          ] })
        ] }),
        this.createElement("div", { "class": "tabs", "role": "tablist", "aria-label": "Selected agent information", children: [
          this.createElement("button", { "class": "active", "type": "button", "role": "tab", "aria-selected": "true", "data-tab": "details", textContent: "DETAILS" }),
          this.createElement("button", { "type": "button", "role": "tab", "aria-selected": "false", "data-tab": "tasks", textContent: "TASKS" }),
          this.createElement("button", { "type": "button", "role": "tab", "aria-selected": "false", "data-tab": "capabilities", textContent: "CAPABILITIES" }),
          this.createElement("button", { "type": "button", "role": "tab", "aria-selected": "false", "data-tab": "memory", textContent: "MEMORY" }),
          this.createElement("button", { "type": "button", "role": "tab", "aria-selected": "false", "data-tab": "logs", textContent: "LOGS" })
        ] }),
        this.createElement("div", { "class": "detail-table", "id": "agent-details" })
      ] })
    ]);
  }

  initialize() {
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);
    const $$ = (selector, root = this) => [...root.querySelectorAll(selector)];
    function detailRows(agent) {
      if (agent.human) return [['NAME', agent.name], ['ROLE', 'Office member'], ['STATUS', agent.status === 'ready' ? 'Online' : agent.status]];
      const model = agent.model?.name || state.orchestrator?.model || state.health?.model || "not configured";
      const workspace = state.health?.workspace || "—";
      const tasks = allTasks().filter((task) => task.agent === agent.name);
      const runningTask = tasks.find((task) => task.status === "running");
      const currentTask = agent.internal && state.chatRunning ? "Handling office conversation" : runningTask?.title || "Standing by";
      const capabilities = agent.capabilities || {};
      const skills = (capabilities.skills || []).map((skill) => skill.name || skill.id).filter(Boolean);
      const capabilityTools = capabilities.tools?.length ? capabilities.tools : agent.tools.split(", ").filter(Boolean);
      const base = {
        details: [["ID", agent.id], ["ROLE", agent.role], ["MODEL", model], ["STATUS", agent.status], ["CURRENT TASK", currentTask], ["WORKSPACE", workspace], ["TOOLS", agent.tools], ["TASKS (SESSION)", String(tasks.length)], ["UPTIME", formatUptime()]],
        tasks: tasks.length ? tasks.slice(0, 9).map((task) => [task.status.toUpperCase(), task.title]) : [["QUEUE", "No tasks assigned in this session"]],
        capabilities: [
          ["SKILLS", skills.join(", ") || (agent.internal ? "Office orchestration" : "None reported")],
          ["TOOLS", capabilityTools.join(", ") || "None reported"],
          ["MCP", capabilities.mcp ? "Enabled" : "Not reported"],
          ["ARTIFACT DELIVERY", capabilities.workspaceArtifacts ? "Supported" : "Not reported"],
        ],
        memory: [["SESSION", (state.sessionId || "").slice(0, 12)], ["CONTEXT", `${tasks.length} task records`], ["PERSISTENCE", "Workspace state enabled"]],
        logs: state.activity.slice(-8).reverse().map((entry) => [clock(entry.at), entry.text]),
      };
      return base[state.activeTab] || base.details;
    }

    function renderSelectedAgent() {
      const agent = currentAgent();
      if (!agent) {
        $("#selected-name").textContent = "No agent selected";
        $("#selected-status").textContent = "unregistered";
        $("#selected-description").textContent = "Waiting for a WebSocket worker to connect";
        $("#selected-portrait").innerHTML = "<span>—</span>";
        $(".agent-summary-copy .status-dot").classList.add("empty");
        $("#agent-details").innerHTML = `<div class="detail-row"><label>STATUS</label><span>No registered agents</span></div>`;
        return;
      }
      $(".agent-summary-copy .status-dot").classList.remove("empty");
      $("#selected-name").textContent = agent.name;
      $("#selected-status").textContent = agent.status;
      $("#selected-description").textContent = agent.description;
      if (agent.human) renderUserAvatar($("#selected-portrait"), agent);
      else $("#selected-portrait").innerHTML = `<img src="/assets/avatars/${officeSprite(agent, officeAgents().indexOf(agent))}.png" alt="" draggable="false">`;
      $("#agent-details").innerHTML = detailRows(agent).map(([key, value]) => `<div class="detail-row"><label>${escapeHtml(key)}</label><span class="${key === "STATUS" && ["ready", "running"].includes(value) ? "green" : ""}">${escapeHtml(value)}</span></div>`).join("");
    }

    const currentAgent = () => state.agent;
    const officeAgents = () => state.agents;
    const allTasks = () => state.tasks;
    const formatUptime = () => state.uptime || "00:00:00";
    $('.tabs').addEventListener('click', event => {
      const button = event.target.closest('[data-tab]');
      if (button) this.activeTab = button.dataset.tab;
    });
    this.update = () => {
      $$('.tabs button').forEach(button => {
        const active = button.dataset.tab === this.activeTab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
      state.activeTab = this.activeTab;
      renderSelectedAgent();
    };
  }

  static observedAttributes = [...super.observedAttributes, "active-tab"];
  get activeTab() { return this.getAttribute("active-tab") || "details"; }
  set activeTab(value) {
    if (["details", "tasks", "capabilities", "memory", "logs"].includes(value)) this.setAttribute("active-tab", value);
  }
  attributeChangedCallback(name, previous, value) {
    super.attributeChangedCallback(name, previous, value);
    if (name === "active-tab" && previous !== value) this.update?.();
  }
}

customElements.define("office-selected-agent", OfficeSelectedAgent);
export default OfficeSelectedAgent;
