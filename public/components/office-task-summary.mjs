import OfficeComponent from "./office-component.mjs";
import { escapeHtml } from "./office-format.mjs";
import { projectPagePath } from "../lib/project-routes.mjs";

class OfficeTaskSummary extends OfficeComponent {
  static hostAttributes = {"class": "panel dashboard-tasks-panel"};
  model = { tasks: [], projectId: "central-office" };

  render() {
    this.appendChildren(this, [
      this.createElement("header", { "class": "panel-header", children: [
        this.createElement("div", { children: [
          this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "aria-hidden": "true", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#clipboard-check" })
          ] }),
          this.createElement("h2", { textContent: "TASKS" })
        ] }),
        this.createElement("a", { "class": "dashboard-tasks-link", "href": "/central-office/tasks", textContent: "See all" })
      ] }),
      this.createElement("div", { "class": "dashboard-tasks-body panel-body", "id": "dashboard-tasks-body" })
    ]);
  }

  initialize() {
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);

    const allTasks = () => state.tasks;
    this.update = () => {
      const tasks = allTasks();
      const projectTasks = tasks.filter(task => (task.projectId || 'central-office') === state.projectId);
      const activeTasks = projectTasks.filter(task => ['running', 'pending'].includes(task.status));
      const taskUrl = projectPagePath('tasks', state.projectId);
      $('.dashboard-tasks-link').href = taskUrl;
      const previewTasks = [...activeTasks, ...projectTasks.filter(task => !['running', 'pending'].includes(task.status))].slice(0, 5);
      $('#dashboard-tasks-body').innerHTML = previewTasks.length
        ? `<div class="dashboard-tasks-summary">${activeTasks.length} active · ${projectTasks.length} total</div>${previewTasks.map(task => `<a class="dashboard-task" href="${escapeHtml(taskUrl)}"><span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.agent || 'Unassigned')}</small></span><span class="dashboard-task-status status-${escapeHtml(task.status)}">${escapeHtml(task.status)}</span></a>`).join('')}`
        : `<div class="chat-empty"><strong>No tasks yet</strong><span>Create a task to get started.</span><a href="${escapeHtml(taskUrl)}">Open task queue</a></div>`;

    };
  }
}

customElements.define("office-task-summary", OfficeTaskSummary);
export default OfficeTaskSummary;
