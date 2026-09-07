import { defineComponent } from "./define-component.mjs";

defineComponent("recent-tasks-panel", {
  classes: ["panel"],
  attributes: { role: "region", "aria-labelledby": "recent-tasks-title" },
  template: `
    <div class="panel-head">
      <div class="panel-title"><svg class="panel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 6h7l2 2h9v11H3Z"/><path d="M3 6V4h7l2 2"/></svg><span class="head-rule"></span><h2 id="recent-tasks-title">Recent tasks</h2></div>
      <div class="panel-tools"><span>Latest 50</span><button class="panel-minimize-button" type="button" data-panel-toggle data-panel-name="Recent tasks" aria-expanded="true" aria-label="Minimize Recent tasks" title="Minimize Recent tasks"><span class="panel-toggle-symbol" aria-hidden="true">−</span></button></div>
    </div>
    <div class="tasks"><table><thead><tr><th>Message</th><th>Source</th><th>Status</th><th>Callback</th><th>Created</th></tr></thead><tbody id="tasks"><tr><td class="empty-table" colspan="5">No tasks yet.</td></tr></tbody></table></div>
  `,
});
