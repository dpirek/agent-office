import OfficeComponent from "./office-component.mjs";
import { renderDashboardOfficeChatMessages } from "../lib/dashboard-office-chat.mjs";

class OfficeDashboardChat extends OfficeComponent {
  static hostAttributes = {"class": "panel dashboard-office-chat-panel"};
  model = { messages: [], projectId: "central-office", projectName: "Central Office" };

  render() {
    this.appendChildren(this, [
      this.createElement("header", { "class": "panel-header", children: [
        this.createElement("div", { children: [
          this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#chat-dots" })
          ] }),
          this.createElement("h2", { textContent: "OFFICE CHAT" })
        ] }),
        this.createElement("span", { "class": "panel-meta", "id": "dashboard-office-chat-status", textContent: "LIVE FEED" })
      ] }),
      this.createElement("div", { "class": "office-board-messages dashboard-office-board-messages panel-body", "id": "dashboard-office-board-messages", "aria-live": "polite" }),
      this.createElement("form", { "class": "dashboard-office-chat-composer panel-body", "id": "dashboard-office-chat-form", children: [
        this.createElement("textarea", { "id": "dashboard-office-chat-input", "rows": "1", "maxlength": "100000", "required": "", "placeholder": "Message #central-office · use @name", "aria-label": "Message central office from dashboard" }),
        this.createElement("button", { "class": "primary chat-send-button", "id": "dashboard-office-chat-send", "type": "submit", textContent: "SEND" })
      ] })
    ]);
  }

  initialize() {
    this.enableFileLinks();
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);
    const showToast = (message, error = false) => this.emit("office-notify", { message, error });

    let markup = null;
    let posting = false;
    const input = $('#dashboard-office-chat-input');
    const board = $('#dashboard-office-board-messages');
    const form = $('#dashboard-office-chat-form');
    const status = $('#dashboard-office-chat-status');
    const send = $('#dashboard-office-chat-send');
    const resize = () => {
      input.style.height = '34px';
      input.style.height = `${Math.min(96, Math.max(34, input.scrollHeight))}px`;
      input.style.overflowY = input.scrollHeight > 96 ? 'auto' : 'hidden';
    };
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const text = input.value.trim(), projectId = state.projectId;
      if (!text || posting) return;
      posting = true;
      send.disabled = input.disabled = true;
      status.textContent = 'SENDING…';
      try {
        await this.request('chat-send', { text });
        if (state.projectId === projectId) input.value = '';
        resize();
        await this.request('chat-refresh');
        status.textContent = 'LIVE FEED';
      } catch (error) { status.textContent = 'SEND FAILED'; showToast(error.message, true); }
      finally { posting = false; send.disabled = input.disabled = false; input.focus(); }
    });
    input.addEventListener('input', resize);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    });
    this.clearDraft = () => { input.value = ''; resize(); };
    this.update = () => {
      input.placeholder = `Message #${state.projectName} · use @name`;
      const next = renderDashboardOfficeChatMessages(state.messages);
      if (next === markup) return;
      board.innerHTML = markup = next;
      const scroll = () => { board.scrollTop = board.scrollHeight; };
      requestAnimationFrame(scroll);
      board.querySelectorAll('img').forEach(image => { if (!image.complete) image.addEventListener('load', scroll, { once: true }); });
    };
  }
}

customElements.define("office-dashboard-chat", OfficeDashboardChat);
export default OfficeDashboardChat;
