import { defineComponent } from "./define-component.mjs";

defineComponent("agent-info-panel", {
  classes: ["panel"],
  attributes: { role: "region", "aria-labelledby": "agent-info-title" },
  template: `
    <div class="panel-head">
      <div class="panel-title"><svg class="panel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg><span class="head-rule"></span><h2 id="agent-info-title">Agent info</h2></div>
      <button class="panel-minimize-button" type="button" data-panel-toggle data-panel-name="Agent info" aria-expanded="true" aria-label="Minimize Agent info" title="Minimize Agent info"><span class="panel-toggle-symbol" aria-hidden="true">−</span></button>
    </div>
    <div class="agent-info" id="agent-info"><div class="empty">Loading agent information…</div></div>
  `,
});
