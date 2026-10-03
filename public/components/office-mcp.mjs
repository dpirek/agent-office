import OfficeComponent from './office-component.mjs';
import './office-mcp-settings.mjs';
import { fetchJson } from './office-format.mjs';

class OfficeMcp extends OfficeComponent {
  model = {};
  render() {
    const el = (tag, props) => this.createElement(tag, props);
    this.append(
      el('header', { class: 'panel-header', children: [el('h2', { textContent: 'MCP' }), el('span', { class: 'panel-meta', id: 'project-mcp-status', role: 'status' })] }),
      el('div', { class: 'editor-settings panel-body', children: [
        el('div', { class: 'settings-section-intro', children: [el('strong', { id: 'project-mcp-title' }), el('span', { textContent: 'Connect MCP servers for this project. Test a connection to discover available methods.' })] }),
        el('office-mcp-settings'),
        el('footer', { class: 'settings-actions', children: [el('button', { type: 'button', id: 'project-mcp-reset', textContent: 'RESET CHANGES' }), el('button', { type: 'button', class: 'primary', id: 'project-mcp-save', textContent: 'SAVE MCP' })] }),
      ] }),
    );
  }
  initialize() {
    this.editor = this.querySelector('office-mcp-settings');
    this.status = this.querySelector('#project-mcp-status');
    this.save = this.querySelector('#project-mcp-save');
    this.reset = this.querySelector('#project-mcp-reset');
    this.editor.addEventListener('mcp-change', () => { this.status.textContent = 'UNSAVED CHANGES'; });
    this.reset.addEventListener('click', () => { this.editor.value = this.content; this.status.textContent = 'SAVED'; });
    this.save.addEventListener('click', async () => {
      const projectId = this.loadedProject;
      const revision = this.revision;
      this.save.disabled = true;
      try {
        const content = this.editor.value;
        const response = await fetch(`/api/config?projectId=${encodeURIComponent(projectId)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (revision !== this.revision) return;
        this.content = content;
        this.status.textContent = 'SAVED';
        this.emit('configuration-change');
        this.emit('office-notify', { message: 'Project MCP configuration saved.' });
      } catch (error) {
        if (revision === this.revision) this.emit('office-notify', { message: error.message, error: true });
      } finally { if (revision === this.revision) this.save.disabled = false; }
    });
  }
  update() {
    this.querySelector('#project-mcp-title').textContent = this.model.projectName || 'Project MCP';
    if (this.model.userRole !== 'admin' || !this.model.projectId || this.loadedProject === this.projectId) return;
    void this.load();
  }
  async load() {
    const projectId = this.projectId;
    this.loadedProject = projectId;
    const revision = this.revision = (this.revision || 0) + 1;
    this.content = '';
    this.editor.value = '';
    this.editor.inert = true;
    this.save.disabled = this.reset.disabled = true;
    this.status.textContent = 'LOADING…';
    try {
      const data = await fetchJson(`/api/config?projectId=${encodeURIComponent(projectId)}`);
      if (revision !== this.revision) return;
      this.content = data.content || '';
      this.editor.value = this.content;
      this.editor.inert = false;
      this.save.disabled = this.reset.disabled = false;
      this.status.textContent = 'SAVED';
    } catch (error) {
      if (revision !== this.revision) return;
      this.loadedProject = null;
      this.status.textContent = error.message;
    }
  }
}
customElements.define('office-mcp', OfficeMcp);
export default OfficeMcp;
