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
        this.createElement("span", { "class": "panel-meta", "id": "office-meta", textContent: "LIVE FLOOR" }),
        this.createElement("button", { type: "button", class: "project-settings-button", "aria-label": "Project settings", title: "Project settings", children: [
          this.createElement("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true", children: [this.createElement("use", { href: "/assets/bootstrap-icons/bootstrap-icons.svg#gear" })] })
        ] })
      ] }),
      this.createElement('section', { class: 'office-project-info', 'aria-label': 'Current project', children: [
        this.createElement('div', { class: 'office-project-heading', children: [this.createElement('strong', { id: 'office-project-name' }), this.createElement('span', { id: 'office-project-status' })] }),
        this.createElement('p', { id: 'office-project-description' }),
      ] }),
      this.createElement('dialog', { class: 'agent-dialog project-settings-dialog', 'aria-labelledby': 'project-settings-title', children: [
        this.createElement('header', { class: 'panel-header', children: [this.createElement('h2', { id: 'project-settings-title', textContent: 'PROJECT SETTINGS' }), this.createElement('button', { type: 'button', class: 'dialog-close', 'aria-label': 'Close project settings', textContent: '×' })] }),
        this.createElement('div', { class: 'project-settings-body', children: [
          this.createElement('strong', { id: 'project-settings-name' }),
          this.createElement('p', { textContent: 'Clear one section at a time. These actions permanently delete data from this project.' }),
          ...[
            ['chats', 'Chats', 'Delete all project messages and conversation threads.'],
            ['tasks', 'Tasks', 'Delete the project task queue and task history. Delivered files stay in the workspace.'],
            ['workspace', 'Workspace', 'Delete all files and folders in this project’s workspace.'],
            ['operations', 'Operations', 'Delete all scheduled operations for this project.'],
            ['memory', 'Memory', 'Delete all saved project memory records.'],
          ].map(([section, label, description]) => this.createElement('div', { class: 'project-clear-row', children: [
            this.createElement('div', { children: [this.createElement('strong', { textContent: label }), this.createElement('p', { textContent: description })] }),
            this.createElement('button', { type: 'button', class: 'danger-button', 'data-clear-section': section, textContent: `Clear ${label.toLowerCase()}` }),
          ] })),
          this.createElement('p', { id: 'project-clear-status', role: 'status', 'aria-live': 'polite' }),
        ] }),
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
    const dialog = $('.project-settings-dialog');
    let busy = false;
    let dialogProjectId;
    $('.project-settings-button').addEventListener('click', () => {
      if (!state.project || !state.canManageProject) return;
      dialogProjectId = state.project.id;
      $('#project-settings-name').textContent = state.project.name;
      $('#project-clear-status').textContent = '';
      dialog.showModal();
    });
    $('.dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', async event => {
      const button = event.target.closest('[data-clear-section]');
      if (!button || busy || !state.project || dialogProjectId !== state.project.id) return;
      const project = state.project;
      const section = button.dataset.clearSection;
      if (!window.confirm(`Clear ${section} for “${project.name}”? This permanently deletes this project's ${section} and cannot be undone.`)) return;
      busy = true;
      const buttons = [...dialog.querySelectorAll('[data-clear-section]')];
      buttons.forEach(button => { button.disabled = true; });
      $('#project-clear-status').textContent = `Clearing ${section}…`;
      try {
        await this.request('project-clear', { projectId: project.id, section });
        if (dialogProjectId === project.id) $('#project-clear-status').textContent = `${section[0].toUpperCase() + section.slice(1)} cleared.`;
        this.emit('office-notify', { message: `${project.name}: ${section} cleared.` });
      } catch (error) {
        if (dialogProjectId === project.id) $('#project-clear-status').textContent = error.message;
      } finally { busy = false; buttons.forEach(button => { button.disabled = false; }); }
    });
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
    this.update = () => {
      renderOffice();
      const project = state.project;
      $('#office-project-name').textContent = project?.name || 'No project selected';
      $('#office-project-status').textContent = project ? `${project.status} · ${project.isPublic ? 'Public' : 'Private'}` : '';
      $('#office-project-description').textContent = project?.description || 'No project description yet.';
      $('.project-settings-button').hidden = !project || !state.canManageProject;
      if (dialog.open && (dialogProjectId !== project?.id || !state.canManageProject)) dialog.close();
    };
  }
  set meta(value) { this.querySelector("#office-meta").textContent = value; }
}

customElements.define("office-floor", OfficeFloor);
export default OfficeFloor;
