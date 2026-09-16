import OfficeComponent from "./office-component.mjs";
import { escapeHtml } from "./office-format.mjs";
import { renderMarkdown } from "../lib/markdown.mjs";

class OfficeManagerChat extends OfficeComponent {
  static hostAttributes = {"class": "panel chat-panel"};
  model = { chatMessages: [], socketReady: false, chatRunning: false, health: null, projectId: "central-office" };

  render() {
    this.appendChildren(this, [
      this.createElement("header", { "class": "panel-header", children: [
        this.createElement("div", { children: [
          this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#robot" })
          ] }),
          this.createElement("h2", { textContent: "OFFICE MANAGER" })
        ] }),
        this.createElement("span", { "class": "panel-meta", "id": "chat-status", textContent: "CONNECTING" })
      ] }),
      this.createElement("div", { "class": "chat-messages panel-body", "id": "chat-messages", "aria-live": "polite", children: [
        this.createElement("div", { "class": "chat-empty", children: [
          this.createElement("strong", { textContent: "START A CONVERSATION" }),
          this.createElement("span", { textContent: "Ask the office manager to inspect, create, or assign work." })
        ] })
      ] }),
      this.createElement("form", { "class": "chat-composer panel-body", "id": "chat-form", children: [
        this.createElement("textarea", { "id": "chat-input", "rows": "1", "maxlength": "100000", "required": "", "placeholder": "Message the office manager…", "aria-label": "Message the office manager" }),
        this.createElement("button", { "class": "primary chat-send-button", "id": "send-chat", "type": "submit", textContent: "SEND" })
      ] })
    ]);
  }

  initialize() {
    this.enableFileLinks();
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);
    const showToast = (message, error = false) => this.emit("office-notify", { message, error });
    function renderChat() {
      const node = $("#chat-messages");
      if (!node) return;
      node.innerHTML = state.chatMessages.length ? state.chatMessages.map((message) => `
        <article class="chat-message ${escapeHtml(message.role)}${message.streaming ? " streaming" : ""}${message.error ? " error" : ""}">
          <label>${message.role === "user" ? "YOU" : "OFFICE MANAGER"}</label>
          <div class="chat-message-content markdown-body">${renderMarkdown(message.text || (message.streaming ? "Thinking" : ""))}</div>
        </article>`).join("") : `<div class="chat-empty"><strong>START A CONVERSATION</strong><span>Ask the office manager to inspect, create, or assign work.</span></div>`;
      node.scrollTop = node.scrollHeight;
      const ready = state.socketReady && Boolean(state.health?.workspace);
      $("#chat-status").textContent = state.chatRunning ? "WORKING…" : ready ? "READY" : "CONNECTING";
      $("#send-chat").disabled = posting || !ready || state.chatRunning;
      $("#chat-input").disabled = state.chatRunning;
    }

    function resizeChatInput() {
      const input = $("#chat-input");
      if (!input) return;
      input.style.height = "36px";
      const height = Math.min(Math.max(input.scrollHeight, 36), 160);
      input.style.height = `${height}px`;
      input.style.overflowY = input.scrollHeight > 160 ? "auto" : "hidden";
    }

    let posting = false;
    const postOfficeChat = payload => this.request('chat-send', payload);
    const loadOfficeChat = () => this.request('chat-refresh');
    $("#chat-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = $("#chat-input"), prompt = input.value.trim(), projectId = state.projectId;
      if (!prompt || posting) return;
      posting = true;
      $("#send-chat").disabled = true;
      try {
        await postOfficeChat({ text: `@office-manager ${prompt}` });
        if (state.projectId === projectId) input.value = "";
        await loadOfficeChat();
      } catch (error) { showToast(error.message, true); }
      finally { posting = false; renderChat(); }
    });
    $("#chat-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        $("#chat-form").requestSubmit();
      }
    });
    $("#chat-input").addEventListener("input", resizeChatInput);

    this.update = renderChat;
    this.focusInput = () => $("#chat-input").focus();
    this.clearDraft = () => { $('#chat-input').value = ''; resizeChatInput(); };
  }
}

customElements.define("office-manager-chat", OfficeManagerChat);
export default OfficeManagerChat;
