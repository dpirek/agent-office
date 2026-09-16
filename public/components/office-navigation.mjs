import OfficeComponent from "./office-component.mjs";
import { projectPagePath } from "../lib/project-routes.mjs";

class OfficeNavigation extends OfficeComponent {
  static hostAttributes = {"class": "sidebar", "role": "navigation", "id": "primary-navigation", "aria-label": "Primary navigation"};
  model = { projects: [], projectId: "central-office", page: "dashboard", online: false, context: "v… · Workspace …" };

  render() {
    this.appendChildren(this, [
      this.createElement("div", { "class": "sidebar-topbar", children: [
        this.createElement("a", { "class": "sidebar-logo", "href": "/central-office/dashboard", "aria-label": "Office home", children: [
          this.createElement("img", { "src": "/assets/logo.svg", "alt": "", "width": "30", "height": "30" })
        ] }),
        this.createElement("button", { "class": "sidebar-toggle", "id": "sidebar-toggle", "type": "button", "aria-controls": "primary-navigation", "aria-expanded": "true", "aria-label": "Collapse navigation", "title": "Collapse navigation", children: [
          this.createElement("svg", { "class": "sidebar-toggle-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#layout-sidebar-inset" })
          ] }),
          this.createElement("img", { "class": "sidebar-toggle-logo", "src": "/assets/logo.svg", "alt": "", "width": "28", "height": "28" }),
          this.createElement("span", { "class": "nav-label", textContent: "COLLAPSE" })
        ] })
      ] }),
      this.createElement("header", { "class": "sidebar-brand", children: [
        this.createElement("div", { "class": "sidebar-brand-row", children: [
          this.createElement("h1", { textContent: "Office" }),
          this.createElement("div", { "class": "sidebar-health", children: [
            this.createElement("span", { "class": "status-dot", "id": "health-dot" }),
            this.createElement("span", { "id": "health-text", textContent: "CONNECTING" })
          ] })
        ] }),
        this.createElement("p", { "class": "sidebar-mantra", children: [
          document.createTextNode("ORCHESTRATE"),
          this.createElement("br", {  }),
          document.createTextNode("MONITOR"),
          this.createElement("br", {  }),
          document.createTextNode("COLLABORATE")
        ] }),
        this.createElement("div", { "class": "project-context-header", children: [
          this.createElement("p", { "class": "workspace-context", "id": "header-context", textContent: "v… · Workspace …" }),
          this.createElement("div", { "class": "project-toolbar", "aria-label": "Project context", children: [
            this.createElement("select", { "id": "project-select", "aria-label": "Current project", children: [
              this.createElement("option", { "value": "central-office", textContent: "Central Office" })
            ] }),
            this.createElement("button", { "id": "new-project-button", "type": "button", "aria-label": "New project", "title": "New project", children: [
              this.createElement("svg", { "viewBox": "0 0 24 24", "width": "16", "height": "16", "fill": "none", "stroke": "currentColor", "stroke-width": "1.6", "aria-hidden": "true", children: [
                this.createElement("path", { "d": "M12 5v14M5 12h14" })
              ] })
            ] })
          ] })
        ] })
      ] }),
      this.createElement("div", { "class": "nav-items", children: [
        this.createElement("a", { "class": "nav-item active", "href": "/central-office/dashboard", "data-section": "dashboard", "aria-label": "Dashboard", "title": "Dashboard", children: [
          this.createElement("svg", { "class": "nav-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#grid-1x2" })
          ] }),
          this.createElement("span", { "class": "nav-label", textContent: "DASHBOARD" })
        ] }),
        this.createElement("a", { "class": "nav-item", "href": "/central-office/chat", "data-section": "chat", "aria-label": "Office chat", "title": "Office chat", children: [
          this.createElement("svg", { "class": "nav-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#chat-dots" })
          ] }),
          this.createElement("span", { "class": "nav-label", textContent: "CHAT" })
        ] }),
        this.createElement("a", { "class": "nav-item", "href": "/central-office/tasks", "data-section": "tasks", "aria-label": "Tasks", "title": "Tasks", children: [
          this.createElement("svg", { "class": "nav-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#clipboard-check" })
          ] }),
          this.createElement("span", { "class": "nav-label", textContent: "TASKS" })
        ] }),
        this.createElement("a", { "class": "nav-item", "href": "/central-office/workspace", "data-section": "workspace", "aria-label": "Workspace", "title": "Workspace", children: [
          this.createElement("svg", { "class": "nav-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#folder2-open" })
          ] }),
          this.createElement("span", { "class": "nav-label", textContent: "WORKSPACE" })
        ] }),
        this.createElement("a", { "class": "nav-item", "href": "/central-office/operations", "data-section": "operations", "aria-label": "Operations", "title": "Operations", children: [
          this.createElement("svg", { "class": "nav-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#calendar3" })
          ] }),
          this.createElement("span", { "class": "nav-label", textContent: "OPERATIONS" })
        ] }),
        this.createElement("a", { "class": "nav-item", "href": "/central-office/memory", "data-section": "memory", "aria-label": "Memory", "title": "Memory", children: [
          this.createElement("svg", { "class": "nav-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#database" })
          ] }),
          this.createElement("span", { "class": "nav-label", textContent: "MEMORY" })
        ] }),
        this.createElement("a", { "class": "nav-item", "href": "/knowledge", "data-section": "knowledge", "aria-label": "Knowledge", "title": "Knowledge", children: [
          this.createElement("svg", { "class": "nav-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#journal-code" })
          ] }),
          this.createElement("span", { "class": "nav-label", textContent: "KNOWLEDGE" })
        ] }),
        this.createElement("a", { "class": "nav-item", "href": "/settings", "data-section": "settings", "aria-label": "Settings", "title": "Settings", children: [
          this.createElement("svg", { "class": "nav-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#gear" })
          ] }),
          this.createElement("span", { "class": "nav-label", textContent: "SETTINGS" })
        ] }),
        this.createElement("a", { "class": "nav-item", "href": "/account", "data-section": "account", "aria-label": "Account and users", children: [
          this.createElement("svg", { "class": "nav-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#person-circle" })
          ] }),
          this.createElement("span", { "class": "nav-label", textContent: "ACCOUNT" })
        ] })
      ] }),
      this.createElement("dialog", { "id": "project-dialog", children: [
        this.createElement("form", { "id": "project-form", "class": "project-form", children: [
          this.createElement("h2", { "id": "project-dialog-title", textContent: "New project" }),
          this.createElement("label", { "for": "project-name", textContent: "Name" }),
          this.createElement("input", { "id": "project-name", "required": "", "maxlength": "100", "autocomplete": "off" }),
          this.createElement("label", { "for": "project-summary", textContent: "Description" }),
          this.createElement("textarea", { "id": "project-summary", "maxlength": "10000", "rows": "4" }),
          this.createElement("div", { children: [
            this.createElement("button", { "type": "button", "id": "cancel-project-button", textContent: "Cancel" }),
            this.createElement("button", { "type": "submit", textContent: "Save project" })
          ] })
        ] })
      ] })
    ]);
  }

  initialize() {
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);
    const $$ = (selector, root = this) => [...root.querySelectorAll(selector)];
    const showToast = (message, error = false) => this.emit("office-notify", { message, error });

    const toggle = $('#sidebar-toggle');
    const applyCollapsed = () => {
      const collapsed = this.collapsed;
      document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
      const label = collapsed ? 'Expand navigation' : 'Collapse navigation';
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', label);
      toggle.title = label;
      this.emit('sidebar-toggle', { collapsed });
    };
    this.applyCollapsed = applyCollapsed;
    try { this.collapsed = localStorage.getItem('office-sidebar-collapsed') === 'true'; } catch { applyCollapsed(); }
    this.toggle = () => {
      this.collapsed = !this.collapsed;
      try { localStorage.setItem('office-sidebar-collapsed', String(this.collapsed)); } catch { /* Keep local state. */ }
    };
    toggle.addEventListener('click', () => this.toggle());
    this.addEventListener('click', event => {
      const link = event.target.closest('.nav-item[data-section], .sidebar-logo');
      if (!link || link.dataset.section === 'account' || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      this.emit('office-navigate', { href: link.getAttribute('href') });
    });
    $('#project-select').addEventListener('change', event => this.emit('project-select', { id: event.target.value }));
    const dialog = $('#project-dialog');
    $('#new-project-button').addEventListener('click', () => {
      $('#project-form').reset(); dialog.showModal(); $('#project-name').focus();
    });
    $('#cancel-project-button').addEventListener('click', () => dialog.close());
    $('#project-form').addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.submitter;
      if (button) button.disabled = true;
      try {
        await this.request('project-create', { name: $('#project-name').value, description: $('#project-summary').value });
        dialog.close();
      } catch (error) { showToast(error.message, true); }
      finally { if (button) button.disabled = false; }
    });
    this.onConnect = () => {
      const syncLogo = () => {
        const logo = document.querySelector('link[rel="icon"]').getAttribute('href');
        $$('.sidebar-logo img, .sidebar-toggle-logo').forEach(image => { image.src = logo; });
      };
      syncLogo();
      window.addEventListener('office-theme-change', syncLogo, { signal: this.connectionSignal });
    };
    this.update = () => {
      $$('.nav-item[data-section]').forEach(link => {
        link.href = projectPagePath(link.dataset.section, state.projectId);
        const active = link.dataset.section === state.page;
        const changed = active && !link.classList.contains('active');
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        if (changed && matchMedia('(max-width: 1100px)').matches) queueMicrotask(() => link.scrollIntoView({ block: 'nearest', inline: 'center' }));
      });
      $('.sidebar-logo').href = projectPagePath('dashboard', state.projectId);
      $('#project-select').replaceChildren(...state.projects.map(project => this.createElement('option', { value: project.id, textContent: project.name })));
      $('#project-select').value = state.projectId;
      $('#health-dot').className = `status-dot ${state.online ? 'online' : 'offline'}`;
      $('#health-text').textContent = state.online ? 'ONLINE' : 'OFFLINE';
      $('#header-context').textContent = state.context;
    };
  }

  static observedAttributes = [...super.observedAttributes, "collapsed"];
  get collapsed() { return this.hasAttribute("collapsed"); }
  set collapsed(value) { this.toggleAttribute("collapsed", Boolean(value)); }
  attributeChangedCallback(name, previous, value) {
    super.attributeChangedCallback(name, previous, value);
    if (name === "collapsed") this.applyCollapsed?.();
  }
}

customElements.define("office-navigation", OfficeNavigation);
export default OfficeNavigation;
