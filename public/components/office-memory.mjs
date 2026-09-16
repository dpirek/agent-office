import OfficeComponent from "./office-component.mjs";
import { escapeHtml, scheduleTime, fetchJson } from "./office-format.mjs";

class OfficeMemory extends OfficeComponent {
  static hostAttributes = {"class": "panel memory-panel"};
  model = { memoryRecords: [], projectId: "central-office" };

  render() {
    this.appendChildren(this, [
      this.createElement("header", { "class": "panel-header", children: [
        this.createElement("div", { children: [
          this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#database" })
          ] }),
          this.createElement("h2", { textContent: "OFFICE MEMORY" })
        ] }),
        this.createElement("button", { "class": "header-action", "id": "refresh-memory-button", "type": "button", textContent: "REFRESH" })
      ] }),
      this.createElement("div", { "class": "memory-summary panel-body", children: [
        this.createElement("strong", { "id": "memory-record-count", textContent: "0 RECORDS" }),
        this.createElement("span", { textContent: "Durable task and operation history available to the office manager." })
      ] }),
      this.createElement("div", { "class": "memory-table-wrap panel-body", children: [
        this.createElement("table", { "class": "memory-table", children: [
          this.createElement("thead", { children: [
            this.createElement("tr", { children: [
              this.createElement("th", { textContent: "WHEN" }),
              this.createElement("th", { textContent: "TYPE" }),
              this.createElement("th", { textContent: "STATUS" }),
              this.createElement("th", { textContent: "AGENT" }),
              this.createElement("th", { textContent: "WORK" }),
              this.createElement("th", { textContent: "DELIVERED ARTIFACTS" })
            ] })
          ] }),
          this.createElement("tbody", { "id": "memory-body" })
        ] })
      ] })
    ]);
  }

  initialize() {
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);
    const showToast = (message, error = false) => this.emit("office-notify", { message, error });
    function renderMemory() {
      const body = $("#memory-body");
      if (!body) return;
      $("#memory-record-count").textContent = `${state.memoryRecords.length} RECORD${state.memoryRecords.length === 1 ? "" : "S"}`;
      body.innerHTML = state.memoryRecords.length ? state.memoryRecords.map((record) => `<tr>
        <td>${scheduleTime(record.occurredAt)}</td>
        <td>${escapeHtml(record.kind)}</td>
        <td class="memory-status-${escapeHtml(record.status)}">${escapeHtml(record.status)}</td>
        <td>${escapeHtml(record.agent || "—")}</td>
        <td class="memory-work"><strong>${escapeHtml(record.title)}</strong><span title="${escapeHtml(record.summary)}">${escapeHtml(record.summary || "No summary was recorded.")}</span></td>
        <td class="memory-artifacts">${record.artifacts?.length ? record.artifacts.map((artifact) => `<a href="${escapeHtml(artifact.uri)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(artifact.mimeType || "artifact")}">↗ ${escapeHtml(artifact.name || artifact.artifactName || "Delivered work")}</a>`).join("") : "—"}</td>
      </tr>`).join("") : `<tr class="empty-row"><td colspan="6">NO COMPLETED OR FAILED WORK RECORDED YET</td></tr>`;
    }

    async function loadMemory({ quiet = false } = {}) {
      try {
        const projectId = state.projectId;
        const data = await fetchJson(`/api/memory?limit=200&projectId=${encodeURIComponent(projectId)}`);
        if (projectId !== state.projectId) return;
        state.memoryRecords = data.records || [];
        renderMemory();
      } catch (error) {
        if (!quiet) showToast(error.message, true);
      }
    }

    $('#refresh-memory-button').addEventListener('click', () => void loadMemory());
    this.load = loadMemory;
    this.update = renderMemory;
  }
}

customElements.define("office-memory", OfficeMemory);
export default OfficeMemory;
