import { defineComponent } from "./define-component.mjs";

defineComponent("agent-status-dialog", {
  template: `
    <dialog class="status-dialog" id="status-dialog" aria-labelledby="status-title">
      <div class="panel-head">
        <div class="dialog-title"><h2 id="status-title">Agent status</h2><span class="badge" id="queue-badge">0 active</span></div>
        <button class="icon-button" id="close-status" type="button" aria-label="Close agent status" title="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
      </div>
      <div class="status-body" id="status"><div class="empty">Loading configuration…</div></div>
    </dialog>
  `,
});
