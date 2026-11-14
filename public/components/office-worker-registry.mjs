import OfficeComponent from './office-component.mjs';
import './office-add-member.mjs';
import { escapeHtml } from './office-format.mjs';

const icon = name => `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><use href="/assets/bootstrap-icons/bootstrap-icons.svg#${name}"></use></svg>`;

class OfficeWorkerRegistry extends OfficeComponent {
  static hostAttributes = { class: 'panel agent-registry-panel' };
  model = { workers: [], userRole: '', projectId: 'central-office' };

  render() {
    this.innerHTML = `
      <header class="panel-header">
        <div>${icon('people')}<h2>AGENT WORKERS</h2></div>
        <div class="panel-header-actions"><span class="worker-protocol-badge">A2A + WebSocket</span></div>
      </header>
      <div class="panel-body registry-body">
        <div class="worker-registry-toolbar" hidden>
          <span class="worker-registry-count"></span>
          <button class="header-action" type="button" data-connect-agent>+ Add agent</button>
        </div>
        <div class="worker-registry-empty">
          <span class="worker-empty-icon">${icon('people')}</span>
          <h3>No agents connected</h3>
          <p>Connect an agent to delegate tasks<br>and bring its skills to your office.</p>
          <button class="worker-connect-button" type="button" data-connect-agent>${icon('plus-lg')} Connect agent</button>
          <small>Use an Agent Card URL or a worker token</small>
        </div>
        <div class="worker-registry-table-wrap" hidden>
          <table class="registry-table"><thead><tr><th scope="col">Agent</th><th scope="col">Status</th><th scope="col">Transport</th><th scope="col">Skills</th></tr></thead><tbody></tbody></table>
        </div>
      </div>
      <office-add-member></office-add-member>`;
  }

  initialize() {
    const dialog = this.querySelector('office-add-member');
    for (const button of this.querySelectorAll('[data-connect-agent]')) {
      button.addEventListener('click', () => dialog.open('agent'));
    }
    this.update = () => {
      const workers = this.model.workers;
      const isAdmin = this.model.userRole === 'admin';
      dialog.data = { projectId: this.model.projectId, userRole: this.model.userRole };
      this.querySelector('.worker-registry-empty').hidden = workers.length > 0;
      this.querySelector('.worker-registry-toolbar').hidden = !workers.length;
      this.querySelector('.worker-registry-table-wrap').hidden = !workers.length;
      this.querySelector('.worker-registry-count').textContent = `${workers.length} ${workers.length === 1 ? 'agent' : 'agents'} registered`;
      for (const button of this.querySelectorAll('[data-connect-agent]')) button.hidden = !isAdmin;
      this.querySelector('.worker-registry-empty small').textContent = isAdmin ? 'Use an Agent Card URL or a worker token' : 'An administrator can connect agents to your office.';
      this.querySelector('tbody').innerHTML = workers.map(worker => {
        const skills = (worker.capabilities?.skills || []).map(skill => skill.name).filter(Boolean);
        return `<tr>
          <td><span class="worker-name">${escapeHtml(worker.name)}</span><small class="worker-description">${escapeHtml(worker.description || (worker.protocol === 'websocket' ? 'Office WebSocket worker' : 'A2A agent'))}</small></td>
          <td><span class="registry-status ${worker.status === 'connected' ? 'connected' : 'offline'}">${worker.status === 'connected' ? (worker.protocol === 'websocket' ? 'Connected' : 'Registered') : 'Offline'}</span></td>
          <td><span class="worker-transport">${escapeHtml(worker.binding || 'A2A')}</span></td>
          <td><span class="worker-skills" title="${escapeHtml(skills.join(', '))}">${escapeHtml(skills.slice(0, 3).join(', ') || '—')}${skills.length > 3 ? ` +${skills.length - 3}` : ''}</span></td>
        </tr>`;
      }).join('');
    };
    this.onDisconnect = () => dialog.deactivate();
  }
}
customElements.define('office-worker-registry', OfficeWorkerRegistry);
export default OfficeWorkerRegistry;
