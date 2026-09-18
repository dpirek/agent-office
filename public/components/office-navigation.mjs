import OfficeComponent from "./office-component.mjs";
import { projectPagePath, PROJECT_PAGES } from "../lib/project-routes.mjs";

class OfficeNavigation extends OfficeComponent {
  static hostAttributes = {"class": "sidebar", "role": "navigation", "id": "primary-navigation", "aria-label": "Primary navigation"};
  model = { projects: [], projectId: "central-office", page: "dashboard", online: false, context: "v… · Workspace …" };

  render() {
    this.appendChildren(this, [
      this.createElement("div", { "class": "sidebar-topbar", children: [
        this.createElement("a", { "class": "sidebar-logo", "href": "/central-office/dashboard", "aria-label": "Office home", children: [
          this.createElement("img", { "src": "/assets/kojomiki-icon.svg", "alt": "", "width": "30", "height": "30" })
        ] }),
        this.createElement("button", { "class": "sidebar-toggle", "id": "sidebar-toggle", "type": "button", "aria-controls": "primary-navigation", "aria-expanded": "true", "aria-label": "Collapse navigation", "title": "Collapse navigation", children: [
          this.createElement("svg", { "class": "sidebar-toggle-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#layout-sidebar-inset" })
          ] }),
          this.createElement("img", { "class": "sidebar-toggle-logo", "src": "/assets/kojomiki-icon.svg", "alt": "", "width": "28", "height": "28" }),
          this.createElement("span", { "class": "nav-label", textContent: "COLLAPSE" })
        ] })
      ] }),
      this.createElement("header", { "class": "sidebar-brand", children: [
        this.createElement("div", { "class": "sidebar-brand-row", children: [
          this.createElement("h1", { textContent: "Kojomiki" }),
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
          this.createElement('label', { class: 'project-visibility', children: [
            this.createElement('input', { id: 'project-public', type: 'checkbox' }),
            this.createElement('span', { textContent: 'Public project' }),
          ] }),
          this.createElement('p', { id: 'project-visibility-description', textContent: 'Private by default. Choose who can join below.' }),
          this.createElement('section', { id: 'project-private-options', children: [
            this.createElement('fieldset', { class: 'project-member-picker', children: [
              this.createElement('legend', { textContent: 'Add registered members' }),
              this.createElement('div', { id: 'project-member-options' }),
            ] }),
            this.createElement('label', { for: 'project-invite-emails', textContent: 'Invite by email' }),
            this.createElement('textarea', { id: 'project-invite-emails', rows: '2', maxlength: '12000', placeholder: 'alex@example.com, sam@example.com', 'aria-describedby': 'project-invite-help' }),
            this.createElement('p', { id: 'project-invite-help', textContent: 'Separate addresses with commas or new lines. Invitation links will appear after you create the project.' }),
          ] }),
          this.createElement("div", { children: [
            this.createElement("button", { "type": "button", "id": "cancel-project-button", textContent: "Cancel" }),
            this.createElement("button", { "type": "submit", textContent: "Save project" })
          ] })
        ] }),
        this.createElement('section', { id: 'project-invitations', hidden: '' }),
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
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      this.emit('office-navigate', { href: link.getAttribute('href') });
    });
    $('#project-select').addEventListener('change', event => this.emit('project-select', { id: event.target.value }));
    const dialog = $('#project-dialog');
    let creating = false;
    const syncVisibility = () => {
      $('#project-private-options').hidden = $('#project-public').checked;
      $('#project-visibility-description').textContent = $('#project-public').checked
        ? 'Public: visible to all office members.'
        : 'Private: invited members and users granted access by an administrator.';
    };
    $('#project-public').addEventListener('change', syncVisibility);
    dialog.addEventListener('cancel', event => { if (creating) event.preventDefault(); });
    this.openProjectDialog = ({ onboarding = false } = {}) => {
      if (creating) return;
      $('#project-dialog-title').textContent = onboarding ? 'Create your first project' : 'New project';
      $('#project-form').hidden = false;
      $('#project-invitations').hidden = true;
      $('#project-invitations').replaceChildren();
      $('#project-form').reset(); dialog.showModal(); $('#project-name').focus();
      syncVisibility();
      $('#project-member-options').textContent = 'Loading members…';
      fetch('/api/project-members', { cache: 'no-store' }).then(async response => {
        if (!response.ok) throw new Error('Could not load members. You can still invite by email.');
        const { users } = await response.json();
        $('#project-member-options').replaceChildren(...users.map(user => this.createElement('label', { children: [
          this.createElement('input', { type: 'checkbox', name: 'project-member', value: user.id }),
          this.createElement('span', { textContent: `${user.name} · ${user.email}` }),
        ] })));
        if (!users.length) $('#project-member-options').textContent = 'No other registered members yet.';
      }).catch(error => { $('#project-member-options').textContent = error.message; });
    };
    $('#new-project-button').addEventListener('click', () => this.openProjectDialog());
    $('#cancel-project-button').addEventListener('click', () => dialog.close());
    $('#project-form').addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.submitter;
      if (creating) return;
      creating = true;
      $('#cancel-project-button').disabled = true;
      if (button) button.disabled = true;
      try {
        const isPublic = $('#project-public').checked;
        const result = await this.request('project-create', {
          name: $('#project-name').value, description: $('#project-summary').value, isPublic,
          memberIds: isPublic ? [] : $$('input[name="project-member"]:checked').map(input => input.value),
          inviteEmails: isPublic ? [] : $('#project-invite-emails').value.split(/[\s,;]+/).filter(Boolean),
        });
        if (result.invitations?.length) {
          $('#project-form').hidden = true;
          const links = $('#project-invitations'); links.hidden = false;
          links.replaceChildren(this.createElement('h2', { textContent: 'Project created' }), this.createElement('p', { textContent: 'Share these invitation links. Each works once for the specified email and expires in 7 days.' }));
          for (const invitation of result.invitations) {
            const url = new URL(invitation.path, location.origin).href;
            const input = this.createElement('input', { type: 'text', readonly: '', value: url, 'aria-label': `Invitation link for ${invitation.email}` });
            const copy = this.createElement('button', { type: 'button', textContent: 'Copy link', addEventListener: { name: 'click', handler: async () => {
              try { await navigator.clipboard.writeText(url); copy.textContent = 'Copied'; }
              catch { input.focus(); input.select(); }
            } } });
            links.append(this.createElement('label', { textContent: invitation.email }), input, copy);
          }
          const done = this.createElement('button', { type: 'button', textContent: 'Done', addEventListener: { name: 'click', handler: () => dialog.close() } });
          links.append(done); done.focus();
        } else dialog.close();
      } catch (error) { showToast(error.message, true); }
      finally { creating = false; $('#cancel-project-button').disabled = false; if (button) button.disabled = false; }
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
        link.hidden = (link.dataset.section === 'knowledge' && state.userRole !== 'admin') || (PROJECT_PAGES.has(link.dataset.section) && !state.projects.length);
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
