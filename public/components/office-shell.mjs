import OfficeComponent from "./office-component.mjs";
import { bindOfficeHeader } from "./office-header.mjs";
import "./office-navigation.mjs";
import "./office-topbar.mjs";
import "./office-search.mjs";
import "./office-floor.mjs";
import "./office-selected-agent.mjs";
import "./office-worker-registry.mjs";
import "./office-dashboard-chat.mjs";
import "./office-system-log.mjs";
import "./office-task-summary.mjs";
import "./office-manager-chat.mjs";
import "./office-task-queue.mjs";
import "./office-operations.mjs";
import "./office-workspace.mjs";
import "./office-chat.mjs";
import "./office-settings.mjs";
import "./office-knowledge.mjs";
import "./office-memory.mjs";
import "./office-toast.mjs";
import { initPanelMinimizing } from "../lib/panel-minimize.mjs";
import { initPanelResizing } from "../lib/panel-resize.mjs";

class OfficeShell extends OfficeComponent {
  model = {};
  render() {
    this.append(this.createElement("div", { "class": "app-frame", children: [
  this.createElement("office-topbar", { hidden: "" }),
  this.createElement("div", { "class": "workspace", children: [
    this.createElement("office-navigation", { "id": "primary-navigation", "class": "sidebar", "aria-label": "Primary navigation", "role": "navigation" }),
    this.createElement("div", { "class": "project-content", children: [
      this.createElement("div", { "class": "theme-banner", "aria-label": "Office theme welcome", children: [
        this.createElement("span", { "class": "theme-banner-eyebrow", textContent: "CENTRAL OFFICE" }),
        this.createElement("strong", { children: [
          this.createElement("span", { "class": "matrix-banner-title", textContent: "WELCOME TO THE OFFICE" }),
          this.createElement("span", { "class": "sakura-banner-title", "lang": "ja", textContent: "中央オフィス" })
        ] }),
        this.createElement("p", { textContent: "Coordinate. Collaborate. Build together with AI agents." })
      ] }),
      this.createElement("main", { "class": "main-content", children: [
        this.createElement("section", { "class": "operations-grid", children: [
          this.createElement("office-floor", { "class": "panel office-panel", "data-view": "dashboard" }),
          this.createElement("aside", { "class": "right-column", children: [
            this.createElement("office-selected-agent", { "class": "panel selected-panel", "data-view": "dashboard" }),
            this.createElement("office-worker-registry", { "class": "panel agent-registry-panel", "data-view": "dashboard" }),
            this.createElement("office-dashboard-chat", { "class": "panel dashboard-office-chat-panel", "data-view": "dashboard" }),
            this.createElement("office-system-log", { "class": "panel logs-panel", "data-view": "dashboard" })
          ] })
        ] }),
        this.createElement("div", { "class": "panel-width-resizer", "id": "main-panel-resizer", "role": "separator", "tabindex": "0", "aria-label": "Resize panel columns", "aria-orientation": "vertical", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "63", children: [
          this.createElement("span", { "aria-hidden": "true" })
        ] }),
        this.createElement("section", { "class": "bottom-grid", children: [
          this.createElement("office-task-summary", { "class": "panel dashboard-tasks-panel", "data-view": "dashboard" }),
          this.createElement("office-manager-chat", { "class": "panel chat-panel", "data-view": "dashboard" }),
          this.createElement("office-task-queue", { "class": "panel task-panel", "data-view": "tasks" })
        ] }),
        this.createElement("office-operations", { "class": "panel operations-panel", "data-view": "operations", "hidden": "" }),
        this.createElement("office-workspace", { "class": "panel shared-workspace-panel", "data-view": "workspace", "hidden": "" }),
        this.createElement("office-chat", { "class": "panel office-chat-page", "data-view": "chat", "hidden": "" }),
        this.createElement("office-settings", { "class": "panel settings-panel", "data-view": "settings", "hidden": "" }),
        this.createElement("office-knowledge", { "class": "panel knowledge-panel", "data-view": "knowledge", "hidden": "" }),
        this.createElement("office-memory", { "class": "panel memory-panel", "data-view": "memory", "hidden": "" }),
        this.createElement("office-search", { "data-view": "search", "hidden": "" })
      ] })
    ] })
  ] }),
  this.createElement("office-toast", { "class": "toast", "id": "toast", "role": "status" })
] }));
  }
  initialize() {
    this.syncHeader = bindOfficeHeader(this, () => ["dashboard", "search"].includes(this.page));
    this.onConnect = () => {
      this.syncHeader();
      window.addEventListener('office-theme-change', this.syncHeader, { signal: this.connectionSignal });
      initPanelMinimizing({ root: this, signal: this.connectionSignal, onChange: () => this.syncPanelLayout() });
      initPanelResizing({ container: this.querySelector('.main-content'), resizer: this.querySelector('#main-panel-resizer'), signal: this.connectionSignal });
    };
  }
  showPage(page) {
    this.page = page;
    this.syncHeader();
    this.querySelectorAll('[data-view]').forEach(panel => {
      const visible = panel.dataset.view.split(/\s+/).includes(page);
      if (!visible) panel.deactivate();
      panel.hidden = !visible;
    });
    const right = this.querySelector('.right-column');
    right.hidden = !right.querySelector(':scope > .panel:not([hidden])');
    this.querySelector('.operations-grid').hidden = this.querySelector('office-floor').hidden && right.hidden;
    this.querySelector('.bottom-grid').hidden = !this.querySelector('.bottom-grid > .panel:not([hidden])');
    this.syncPanelLayout();
  }
  syncPanelLayout() {
    const column = this.querySelector('.right-column');
    const panels = [...column.children].filter(panel => !panel.hidden);
    if (!panels.some(panel => panel.classList.contains('is-minimized'))) column.style.removeProperty('grid-template-rows');
    else column.style.gridTemplateRows = panels.map(panel => panel.classList.contains('is-minimized') ? '43px' : 'minmax(120px, 1fr)').join(' ');
  }
}
customElements.define('office-shell', OfficeShell);
