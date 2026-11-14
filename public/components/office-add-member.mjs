import OfficeComponent from './office-component.mjs';

let nextMemberDialog = 0;

class OfficeAddMember extends OfficeComponent {
  idPrefix = `member-dialog-${++nextMemberDialog}-`;
  model = { projectId: 'central-office', userRole: '', workerTokenName: '' };

  render() {
    const el = (tag, props) => this.createElement(tag, props);
    const panel = (kind, title, label, inputProps, help) => el('form', {
      id: `add-member-${kind}`, role: 'tabpanel', 'aria-labelledby': `add-member-tab-${kind}`,
      children: [el('div', { class: 'worker-token-body', children: [
        el('p', { textContent: help }),
        el('label', { for: `add-member-${kind}-input`, textContent: label }),
        el('input', { id: `add-member-${kind}-input`, required: '', ...inputProps }),
        el('div', { class: 'worker-token-secret', hidden: '', 'data-result': kind, children: [
          el('label', { for: `add-member-${kind}-result`, textContent: kind === 'person' ? 'Invitation link' : 'Connected agent' }),
          el('textarea', { id: `add-member-${kind}-result`, rows: '3', readonly: '', spellcheck: 'false' }),
          el('button', { type: 'button', 'data-copy': kind, textContent: kind === 'person' ? 'Copy invitation link' : 'Copy agent URL' })
        ] })
      ] }), el('footer', { class: 'dialog-actions', children: [el('button', { type: 'submit', class: 'primary', textContent: title })] })]
    });
    this.append(el('dialog', { class: 'agent-dialog worker-token-dialog add-member-dialog', 'aria-labelledby': 'add-member-title', children: [
      el('header', { class: 'panel-header', children: [
        el('h2', { id: 'add-member-title', textContent: 'Add member' }),
        el('button', { type: 'button', class: 'dialog-close', 'aria-label': 'Close', textContent: '×', 'data-close': '' })
      ] }),
      el('div', { class: 'add-member-tabs', role: 'tablist', 'aria-label': 'Member type', children: ['person', 'agent'].map(kind => el('button', {
        type: 'button', role: 'tab', id: `add-member-tab-${kind}`, 'aria-controls': `add-member-${kind}`, 'data-tab': kind, textContent: `Add ${kind}`
      })) }),
      panel('person', 'Generate invitation link', 'Email address', { type: 'email', maxlength: '254', autocomplete: 'email' }, 'Create a link to join this project. Share it with this person; links expire after 7 days.'),
      panel('agent', 'Connect agent', 'A2A agent URL', { type: 'url', maxlength: '2048', autocomplete: 'off', placeholder: 'https://agent.example.com' }, 'Connect an A2A v1.0 agent using its base URL or Agent Card JSON URL. Office supports JSON-RPC and HTTP+JSON.'),
      el('p', { class: 'add-member-status', role: 'status' })
    ] }));
    // Multiple panels can host this dialog without duplicate label/ARIA targets.
    for (const element of this.querySelectorAll('[id]')) element.id = this.idPrefix + element.id;
    for (const attribute of ['for', 'aria-labelledby', 'aria-controls']) {
      for (const element of this.querySelectorAll(`[${attribute}]`)) {
        element.setAttribute(attribute, element.getAttribute(attribute).split(' ').map(id => this.idPrefix + id).join(' '));
      }
    }
  }

  initialize() {
    const agentBody = this.querySelector(`#${this.idPrefix}add-member-agent .worker-token-body`);
    agentBody.append(this.createElement('label', { for: this.idPrefix + 'add-agent-bearer', textContent: 'Bearer token (optional)' }), this.createElement('input', { id: this.idPrefix + 'add-agent-bearer', type: 'password', autocomplete: 'off' }));
    const dialog = this.querySelector('dialog');
    const $ = selector => this.querySelector(selector.replace(/#([\w-]+)/g, (_, id) => '#' + this.idPrefix + id));
    let revision = 0;
    let context = '';
    const status = message => { $('.add-member-status').textContent = message; };
    const choose = kind => {
      for (const tab of this.querySelectorAll('[data-tab]')) {
        const selected = tab.dataset.tab === kind;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        $(`#add-member-${tab.dataset.tab}`).hidden = !selected;
      }
      status(kind === 'agent' && this.model.userRole !== 'admin' ? 'An administrator must connect agents.' : '');
    };
    const clear = () => {
      revision++;
      for (const form of this.querySelectorAll('form')) {
        form.reset();
        form.querySelector('textarea').value = '';
        form.querySelector('[data-result]').hidden = true;
        form.querySelector('button[type="submit"]').disabled = false;
        form.querySelector('button[type="submit"]').hidden = false;
      }
      status('');
    };
    this.open = (kind = 'person') => {
      clear();
      context = `${this.model.projectId}:${this.model.userRole}`;
      $('#add-member-agent-input').value = '';
      $('#add-member-agent-input').disabled = this.model.userRole !== 'admin';
      $('#add-member-agent button[type="submit"]').disabled = this.model.userRole !== 'admin';
      choose(kind === 'agent' ? 'agent' : 'person');
      dialog.showModal();
      $(kind === 'agent' ? '#add-member-agent-input' : '#add-member-person-input').focus();
    };
    $('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', clear);
    for (const tab of this.querySelectorAll('[data-tab]')) {
      tab.addEventListener('click', () => choose(tab.dataset.tab));
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const kind = event.key === 'Home' ? 'person' : event.key === 'End' ? 'agent' : tab.dataset.tab === 'person' ? 'agent' : 'person';
        choose(kind); $(`[data-tab="${kind}"]`).focus();
      });
    }
    for (const kind of ['person', 'agent']) {
      const form = $(`#add-member-${kind}`);
      const input = form.querySelector('input');
      const output = form.querySelector('textarea');
      const button = form.querySelector('button[type="submit"]');
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (kind === 'agent' && this.model.userRole !== 'admin') return;
        const value = input.value.trim();
        if (!value) { input.focus(); return; }
        const current = revision;
        button.disabled = true;
        status(kind === 'person' ? 'Generating…' : 'Discovering agent…');
        try {
          const response = await fetch(kind === 'person' ? '/api/project-invitations' : '/api/sub-agents', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(kind === 'person' ? { projectId: this.model.projectId, email: value } : { url: value, token: $('#add-agent-bearer').value })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
          if (kind === 'agent') this.emit('workers-change', {});
          if (current !== revision || !dialog.open) return;
          output.value = kind === 'person' ? new URL(data.invitation.path, location.origin).href : data.worker.url;
          form.querySelector('[data-result]').hidden = false;
          if (kind === 'agent') { button.hidden = true; input.disabled = true; }
          status(kind === 'person' ? `Share this link with ${data.invitation.email}. It has not been emailed automatically.` : 'Agent connected and available for assignments.');
          output.focus(); output.select();
        } catch (error) {
          if (current === revision && dialog.open) status(error.message);
        } finally {
          if (current === revision) button.disabled = false;
        }
      });
      form.querySelector('[data-copy]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(output.value); }
        catch { output.select(); if (!document.execCommand('copy')) { status('Select and copy the value manually.'); return; } }
        status(kind === 'person' ? 'Invitation link copied.' : 'Agent URL copied.');
      });
    }
    this.update = () => { if (dialog.open && context !== `${this.model.projectId}:${this.model.userRole}`) { clear(); dialog.close(); } };
    this.onDisconnect = () => { clear(); dialog.close(); };
  }
}
customElements.define('office-add-member', OfficeAddMember);
export default OfficeAddMember;
