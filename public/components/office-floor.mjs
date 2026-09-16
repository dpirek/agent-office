import OfficeComponent from "./office-component.mjs";
import { escapeHtml, officeSprite } from "./office-format.mjs";

class OfficeFloor extends OfficeComponent {
  static hostAttributes = {"class": "panel office-panel"};
  model = { agents: [], selectedAgent: "Office Manager" };

  render() {
    this.appendChildren(this, [
      this.createElement("header", { "class": "panel-header", children: [
        this.createElement("div", { children: [
          this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#building" })
          ] }),
          this.createElement("h2", { textContent: "AGENT OFFICE" })
        ] }),
        this.createElement("span", { "class": "panel-meta", "id": "office-meta", textContent: "LIVE FLOOR" })
      ] }),
      this.createElement("div", { "class": "office panel-body", "id": "agent-office", children: [
        this.createElement("div", { "class": "agent-floor", "id": "agent-floor" })
      ] })
    ]);
  }

  initialize() {
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);
    const $$ = (selector, root = this) => [...root.querySelectorAll(selector)];
    const component = this;
    function renderOffice() {
      const floor = $("#agent-floor");
      const visibleAgents = officeAgents()
        .map((agent, index) => ({ agent, index }))
        .filter(({ agent }) => agent.status !== "offline")
        .slice(0, 8);
      floor.innerHTML = visibleAgents.length ? visibleAgents.map(({ agent, index }) => `
        <button class="desk-agent ${agent.internal ? "manager" : ""} ${["ready", "running"].includes(agent.status) ? "online" : ""} ${agent.status === "running" ? "active" : ""} ${agent.name === state.selectedAgent ? "selected" : ""}" data-agent="${escapeHtml(agent.name)}" aria-label="Select ${escapeHtml(agent.name)}">
          <img class="desk-sprite" src="/assets/office/${officeSprite(agent, index)}.png" alt="" draggable="false">
          <span class="nameplate"><i></i>${escapeHtml(agent.name)}</span>
        </button>`).join("") : `<div class="office-empty"><strong>NO AGENTS ONLINE</strong><span>Waiting for an agent to connect.</span></div>`;
      $$(".desk-agent", floor).forEach((button) => button.addEventListener("click", () => {
        component.emit("agent-select", { name: button.dataset.agent });
      }));
    }

    const officeAgents = () => state.agents;
    this.update = renderOffice;
  }
  set meta(value) { this.querySelector("#office-meta").textContent = value; }
}

customElements.define("office-floor", OfficeFloor);
export default OfficeFloor;
