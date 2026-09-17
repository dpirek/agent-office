import OfficeComponent from './office-component.mjs';

class OfficeObservability extends OfficeComponent {
  model = {};
  render() {
    const el = (tag, props) => this.createElement(tag, props);
    const field = (label, input) => el('label', { children: [el('span', { textContent: label }), input] });
    const input = (name, props = {}) => el('input', { name, autocomplete: 'off', ...props });
    this.append(el('dialog', { class: 'agent-dialog observability-dialog', 'aria-labelledby': 'observability-title', children: [
      el('header', { class: 'panel-header', children: [
        el('div', { children: [
          el('svg', { class: 'header-icon bi', width: '20', height: '20', viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false', children: [el('use', { href: '/assets/bootstrap-icons/bootstrap-icons.svg#activity' })] }),
          el('h2', { id: 'observability-title', textContent: 'Observability providers' }),
        ] }),
        el('button', { type: 'button', class: 'dialog-close', 'aria-label': 'Close observability providers', textContent: '×', 'data-close': '' }),
      ] }),
      el('div', { class: 'observability-body', children: [
        el('section', { class: 'observability-providers', 'aria-label': 'Connected providers' }),
        el('form', { class: 'observability-form', children: [
          el('h3', { textContent: 'Add provider' }),
          el('p', { class: 'observability-help', textContent: 'Send new System Logs from all projects to your provider. Logs include chat, agent, model, file, and MCP activity.' }),
          field('Provider', el('select', { name: 'type', children: [el('option', { value: 'loki', textContent: 'Grafana Loki' })] })),
          field('Name', input('name', { required: '', maxlength: '100', placeholder: 'Production logs' })),
          field('Loki URL', input('url', { type: 'url', required: '', placeholder: 'https://logs.example.com/loki/api/v1/push', spellcheck: 'false' })),
          el('p', { class: 'observability-help', textContent: 'Use your Loki ingest URL, not the Grafana dashboard URL. A base URL also works.' }),
          field('Authentication', el('select', { name: 'auth', children: [['none', 'None'], ['basic', 'Basic (Grafana Cloud)'], ['bearer', 'Bearer token']].map(([value, textContent]) => el('option', { value, textContent })) })),
          field('Username / instance ID', input('username', { maxlength: '200' })),
          field('Password / API token', input('secret', { type: 'password', maxlength: '4096', autocomplete: 'new-password' })),
          field('Tenant ID (optional)', input('tenantId', { maxlength: '200', placeholder: 'X-Scope-OrgID' })),
          el('p', { class: 'observability-help', textContent: 'Test connection sends one test log. Adding a provider starts forwarding new logs; failed batches retry while logs remain in local retention (5,000 entries).' }),
          el('footer', { class: 'dialog-actions', children: [el('button', { type: 'button', 'data-test': '', textContent: 'Test connection' }), el('button', { type: 'submit', class: 'primary', textContent: 'Add provider' })] }),
        ] }),
        el('p', { class: 'observability-status', role: 'status', 'aria-live': 'polite' }),
      ] }),
    ] }));
  }
  initialize() {
    const dialog = this.querySelector('dialog');
    const form = this.querySelector('form');
    const status = this.querySelector('.observability-status');
    let revision = 0;
    let busy = false;
    const authFields = () => {
      for (const name of ['username', 'secret']) {
        const input = form.elements[name];
        const show = name === 'username' ? form.elements.auth.value === 'basic' : form.elements.auth.value !== 'none';
        input.closest('label').hidden = !show; input.disabled = !show; input.required = show;
      }
    };
    const api = async (path, method = 'GET', body) => {
      const response = await fetch(`/api/observability${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to update observability providers.');
      return data;
    };
    const refresh = async () => {
      const current = revision;
      const { providers } = await api('');
      if (current !== revision || !dialog.open) return;
      this.emit('observability-change', { enabled: providers.some(provider => provider.enabled) });
      const el = (tag, props) => this.createElement(tag, props);
      const list = this.querySelector('.observability-providers');
      list.replaceChildren(el('h3', { textContent: 'Connected providers' }));
      if (!providers.length) list.append(el('p', { class: 'observability-help', textContent: 'No providers connected yet.' }));
      for (const provider of providers) {
        const summary = !provider.enabled ? 'Paused' : provider.status.error || (provider.status.lastSentAt ? `Last delivered ${new Date(provider.status.lastSentAt).toLocaleString()}` : 'Waiting for new logs');
        const row = el('article', { class: 'observability-provider', children: [el('strong', { textContent: provider.name }), el('small', { textContent: provider.url }), el('p', { textContent: summary })] });
        for (const [label, method, body] of [[provider.enabled ? 'Pause' : 'Resume', 'PATCH', { id: provider.id, enabled: !provider.enabled }], ['Remove', 'DELETE', { id: provider.id }]]) {
          const button = el('button', { type: 'button', textContent: label });
          button.addEventListener('click', async () => {
            button.disabled = true;
            try { await api('', method, body); await refresh(); }
            catch (error) { status.textContent = error.message; button.disabled = false; }
          });
          row.append(button);
        }
        list.append(row);
      }
    };
    this.open = async () => {
      revision++; form.reset(); authFields(); status.textContent = '';
      if (!dialog.open) dialog.showModal();
      try { await refresh(); } catch (error) { status.textContent = error.message; }
    };
    dialog.addEventListener('close', () => { revision++; form.reset(); authFields(); });
    this.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    form.elements.auth.addEventListener('change', authFields);
    form.addEventListener('input', () => { revision++; status.textContent = ''; });
    const submit = async test => {
      if (busy || !form.reportValidity()) return;
      busy = true;
      const current = revision;
      const payload = Object.fromEntries(new FormData(form));
      const buttons = [...form.querySelectorAll('button')];
      buttons.forEach(button => { button.disabled = true; });
      status.textContent = test ? 'Sending test log…' : 'Adding provider…';
      try {
        const data = await api(test ? '/test' : '', 'POST', payload);
        if (current !== revision || !dialog.open) return;
        status.textContent = test ? data.message : 'Provider added. New logs will be forwarded automatically.';
        if (!test) { form.reset(); authFields(); await refresh(); }
      } catch (error) { if (current === revision && dialog.open) status.textContent = error.message; }
      finally { busy = false; buttons.forEach(button => { button.disabled = false; }); }
    };
    form.addEventListener('submit', event => { event.preventDefault(); void submit(false); });
    this.querySelector('[data-test]').addEventListener('click', () => { void submit(true); });
    authFields();
  }
}
customElements.define('office-observability', OfficeObservability);
