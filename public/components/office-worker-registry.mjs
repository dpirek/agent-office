import OfficeComponent from "./office-component.mjs";
import { escapeHtml } from "./office-format.mjs";

class OfficeWorkerRegistry extends OfficeComponent {
  static hostAttributes = {"class": "panel agent-registry-panel"};
  model = { workers: [], workerTokenConfigured: false, workerTokenName: "" };

  render() {
    this.appendChildren(this, [
      this.createElement("header", { "class": "panel-header", children: [
        this.createElement("div", { children: [
          this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#people" })
          ] }),
          this.createElement("h2", { textContent: "LIVE WORKER REGISTRY" })
        ] }),
        this.createElement("div", { "class": "registry-header-actions", children: [
          this.createElement("span", { "class": "panel-meta", "id": "worker-token-status", textContent: "TOKEN NOT SET" }),
          this.createElement("button", { "class": "header-action icon-button", "id": "generate-worker-token", "type": "button", "aria-label": "Generate worker token", "title": "Generate worker token", children: [
            this.createElement("svg", { "viewBox": "0 0 24 24", "aria-hidden": "true", children: [
              this.createElement("circle", { "cx": "8", "cy": "12", "r": "4" }),
              this.createElement("path", { "d": "M12 12h8M17 12v3M20 12v2" })
            ] })
          ] })
        ] })
      ] }),
      this.createElement("div", { "class": "panel-body registry-body", children: [
        this.createElement("table", { "class": "registry-table", children: [
          this.createElement("thead", { children: [
            this.createElement("tr", { children: [
              this.createElement("th", { textContent: "NAME" }),
              this.createElement("th", { textContent: "STATUS" }),
              this.createElement("th", { textContent: "TOKEN NAME" }),
              this.createElement("th", { textContent: "CAPABILITIES" })
            ] })
          ] }),
          this.createElement("tbody", { "id": "agent-registry-body" })
        ] })
      ] }),
      this.createElement("dialog", { "class": "agent-dialog worker-token-dialog", "id": "worker-token-dialog", "aria-labelledby": "worker-token-dialog-title", children: [
        this.createElement("form", { "method": "dialog", children: [
          this.createElement("header", { "class": "panel-header", children: [
            this.createElement("div", { children: [
              this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
                this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#key" })
              ] }),
              this.createElement("h2", { "id": "worker-token-dialog-title", textContent: "GENERATE WORKER TOKEN" })
            ] }),
            this.createElement("button", { "class": "dialog-close", "value": "close", "type": "submit", "aria-label": "Close", textContent: "×" })
          ] }),
          this.createElement("div", { "class": "worker-token-body", children: [
            this.createElement("p", { "id": "worker-token-help", textContent: "Name this credential so registered workers can show which token they used." }),
            this.createElement("label", { "for": "worker-token-name", textContent: "TOKEN NAME" }),
            this.createElement("input", { "id": "worker-token-name", "maxlength": "100", "autocomplete": "off", "placeholder": "Production workers" }),
            this.createElement("div", { "class": "worker-token-secret", "id": "worker-token-secret", "hidden": "", children: [
              this.createElement("p", { textContent: "Copy this credential now and provide it to the worker. Generating another token replaces it for future registrations." }),
              this.createElement("label", { "for": "worker-token-value", textContent: "AI_HARNESS_WORKER_TOKEN" }),
              this.createElement("textarea", { "id": "worker-token-value", "rows": "3", "readonly": "", "spellcheck": "false" })
            ] })
          ] }),
          this.createElement("footer", { "class": "dialog-actions", children: [
            this.createElement("button", { "id": "copy-worker-token", "type": "button", "hidden": "", textContent: "COPY TOKEN" }),
            this.createElement("button", { "class": "primary", "id": "confirm-generate-worker-token", "type": "button", textContent: "GENERATE TOKEN" }),
            this.createElement("button", { "value": "close", "type": "submit", textContent: "CLOSE" })
          ] })
        ] })
      ] })
    ]);
  }

  initialize() {
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);
    const showToast = (message, error = false) => this.emit("office-notify", { message, error });
    function renderAgentRegistry() {
      const body = $("#agent-registry-body");
      if (!body) return;
      body.innerHTML = state.workers.length ? state.workers.map((worker) => `
        <tr>
          <td>${escapeHtml(worker.name)}</td>
          <td><span class="registry-status ${worker.status === "connected" ? "connected" : "offline"}">${worker.status === "connected" ? "CONNECTED" : "OFFLINE"}</span></td>
          <td>${escapeHtml(worker.tokenName || "—")}</td>
          <td>${escapeHtml([...(worker.capabilities?.skills || []).map((skill) => skill.name), ...(worker.capabilities?.tools || [])].slice(0, 4).join(", ") || "REGISTERED")}</td>
        </tr>`).join("") : `<tr class="empty-row"><td colspan="4">WAITING FOR AUTHENTICATED WEBSOCKET WORKERS</td></tr>`;
    }

    function renderWorkerTokenState() {
      $("#worker-token-status").textContent = state.workerTokenConfigured ? `TOKEN: ${state.workerTokenName || "CONFIGURED"}` : "TOKEN NOT SET";
      const action = state.workerTokenConfigured ? "Regenerate worker token" : "Generate worker token";
      $("#generate-worker-token").setAttribute("aria-label", action);
      $("#generate-worker-token").title = action;
    }
    const workerTokenDialog = $("#worker-token-dialog");
    $("#generate-worker-token").addEventListener("click", () => {
      $("#worker-token-dialog-title").textContent = "GENERATE WORKER TOKEN";
      $("#worker-token-help").textContent = "Name this credential so registered workers can show which token they used.";
      $("#worker-token-name").value = state.workerTokenName || "Office workers";
      $("#worker-token-name").disabled = false;
      $("#worker-token-value").value = "";
      $("#worker-token-secret").hidden = true;
      $("#copy-worker-token").hidden = true;
      $("#confirm-generate-worker-token").hidden = false;
      workerTokenDialog.showModal();
      $("#worker-token-name").focus();
      $("#worker-token-name").select();
    });
    $("#confirm-generate-worker-token").addEventListener("click", async () => {
      const name = $("#worker-token-name").value.trim();
      if (!name) {
        showToast("Enter a token name.", true);
        $("#worker-token-name").focus();
        return;
      }
      const button = $("#generate-worker-token");
      const confirmButton = $("#confirm-generate-worker-token");
      button.disabled = true;
      confirmButton.disabled = true;
      try {
        const response = await fetch("/api/worker-token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        state.workerTokenConfigured = true;
        state.workerTokenName = data.name;
        this.emit("worker-token-change", { name: data.name, configured: true });
        renderWorkerTokenState();
        $("#worker-token-dialog-title").textContent = "WORKER TOKEN GENERATED";
        $("#worker-token-help").textContent = `Token “${data.name}” is ready.`;
        $("#worker-token-name").disabled = true;
        $("#worker-token-value").value = data.token;
        $("#worker-token-secret").hidden = false;
        $("#copy-worker-token").hidden = false;
        confirmButton.hidden = true;
        $("#worker-token-value").select();
      } catch (error) {
        showToast(error.message, true);
      } finally {
        button.disabled = false;
        confirmButton.disabled = false;
      }
    });
    $("#copy-worker-token").addEventListener("click", async () => {
      const token = $("#worker-token-value").value;
      try {
        await navigator.clipboard.writeText(token);
      } catch {
        $("#worker-token-value").select();
        document.execCommand("copy");
      }
      showToast("Worker token copied.");
    });
    workerTokenDialog.addEventListener("close", () => {
      $("#worker-token-value").value = "";
      $("#worker-token-name").disabled = false;
    });

    this.onDisconnect = () => {
      workerTokenDialog.close();
      $("#worker-token-value").value = "";
    };
    this.update = () => { renderAgentRegistry(); renderWorkerTokenState(); };
  }
}

customElements.define("office-worker-registry", OfficeWorkerRegistry);
export default OfficeWorkerRegistry;
