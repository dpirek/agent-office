import { defineComponent } from "./define-component.mjs";

defineComponent("worker-logs-panel", {
  classes: ["panel"],
  attributes: { role: "region", "aria-labelledby": "worker-logs-title" },
  template: `
    <div class="panel-head">
      <div class="panel-title"><svg class="panel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 3h9l4 4v14H6Z"/><path d="M15 3v5h5M9 12h7M9 16h7"/></svg><span class="head-rule"></span><h2 id="worker-logs-title">Logs</h2></div>
      <button class="panel-minimize-button" type="button" data-panel-toggle data-panel-name="Logs" aria-expanded="true" aria-label="Minimize Logs" title="Minimize Logs"><span class="panel-toggle-symbol" aria-hidden="true">−</span></button>
    </div>
    <div class="logs" id="logs"><div class="log-row"><span>--:--:--</span><span>Waiting for worker status…</span></div></div>
  `,
});
