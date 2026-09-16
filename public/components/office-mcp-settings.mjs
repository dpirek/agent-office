import OfficeComponent from './office-component.mjs';
import { readMcpForm, writeMcpForm, validateMcpServer } from '../lib/mcp-form.mjs';

class OfficeMcpSettings extends OfficeComponent {
  model = {};
  config = { mcp: { servers: [] } };
  servers = [];
  render() { this.draw(); }
  initialize() {}
  set value(content) {
    try { const data = readMcpForm(content); this.config = data.config; this.servers = data.servers; this.parseError = ''; }
    catch (error) { this.parseError = error.message; }
    if (this.isConnected) this.draw();
  }
  get value() {
    if (this.parseError) throw new Error(this.parseError);
    const servers = [...this.querySelectorAll('.mcp-server-form')].map(form => form.readServer()).filter(server => server.connector_id || server.server_label || server.server_url || Object.keys(server.headers || {}).length);
    const names = new Set();
    for (const server of servers) {
      if (!server.connector_id) validateMcpServer(server);
      if (names.has(server.server_label)) throw new Error('Each server needs a unique name.');
      names.add(server.server_label);
    }
    return writeMcpForm(this.config, servers);
  }
  changed() { this.emit('mcp-change'); }
  draw() {
    this.replaceChildren();
    const el = (tag, props) => this.createElement(tag, props);
    if (this.parseError) { this.append(el('p', { role: 'alert', textContent: `Unable to load saved configuration: ${this.parseError}` })); return; }
    const list = el('div', { class: 'mcp-server-list' });
    const add = el('button', { type: 'button', class: 'mcp-add-server', textContent: '+ Add server' });
    add.addEventListener('click', () => { const form = this.serverForm({ server_label: '', server_url: '', headers: {} }); list.append(form); form.querySelector('input').focus(); this.changed(); });
    this.append(list, add);
    for (const server of this.servers) list.append(this.serverForm(server));
    if (!this.servers.length) list.append(this.serverForm({ server_label: '', server_url: '', headers: {} }));
    if (this.config.mcp_servers && Object.keys(this.config.mcp_servers).length) this.append(el('p', { class: 'mcp-help', textContent: 'Existing local command servers are preserved when you save.' }));
  }
  serverForm(server) {
    const el = (tag, props) => this.createElement(tag, props);
    const form = el('section', { class: 'mcp-server-form', 'aria-label': 'MCP server' });
    if (server.connector_id) {
      form.append(el('p', { textContent: `Connector: ${server.server_label} (preserved)` }));
      form.readServer = () => server;
      return form;
    }
    let revision = 0;
    const field = (label, props) => el('label', { children: [el('span', { textContent: label }), el('input', props)] });
    const name = field('Server name', { value: server.server_label || '', placeholder: 'gmail', 'data-field': 'name', autocomplete: 'off' });
    const url = field('URL', { type: 'url', value: server.server_url || '', placeholder: 'https://example.com/mcp', 'data-field': 'url', autocomplete: 'off', spellcheck: 'false' });
    const headers = el('div', { class: 'mcp-header-list' });
    const result = el('div', { class: 'mcp-test-results', 'aria-live': 'polite' });
    const invalidate = () => { revision++; result.replaceChildren(); this.changed(); };
    const addHeader = (key = '', value = '') => {
      const row = el('div', { class: 'mcp-header-row', children: [
        el('input', { 'aria-label': 'Header name', placeholder: 'Authorization', value: key, autocomplete: 'off', spellcheck: 'false' }),
        el('input', { 'aria-label': 'Header value', placeholder: 'Bearer your-token', value, type: 'password', autocomplete: 'off' }),
      ] });
      const remove = el('button', { type: 'button', 'aria-label': 'Remove header', textContent: '×' });
      remove.addEventListener('click', () => { row.remove(); invalidate(); });
      row.append(remove); headers.append(row);
    };
    for (const [key, value] of Object.entries(server.headers || {})) addHeader(key, value);
    // Older remote configurations may store authorization as a separate field.
    if (server.authorization && !Object.keys(server.headers || {}).some(key => key.toLowerCase() === 'authorization')) addHeader('Authorization', /^Bearer\s/i.test(server.authorization) ? server.authorization : `Bearer ${server.authorization}`);
    const add = el('button', { type: 'button', textContent: '+ Add header' });
    add.addEventListener('click', () => { addHeader(); invalidate(); headers.lastElementChild.querySelector('input').focus(); });
    const test = el('button', { type: 'button', class: 'primary', textContent: 'Test connection' });
    const remove = el('button', { type: 'button', textContent: 'Remove server' });
    remove.addEventListener('click', () => { revision++; form.remove(); this.changed(); });
    form.append(el('div', { class: 'mcp-server-fields', children: [name, url] }), el('h3', { textContent: 'Headers' }), headers, add,
      el('div', { class: 'mcp-server-actions', children: [test, remove] }), result);
    form.addEventListener('input', invalidate);
    form.readServer = () => {
      const values = {};
      const keys = new Set();
      for (const row of headers.children) {
        const [keyInput, valueInput] = row.querySelectorAll('input');
        const key = keyInput.value.trim();
        if (!key && !valueInput.value) continue;
        if (!key) throw new Error('Enter a name for every header.');
        if (keys.has(key.toLowerCase())) throw new Error(`Duplicate header: ${key}`);
        keys.add(key.toLowerCase()); Object.defineProperty(values, key, { value: valueInput.value, enumerable: true });
      }
      const next = { ...server, server_label: name.querySelector('input').value.trim(), server_url: url.querySelector('input').value.trim(), headers: values };
      delete next.authorization;
      return next;
    };
    test.addEventListener('click', async () => {
      const current = ++revision;
      test.disabled = true; result.textContent = 'Connecting…';
      try {
        const server = validateMcpServer(form.readServer());
        const response = await fetch('/api/mcp/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ server }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Connection failed.');
        if (current !== revision || !form.isConnected) return;
        result.replaceChildren(el('strong', { textContent: `Connected · ${data.tools.length} available ${data.tools.length === 1 ? "method" : "methods"}` }));
        if (!data.tools.length) result.append(el('p', { textContent: 'This server did not advertise any tools.' }));
        for (const tool of data.tools) result.append(el('details', { children: [el('summary', { textContent: tool.name }), el('p', { textContent: tool.description || 'No description provided.' }), el('pre', { textContent: JSON.stringify(tool.inputSchema || {}, null, 2) })] }));
      } catch (error) { if (current === revision && form.isConnected) result.textContent = error.message; }
      finally { test.disabled = false; }
    });
    return form;
  }
}
customElements.define('office-mcp-settings', OfficeMcpSettings);
export default OfficeMcpSettings;
