import './office-observability.mjs';
import OfficeComponent from "./office-component.mjs";
import { escapeHtml, clock } from "./office-format.mjs";

class OfficeSystemLog extends OfficeComponent {
  static hostAttributes = {"class": "panel logs-panel"};
  model = { logs: [], userRole: '' };

  render() {
    this.appendChildren(this, [
      this.createElement("header", { "class": "panel-header", children: [
        this.createElement("div", { children: [
          this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#terminal" })
          ] }),
          this.createElement("h2", { textContent: "SYSTEM LOGS" })
        ] }),
        this.createElement('button', { type: 'button', class: 'observability-add', 'aria-label': 'Add observability provider', title: 'Add observability provider', hidden: '', children: [
          this.createElement('svg', { width: '16', height: '16', viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true', children: [this.createElement('use', { href: '/assets/bootstrap-icons/bootstrap-icons.svg#plus-lg' })] })
        ] })
      ] }),
      this.createElement("div", { "class": "system-log panel-body", "id": "system-log" }),
      this.createElement("office-observability")
    ]);
  }

  initialize() {
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);
    $('.observability-add').addEventListener('click', () => { if (state.userRole === 'admin') $('office-observability').open(); });
    let previous = '';
    function renderLogs() {
      $(".observability-add").hidden = state.userRole !== "admin";
      const node = $("#system-log");
      const entries = state.logs.slice(-500);
      const signature = JSON.stringify(entries);
      if (signature === previous) return;
      const follow = !previous || node.scrollHeight - node.scrollTop - node.clientHeight < 40;
      previous = signature;
      const opened = new Set([...node.querySelectorAll('details[open]')].map(item => item.dataset.id));
      const scrollTop = node.scrollTop;
      node.innerHTML = entries.length ? entries.map((entry, index) => {
        const id = String(entry.id || `${entry.at}-${index}`);
        const tone = ['error', 'success', 'tool'].includes(entry.tone) ? entry.tone : '';
        const metadata = entry.metadata || {};
        const context = [entry.category, metadata.projectId && `Project: ${metadata.projectId}`, metadata.taskId && `Task: ${metadata.taskId}`].filter(Boolean).join(' · ');
        return `<details class="log-entry" data-id="${escapeHtml(id)}" ${opened.has(id) ? 'open' : ''}><summary class="log-line"><time>${clock(entry.at)}</time><b>${escapeHtml(entry.source)}</b><span class="${tone}">${escapeHtml(entry.text)}</span></summary><div class="log-details"><small>${escapeHtml(context)}</small><pre>${escapeHtml(JSON.stringify(metadata, null, 2))}</pre></div></details>`;
      }).join('') : '<div class="log-line"><span>No events recorded.</span></div>';
      node.scrollTop = follow ? node.scrollHeight : scrollTop;
    }
    this.update = renderLogs;
  }
}

customElements.define("office-system-log", OfficeSystemLog);
export default OfficeSystemLog;
