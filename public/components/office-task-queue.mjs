import OfficeComponent from "./office-component.mjs";
import { escapeHtml, shortTime } from "./office-format.mjs";

class OfficeTaskQueue extends OfficeComponent {
  static hostAttributes = {"class": "panel task-panel"};
  model = { tasks: [], projects: [], projectId: "central-office", taskFilter: "all" };

  render() {
    this.appendChildren(this, [
      this.createElement("header", { "class": "panel-header", children: [
        this.createElement("div", { children: [
          this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#clipboard-check" })
          ] }),
          this.createElement("h2", { textContent: "TASK QUEUE" })
        ] }),
        this.createElement("button", { "class": "header-action", "id": "add-task-button", "type": "button", textContent: "+ NEW TASK" })
      ] }),
      this.createElement("div", { "class": "task-toolbar panel-body", "id": "task-filters", "aria-label": "Filter tasks", children: [
        this.createElement("button", { "class": "active", "data-filter": "all", textContent: "ALL (0)" }),
        this.createElement("button", { "data-filter": "running", textContent: "RUNNING (0)" }),
        this.createElement("button", { "data-filter": "pending", textContent: "PENDING (0)" }),
        this.createElement("button", { "data-filter": "completed", textContent: "COMPLETED (0)" }),
        this.createElement("button", { "data-filter": "failed", textContent: "FAILED (0)" }),
        this.createElement("button", { "data-filter": "cancelled", textContent: "CANCELLED (0)" })
      ] }),
      this.createElement("div", { "class": "task-table-wrap panel-body", children: [
        this.createElement("table", { "class": "task-table", children: [
          this.createElement("thead", { children: [
            this.createElement("tr", { children: [
              this.createElement("th", { textContent: "#" }),
              this.createElement("th", { textContent: "TASK" }),
              this.createElement("th", { textContent: "AGENT" }),
              this.createElement("th", { textContent: "STATUS" }),
              this.createElement("th", { textContent: "PRIORITY" }),
              this.createElement("th", { textContent: "DEPENDENCIES" }),
              this.createElement("th", { textContent: "PROGRESS" }),
              this.createElement("th", { textContent: "CREATED" }),
              this.createElement("th", { textContent: "DELIVERED WORK" }),
              this.createElement("th", { textContent: "ACTION" })
            ] })
          ] }),
          this.createElement("tbody", { "id": "task-body" })
        ] })
      ] }),
      this.createElement("dialog", { "class": "agent-dialog task-dialog", "id": "task-dialog", "aria-labelledby": "task-dialog-title", children: [
        this.createElement("form", { "id": "task-form", children: [
          this.createElement("header", { "class": "panel-header", children: [
            this.createElement("div", { children: [
              this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
                this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#clipboard-check" })
              ] }),
              this.createElement("h2", { "id": "task-dialog-title", textContent: "CREATE TASK" })
            ] }),
            this.createElement("button", { "class": "dialog-close", "id": "close-task-dialog", "type": "button", "aria-label": "Close", textContent: "×" })
          ] }),
          this.createElement("div", { "class": "agent-form-body task-form-body", children: [
            this.createElement("label", { "for": "task-title", textContent: "INSTRUCTIONS" }),
            this.createElement("textarea", { "id": "task-title", "name": "title", "maxlength": "100000", "required": "", "placeholder": "Describe the result this agent should produce…" }),
            this.createElement("label", { "for": "task-priority", textContent: "PRIORITY" }),
            this.createElement("select", { "id": "task-priority", "name": "priority", children: [
              this.createElement("option", { "value": "medium", textContent: "MEDIUM" }),
              this.createElement("option", { "value": "high", textContent: "HIGH" }),
              this.createElement("option", { "value": "low", textContent: "LOW" })
            ] }),
            this.createElement("p", { textContent: "Created tasks remain unassigned until the office manager assigns them." })
          ] }),
          this.createElement("footer", { "class": "dialog-actions", children: [
            this.createElement("button", { "id": "cancel-task", "type": "button", textContent: "CANCEL" }),
            this.createElement("button", { "class": "primary", "id": "save-task", "type": "submit", textContent: "CREATE TASK" })
          ] })
        ] })
      ] })
    ]);
  }

  initialize() {
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);
    const $$ = (selector, root = this) => [...root.querySelectorAll(selector)];
    const showToast = (message, error = false) => this.emit("office-notify", { message, error });
    const addLog = (source, text, tone = "") => this.emit("office-log", { source, text, tone });
    const addActivity = (text, tone = "") => this.emit("office-activity", { text, tone });
    function taskCounts(tasks) {
      return Object.fromEntries(["all", "running", "pending", "completed", "failed", "cancelled"].map((status) => [status, status === "all" ? tasks.length : tasks.filter((task) => task.status === status).length]));
    }

    function taskActionIcon(action) {
      if (action === "stop") return `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8"></rect></svg>`;
      return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4.5h9M6 4.5V3h4v1.5M5 6.5v6M8 6.5v6M11 6.5v6M4.5 4.5l.5 9h6l.5-9"></path></svg>`;
    }

    const component = this;
    const expandedTaskIds = new Set();
    let revealedTaskId = null;
    const allTasks = () => state.tasks;
    const createTask = payload => this.request('task-create', payload);
    const stopTask = id => this.request('task-stop', { id });
    const deleteTask = id => this.request('task-delete', { id });
    const refreshDashboard = () => this.request('dashboard-refresh');
    function renderTasks() {
      const tasks = allTasks();
      const tasksById = new Map(tasks.map((task) => [task.id, task]));
      const counts = taskCounts(tasks);
      $$("#task-filters button").forEach((button) => {
        const filter = button.dataset.filter;
        button.textContent = `${filter.toUpperCase()} (${counts[filter]})`;
        button.classList.toggle("active", filter === state.taskFilter);
      });
      const filtered = state.taskFilter === "all" ? tasks : tasks.filter((task) => task.status === state.taskFilter);
      $("#task-body").innerHTML = filtered.length ? [...filtered].sort((a, b) => Number(b.id === revealedTaskId) - Number(a.id === revealedTaskId)).slice(0, 20).map((task, index) => {
        const dependencies = task.dependsOn || [];
        const waiting = dependencies.filter((id) => tasksById.get(id)?.status !== "completed");
        const dependencyState = dependencies.length === 0 ? "READY" : waiting.length ? `WAITING ${waiting.length}` : "MET";
        const dependencyTitle = dependencies.map((id) => tasksById.get(id)?.title || id).join(", ");
        return `<tr>
        <td>${index + 1}</td><td title="${escapeHtml(task.title)}"><button class="task-expand-button" type="button" data-task-id="${escapeHtml(task.id)}" aria-expanded="${expandedTaskIds.has(task.id)}" aria-controls="task-details-${escapeHtml(task.id)}"><span aria-hidden="true">${expandedTaskIds.has(task.id) ? "▾" : "▸"}</span> ${escapeHtml(task.title)}</button><small class="task-project-label">${escapeHtml(state.projects.find((project) => project.id === task.projectId)?.name || "Central Office")}</small></td><td>${escapeHtml(task.agent)}</td>
        <td class="status-${task.status}">${escapeHtml(task.status)}</td><td class="priority-${task.priority}">${escapeHtml(task.priority)}</td>
        <td title="${escapeHtml(dependencyTitle)}">${dependencyState}</td>
        <td><span class="progress-cell"><span class="progress"><i style="width:${task.progress}%"></i></span>${task.progress}%</span></td><td>${shortTime(task.createdAt)}</td>
        <td class="delivered-work">${task.deliveredWork?.length ? `<a href="/downloads/tasks/${encodeURIComponent(task.projectId || state.projectId)}/${encodeURIComponent(task.id)}.zip" download title="Download all ${task.deliveredWork.length} delivered files">↓ DOWNLOAD ZIP</a>` : "—"}</td>
        <td><span class="task-actions">
          ${task.status === "running" && task.canStop ? `<button class="task-action-button stop-task" data-task-id="${escapeHtml(task.id)}" type="button" title="Stop task" aria-label="Stop ${escapeHtml(task.title)}">${taskActionIcon("stop")}</button>` : ""}
          ${task.canDelete ? `<button class="task-action-button delete-task" data-task-id="${escapeHtml(task.id)}" type="button" title="${task.status === "running" ? "Stop task before deleting" : "Delete task"}" aria-label="Delete ${escapeHtml(task.title)}" ${task.status === "running" ? "disabled" : ""}>${taskActionIcon("delete")}</button>` : ""}
        </span></td>
      </tr><tr class="task-details-row" id="task-details-${escapeHtml(task.id)}" ${expandedTaskIds.has(task.id) ? "" : "hidden"}><td colspan="10"><strong>Task description</strong><p>${escapeHtml(task.description || task.title)}</p></td></tr>`;
      }).join("") : `<tr class="empty-row"><td colspan="10">NO TASKS IN THIS VIEW</td></tr>`;
    }
    const taskDialog = $("#task-dialog");
    function openTaskDialog() {
      $("#task-title").value = "";
      $("#task-priority").value = "medium";
      taskDialog.showModal();
      $("#task-title").focus();
    }

    $("#add-task-button").addEventListener("click", openTaskDialog);
    $("#close-task-dialog").addEventListener("click", () => taskDialog.close());
    $("#cancel-task").addEventListener("click", () => taskDialog.close());
    taskDialog.addEventListener("click", (event) => {
      if (event.target === taskDialog) taskDialog.close();
    });
    $("#task-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const saveButton = $("#save-task");
      saveButton.disabled = true;
      try {
        const result = await createTask({
          title: $("#task-title").value.trim(),
          priority: $("#task-priority").value,
        });
        taskDialog.close();
        if (state.taskFilter !== "all" && state.taskFilter !== result.task.status) component.filter = "all";
        renderTasks();
        await refreshDashboard({ quiet: true });
        addActivity(`Created unassigned task: ${result.task.title}`, "success");
        addLog("Coordinator", "Task created and waiting for office manager assignment", "success");
        showToast("Task created and left unassigned.");
      } catch (error) {
        showToast(error.message, true);
      } finally {
        saveButton.disabled = false;
      }
    });

    $("#task-body").addEventListener("click", async (event) => {
      const expand = event.target.closest(".task-expand-button");
      if (expand) {
        const id = expand.dataset.taskId;
        if (expandedTaskIds.has(id)) expandedTaskIds.delete(id);
        else expandedTaskIds.add(id);
        renderTasks();
        $("#task-body").querySelectorAll(".task-expand-button").forEach((button) => { if (button.dataset.taskId === id) button.focus(); });
        return;
      }
      const button = event.target.closest(".task-action-button[data-task-id]");
      if (!button) return;
      const task = allTasks().find((entry) => entry.id === button.dataset.taskId);
      const deleting = button.classList.contains("delete-task");
      const prompt = deleting
        ? `Delete “${task?.title || "this task"}” from the task queue?`
        : `Stop “${task?.title || "this task"}”? The worker will be instructed to terminate its work.`;
      if (!window.confirm(prompt)) return;
      button.disabled = true;
      try {
        if (deleting) await deleteTask(button.dataset.taskId);
        else await stopTask(button.dataset.taskId);
        await refreshDashboard({ quiet: true });
        addActivity(`${deleting ? "Deleted" : "Stopped"} task: ${task?.title || button.dataset.taskId}`, deleting ? "" : "error");
        showToast(`Task ${deleting ? "deleted" : "stopped"}.`);
      } catch (error) {
        button.disabled = false;
        showToast(error.message, true);
      }
    });

    $('#task-filters').addEventListener('click', event => {
      const button = event.target.closest('[data-filter]');
      if (button) this.filter = button.dataset.filter;
    });
    this.update = renderTasks;
    this.open = openTaskDialog;
    this.revealTask = id => {
      revealedTaskId = id;
      this.filter = 'all';
      expandedTaskIds.add(id);
      renderTasks();
      const button = [...$('#task-body').querySelectorAll('.task-expand-button')].find(button => button.dataset.taskId === id);
      button?.scrollIntoView({ block: 'center' });
      button?.focus();
    };
  }

  static observedAttributes = [...super.observedAttributes, "filter"];
  get filter() { return this.getAttribute("filter") || "all"; }
  set filter(value) {
    if (["all", "running", "pending", "completed", "failed", "cancelled"].includes(value)) this.setAttribute("filter", value);
  }
  attributeChangedCallback(name, previous, value) {
    super.attributeChangedCallback(name, previous, value);
    if (name !== "filter" || previous === value) return;
    this.model.taskFilter = this.filter;
    this.update?.();
    this.emit("task-filter-change", { filter: this.filter });
  }
}

customElements.define("office-task-queue", OfficeTaskQueue);
export default OfficeTaskQueue;
