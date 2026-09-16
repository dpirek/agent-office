import OfficeComponent from "./office-component.mjs";
import { escapeHtml, clock } from "./office-format.mjs";

class OfficeSystemLog extends OfficeComponent {
  static hostAttributes = {"class": "panel logs-panel"};
  model = { logs: [] };

  render() {
    this.appendChildren(this, [
      this.createElement("header", { "class": "panel-header", children: [
        this.createElement("div", { children: [
          this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#terminal" })
          ] }),
          this.createElement("h2", { textContent: "SYSTEM LOGS" })
        ] })
      ] }),
      this.createElement("div", { "class": "system-log panel-body", "id": "system-log" })
    ]);
  }

  initialize() {
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);
    function renderLogs() {
      const node = $("#system-log");
      const entries = state.logs.slice(-200);
      node.innerHTML = entries.length ? entries.map((entry) => `<div class="log-line"><time>${clock(entry.at)}</time><b>${escapeHtml(entry.source)}</b><span class="${entry.tone}">${escapeHtml(entry.text)}</span></div>`).join("") : `<div class="log-line"><time>--:--:--</time><b>System</b><span>No events recorded.</span></div>`;
      node.scrollTop = node.scrollHeight;
    }
    this.update = renderLogs;
  }
}

customElements.define("office-system-log", OfficeSystemLog);
export default OfficeSystemLog;
