import { defineComponent } from "./define-component.mjs";

defineComponent("agent-console-header", {
  classes: ["topbar"],
  attributes: { role: "banner" },
  template: `
    <div class="brand-mark" aria-hidden="true">›<span class="terminal-cursor">_</span></div>
    <div class="brand-copy">
      <h1>Agent Worker Console</h1>
      <p class="subtitle" id="agent-description">Connecting to configured worker…</p>
      <p class="subtitle-meta">v1.0.0 · Workspace <strong id="workspace-summary">—</strong></p>
    </div>
    <div class="header-actions">
      <div class="live"><span class="dot" id="health-dot"></span><span id="health-text">Checking server</span></div>
      <button class="icon-button" id="open-status" type="button" aria-label="Open agent status" title="Agent status">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M10 14v6"/>
        </svg>
      </button>
    </div>
  `,
});
