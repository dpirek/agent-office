import { USER_AVATARS } from '../lib/user-avatars.mjs';
import OfficeComponent from "./office-component.mjs";
import { officeSprite } from "./office-format.mjs";

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
    const component = this;
    function renderOffice() {
      const floor = $("#agent-floor");
      const visibleAgents = officeAgents().filter(agent => agent.internal || agent.human || agent.status !== 'offline');
      floor.classList.toggle('is-crowded', visibleAgents.length > 8);
      floor.replaceChildren(...visibleAgents.map((agent, index) => {
        const selectionKey = agent.selectionKey || agent.name;
        const sprite = agent.human
          ? USER_AVATARS.find(choice => choice.id === agent.avatar && choice.src)?.id || 'developer'
          : officeSprite(agent, index);
        const portrait = component.createElement('img', { class: 'desk-sprite', src: `/assets/office/${sprite}.png`, alt: '', draggable: 'false' });
        return component.createElement('button', {
          class: `desk-agent ${agent.internal ? 'manager' : ''} ${agent.human ? 'human' : ''} ${['ready', 'running'].includes(agent.status) ? 'online' : ''} ${agent.status === 'running' ? 'active' : ''} ${selectionKey === state.selectedAgent ? 'selected' : ''}`,
          type: 'button', 'data-agent': agent.name, 'data-selection': selectionKey, 'aria-label': `Select ${agent.name}`,
          children: [portrait, component.createElement('span', { class: 'nameplate', children: [component.createElement('i'), document.createTextNode(agent.name)] })],
          addEventListener: { name: 'click', handler: () => component.emit('agent-select', { name: agent.name, selectionKey }) },
        });
      }));
    }

    const officeAgents = () => state.agents;
    this.update = renderOffice;
  }
  set meta(value) { this.querySelector("#office-meta").textContent = value; }
}

customElements.define("office-floor", OfficeFloor);
export default OfficeFloor;
