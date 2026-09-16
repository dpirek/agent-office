import OfficeComponent from "./office-component.mjs";
import { escapeHtml, scheduleTime } from "./office-format.mjs";

class OfficeOperations extends OfficeComponent {
  static hostAttributes = {"class": "panel operations-panel"};
  model = { operations: [], workers: [], projectId: "central-office" };

  render() {
    this.appendChildren(this, [
      this.createElement("header", { "class": "panel-header", children: [
        this.createElement("div", { children: [
          this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#calendar3" })
          ] }),
          this.createElement("h2", { textContent: "PERIODIC OPERATIONS" })
        ] }),
        this.createElement("button", { "class": "header-action", "id": "add-operation-button", "type": "button", textContent: "+ NEW OPERATION" })
      ] }),
      this.createElement("div", { "class": "operations-summary panel-body", children: [
        this.createElement("strong", { "id": "operations-active-count", textContent: "0 ACTIVE" }),
        this.createElement("span", { textContent: "Schedules are persisted and dispatched to connected WebSocket workers." })
      ] }),
      this.createElement("div", { "class": "operations-table-wrap panel-body", children: [
        this.createElement("table", { "class": "operations-table", children: [
          this.createElement("thead", { children: [
            this.createElement("tr", { children: [
              this.createElement("th", { textContent: "OPERATION" }),
              this.createElement("th", { textContent: "SCHEDULE" }),
              this.createElement("th", { textContent: "ASSIGNMENT" }),
              this.createElement("th", { textContent: "PRIORITY" }),
              this.createElement("th", { textContent: "LAST RUN" }),
              this.createElement("th", { textContent: "NEXT RUN" }),
              this.createElement("th", { textContent: "STATE" }),
              this.createElement("th", { textContent: "ACTIONS" })
            ] })
          ] }),
          this.createElement("tbody", { "id": "operations-body" })
        ] })
      ] }),
      this.createElement("dialog", { "class": "agent-dialog operation-dialog", "id": "operation-dialog", "aria-labelledby": "operation-dialog-title", children: [
        this.createElement("form", { "id": "operation-form", children: [
          this.createElement("header", { "class": "panel-header", children: [
            this.createElement("div", { children: [
              this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
                this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#calendar3" })
              ] }),
              this.createElement("h2", { "id": "operation-dialog-title", textContent: "NEW PERIODIC OPERATION" })
            ] }),
            this.createElement("button", { "class": "dialog-close", "id": "close-operation-dialog", "type": "button", "aria-label": "Close", textContent: "×" })
          ] }),
          this.createElement("div", { "class": "agent-form-body operation-form-body", children: [
            this.createElement("input", { "type": "hidden", "id": "operation-id" }),
            this.createElement("label", { "for": "operation-name", textContent: "NAME" }),
            this.createElement("input", { "id": "operation-name", "maxlength": "100", "required": "", "placeholder": "Daily status report" }),
            this.createElement("label", { "for": "operation-task", textContent: "INSTRUCTIONS" }),
            this.createElement("textarea", { "id": "operation-task", "maxlength": "100000", "required": "", "placeholder": "Describe the task to run on every interval…" }),
            this.createElement("label", { "for": "operation-agent", textContent: "ASSIGN TO" }),
            this.createElement("select", { "id": "operation-agent", children: [
              this.createElement("option", { "value": "auto", textContent: "AUTO ASSIGN" })
            ] }),
            this.createElement("label", { "for": "operation-interval", textContent: "RUN EVERY" }),
            this.createElement("div", { "class": "interval-fields", children: [
              this.createElement("input", { "id": "operation-interval", "type": "number", "min": "1", "max": "10000", "value": "1", "required": "" }),
              this.createElement("select", { "id": "operation-unit", children: [
                this.createElement("option", { "value": "minutes", textContent: "MINUTES" }),
                this.createElement("option", { "value": "hours", "selected": "", textContent: "HOURS" }),
                this.createElement("option", { "value": "days", textContent: "DAYS" })
              ] })
            ] }),
            this.createElement("label", { "for": "operation-priority", textContent: "PRIORITY" }),
            this.createElement("select", { "id": "operation-priority", children: [
              this.createElement("option", { "value": "medium", textContent: "MEDIUM" }),
              this.createElement("option", { "value": "high", textContent: "HIGH" }),
              this.createElement("option", { "value": "low", textContent: "LOW" })
            ] }),
            this.createElement("label", { "for": "operation-enabled", textContent: "ENABLED" }),
            this.createElement("label", { "class": "enabled-field", children: [
              this.createElement("input", { "id": "operation-enabled", "type": "checkbox", "checked": "" }),
              this.createElement("span", { textContent: "Dispatch automatically" })
            ] })
          ] }),
          this.createElement("footer", { "class": "dialog-actions", children: [
            this.createElement("button", { "id": "cancel-operation", "type": "button", textContent: "CANCEL" }),
            this.createElement("button", { "class": "primary", "id": "save-operation", "type": "submit", textContent: "SAVE OPERATION" })
          ] })
        ] })
      ] })
    ]);
  }

  initialize() {
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);
    const showToast = (message, error = false) => this.emit("office-notify", { message, error });
    const addLog = (source, text, tone = "") => this.emit("office-log", { source, text, tone });
    function renderOperationAgentOptions() {
      const select = $("#operation-agent");
      if (!select) return;
      const selected = select.value || "auto";
      select.innerHTML = `<option value="auto">AUTO ASSIGN</option>${state.workers.map((worker) => `<option value="${escapeHtml(worker.name)}">${escapeHtml(worker.name)}</option>`).join("")}`;
      select.value = [...select.options].some((option) => option.value === selected) ? selected : "auto";
    }

    function renderOperations() {
      const body = $("#operations-body");
      if (!body) return;
      const active = state.operations.filter((operation) => operation.enabled).length;
      $("#operations-active-count").textContent = `${active} ACTIVE`;
      body.innerHTML = state.operations.length ? state.operations.map((operation) => {
        const stateClass = !operation.enabled ? "disabled" : operation.lastStatus === "failed" ? "failed" : "";
        const stateLabel = operation.enabled ? operation.lastStatus || "SCHEDULED" : "DISABLED";
        return `<tr>
          <td><span class="operation-name"><strong>${escapeHtml(operation.name)}</strong><small title="${escapeHtml(operation.task)}">${escapeHtml(operation.task)}</small></span></td>
          <td>EVERY ${operation.intervalValue} ${escapeHtml(operation.intervalUnit).toUpperCase()}</td>
          <td>${operation.agent === "auto" ? "AUTO ASSIGN" : escapeHtml(operation.agent)}</td>
          <td class="priority-${escapeHtml(operation.priority)}">${escapeHtml(operation.priority)}</td>
          <td>${scheduleTime(operation.lastRunAt)}</td><td>${operation.enabled ? scheduleTime(operation.nextRunAt) : "—"}</td>
          <td><span class="operation-state ${stateClass}">${escapeHtml(stateLabel)}</span></td>
          <td><span class="operation-actions"><button class="toggle-operation" data-operation="${escapeHtml(operation.id)}">${operation.enabled ? "DISABLE" : "ENABLE"}</button><button class="edit-operation" data-operation="${escapeHtml(operation.id)}">EDIT</button><button class="delete-operation" data-operation="${escapeHtml(operation.id)}">DELETE</button></span></td>
        </tr>`;
      }).join("") : `<tr class="empty-row"><td colspan="8">NO PERIODIC OPERATIONS DEFINED</td></tr>`;
    }

    async function mutateOperation(method, payload) {
      const projectId = state.projectId;
      payload = { ...payload, projectId };
      const response = await fetch("/api/operations", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (projectId !== state.projectId) return data;
      state.operations = data.operations || [];
      renderOperations();
      component.emit("operations-change", { operations: state.operations });
      return data;
    }

    const component = this;
    const operationDialog = $("#operation-dialog");
    function openOperationDialog(operation = null) {
      $("#operation-dialog-title").textContent = operation ? "EDIT PERIODIC OPERATION" : "NEW PERIODIC OPERATION";
      $("#operation-id").value = operation?.id || "";
      $("#operation-name").value = operation?.name || "";
      $("#operation-task").value = operation?.task || "";
      renderOperationAgentOptions();
      $("#operation-agent").value = operation?.agent || "auto";
      $("#operation-interval").value = operation?.intervalValue || 1;
      $("#operation-unit").value = operation?.intervalUnit || "hours";
      $("#operation-priority").value = operation?.priority || "medium";
      $("#operation-enabled").checked = operation?.enabled !== false;
      operationDialog.showModal();
      $("#operation-name").focus();
    }

    function operationPayload(operation, changes = {}) {
      return {
        id: operation.id,
        name: operation.name,
        task: operation.task,
        agent: operation.agent,
        intervalValue: operation.intervalValue,
        intervalUnit: operation.intervalUnit,
        priority: operation.priority,
        enabled: operation.enabled,
        ...changes,
      };
    }

    $("#add-operation-button").addEventListener("click", () => openOperationDialog());
    $("#close-operation-dialog").addEventListener("click", () => operationDialog.close());
    $("#cancel-operation").addEventListener("click", () => operationDialog.close());
    operationDialog.addEventListener("click", (event) => {
      if (event.target === operationDialog) operationDialog.close();
    });
    $("#operation-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const id = $("#operation-id").value;
      const saveButton = $("#save-operation");
      saveButton.disabled = true;
      try {
        await mutateOperation(id ? "PUT" : "POST", {
          id,
          name: $("#operation-name").value.trim(),
          task: $("#operation-task").value.trim(),
          agent: $("#operation-agent").value,
          intervalValue: Number($("#operation-interval").value),
          intervalUnit: $("#operation-unit").value,
          priority: $("#operation-priority").value,
          enabled: $("#operation-enabled").checked,
        });
        operationDialog.close();
        addLog("Scheduler", `${id ? "Updated" : "Created"} periodic operation`, "success");
        showToast(`Periodic operation ${id ? "updated" : "created"}.`);
      } catch (error) {
        showToast(error.message, true);
      } finally {
        saveButton.disabled = false;
      }
    });
    $("#operations-body").addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-operation]");
      if (!button) return;
      const operation = state.operations.find((entry) => entry.id === button.dataset.operation);
      if (!operation) return;
      if (button.classList.contains("edit-operation")) {
        openOperationDialog(operation);
        return;
      }
      if (button.classList.contains("delete-operation")) {
        if (!window.confirm(`Delete periodic operation “${operation.name}”?`)) return;
        try {
          await mutateOperation("DELETE", { id: operation.id });
          showToast(`Deleted ${operation.name}.`);
        } catch (error) { showToast(error.message, true); }
        return;
      }
      try {
        await mutateOperation("PUT", operationPayload(operation, { enabled: !operation.enabled }));
        showToast(`${operation.name} ${operation.enabled ? "disabled" : "enabled"}.`);
      } catch (error) { showToast(error.message, true); }
    });

    this.update = () => { renderOperations(); renderOperationAgentOptions(); };
    this.open = openOperationDialog;
    this.close = () => operationDialog.close();
  }
}

customElements.define("office-operations", OfficeOperations);
export default OfficeOperations;
