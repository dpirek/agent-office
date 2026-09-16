import './office-add-member.mjs';
import { renderUserAvatar } from '../lib/user-avatars.mjs';
import OfficeComponent from "./office-component.mjs";
import { escapeHtml, shortTime, officeSprite } from "./office-format.mjs";
import { renderChatArtifacts, renderMarkdown } from "../lib/markdown.mjs";
import { appendUniqueMention } from "../lib/mentions.mjs";
import { initChatComposer } from "../lib/chat-composer.mjs";

class OfficeChat extends OfficeComponent {
  static hostAttributes = {"class": "panel office-chat-page"};
  model = { projects: [], projectId: "central-office", officeChatMessages: [], officeChatMembers: [], chatRunning: false };

  render() {
    this.appendChildren(this, [
      this.createElement("header", { "class": "panel-header", children: [
        this.createElement("div", { children: [
          this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#chat-dots" })
          ] }),
          this.createElement("h2", { "id": "project-chat-title", textContent: "CENTRAL OFFICE" })
        ] }),
        this.createElement("span", { "class": "panel-meta", "id": "office-chat-status", textContent: "LIVE CHANNEL" })
      ] }),
      this.createElement("div", { "class": "office-chat-layout panel-body", children: [
        this.createElement("aside", { "class": "office-chat-sidebar", children: [
          this.createElement("h3", { "id": "project-list-heading", "class": "project-list-heading", textContent: "Projects" }),
          this.createElement("nav", { "id": "project-chat-rooms", "aria-labelledby": "project-list-heading" }),
          this.createElement("h3", { textContent: "PEOPLE" }),
          this.createElement("div", { "class": "office-chat-members", "id": "office-chat-members" }),
          this.createElement('button', { type: 'button', class: 'chat-add-member', textContent: 'Add member', addEventListener: { name: 'click', handler: () => this.querySelector('office-add-member').open() }, children: [
            this.createElement('svg', { width: '18', height: '18', viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true', children: [this.createElement('use', { href: '/assets/bootstrap-icons/bootstrap-icons.svg#person-plus' })] })
          ] }),
          this.createElement('office-add-member')
        ] }),
        this.createElement("section", { "class": "office-chat-main", children: [
          this.createElement("header", { "class": "office-chat-heading", children: [
            this.createElement("div", { children: [
              this.createElement("strong", { "id": "project-room-heading", textContent: "# central-office" }),
              this.createElement("span", { textContent: "Project chat, tasks, and files" })
            ] }),
            this.createElement("span", { "id": "office-chat-member-count", textContent: "1 MEMBER" })
          ] }),
          this.createElement("div", { "class": "office-board-messages", "id": "office-board-messages", "aria-live": "polite" }),
          this.createElement("form", { "class": "office-board-composer", "id": "office-board-form", children: [
            this.createElement('div', { class: 'chat-reply-context', hidden: '', children: [
              this.createElement('span', { id: 'chat-reply-preview', role: 'status' }),
              this.createElement('button', { type: 'button', id: 'chat-reply-cancel', 'aria-label': 'Cancel thread reply', textContent: '×' })
            ] }),
            this.createElement("textarea", { "id": "office-board-input", "rows": "1", "maxlength": "100000", "required": "", "placeholder": "Message #central-office · use @office-manager or @agent-name", "aria-label": "Message central office" }),
            this.createElement("div", { "class": "composer-toolbar", children: [
              this.createElement("div", { "class": "composer-tools", "aria-label": "Message tools", children: [
                this.createElement("button", { "type": "button", "data-composer-format": "**", "aria-label": "Bold text", "title": "Bold text", children: [
                  this.createElement("svg", { "class": "bi", "width": "22", "height": "22", "viewBox": "0 0 16 16", "aria-hidden": "true", "focusable": "false", children: [
                    this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#type-bold" })
                  ] })
                ] }),
                this.createElement("button", { "type": "button", "data-composer-format": "_", "aria-label": "Italic text", "title": "Italic text", children: [
                  this.createElement("svg", { "class": "bi", "width": "22", "height": "22", "viewBox": "0 0 16 16", "aria-hidden": "true", "focusable": "false", children: [
                    this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#type-italic" })
                  ] })
                ] }),
                this.createElement("button", { "type": "button", "data-composer-format": "`", "aria-label": "Inline code", "title": "Inline code", children: [
                  this.createElement("svg", { "class": "bi", "width": "22", "height": "22", "viewBox": "0 0 16 16", "aria-hidden": "true", "focusable": "false", children: [
                    this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#code" })
                  ] })
                ] }),
                this.createElement("button", { "type": "button", "id": "composer-emoji-toggle", "aria-label": "Choose an emoji", "title": "Emoji", "aria-expanded": "false", "aria-controls": "composer-emoji-picker", children: [
                  this.createElement("svg", { "class": "bi", "width": "22", "height": "22", "viewBox": "0 0 16 16", "aria-hidden": "true", "focusable": "false", children: [
                    this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#emoji-smile" })
                  ] })
                ] }),
                this.createElement("button", { "type": "button", "id": "composer-mention", "aria-label": "Mention someone", "title": "Mention someone", children: [
                  this.createElement("svg", { "class": "bi", "width": "22", "height": "22", "viewBox": "0 0 16 16", "aria-hidden": "true", "focusable": "false", children: [
                    this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#at" })
                  ] })
                ] })
              ] }),
              this.createElement("button", { "class": "primary chat-send-button", "id": "office-board-send", "type": "submit", "aria-label": "Send message", "title": "Send message", children: [
                this.createElement("svg", { "class": "bi", "width": "22", "height": "22", "viewBox": "0 0 16 16", "aria-hidden": "true", "focusable": "false", children: [
                  this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#send" })
                ] }),
                this.createElement("span", { "class": "composer-send-label", textContent: "SEND" })
              ] })
            ] }),
            this.createElement("div", { "class": "composer-emoji-picker", "id": "composer-emoji-picker", "role": "group", "aria-label": "Choose an emoji", "hidden": "", children: [
              this.createElement("strong", { textContent: "Smilies and people" }),
              this.createElement("div", { children: [
                this.createElement("button", { "type": "button", "data-emoji": "😀", "aria-label": "Grinning face", textContent: "😀" }),
                this.createElement("button", { "type": "button", "data-emoji": "😂", "aria-label": "Tears of joy", textContent: "😂" }),
                this.createElement("button", { "type": "button", "data-emoji": "😅", "aria-label": "Grinning with sweat", textContent: "😅" }),
                this.createElement("button", { "type": "button", "data-emoji": "😍", "aria-label": "Heart eyes", textContent: "😍" }),
                this.createElement("button", { "type": "button", "data-emoji": "👍", "aria-label": "Thumbs up", textContent: "👍" }),
                this.createElement("button", { "type": "button", "data-emoji": "🎉", "aria-label": "Celebration", textContent: "🎉" }),
                this.createElement("button", { "type": "button", "data-emoji": "❤️", "aria-label": "Heart", textContent: "❤️" }),
                this.createElement("button", { "type": "button", "data-emoji": "👋", "aria-label": "Wave", textContent: "👋" })
              ] })
            ] })
          ] })
        ] })
      ] })
    ]);
  }

  initialize() {
    this.enableFileLinks();
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);
    const $$ = (selector, root = this) => [...root.querySelectorAll(selector)];
    const showToast = (message, error = false) => this.emit("office-notify", { message, error });
    let replyToId = null;
    const setReply = message => {
      replyToId = message?.id || null;
      $('.chat-reply-context').hidden = !message;
      $('#chat-reply-preview').textContent = message ? `Replying to ${message.author}: ${message.text.slice(0, 180)}` : '';
      resizeOfficeBoardInput();
    };
    $('#chat-reply-cancel').addEventListener('click', () => { setReply(null); $('#office-board-input').focus(); });
    $('#office-board-messages').addEventListener('click', event => {
      const action = event.target.closest('[data-reply-to]');
      if (!action) return;
      const message = state.officeChatMessages.find(item => item.id === action.dataset.replyTo);
      if (message) { setReply(message); $('#office-board-input').focus(); }
    });
    function chatAvatar(message) {
      if (message.kind === "user") {
        return `<svg class="human-avatar-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="3.25"></circle><path d="M5.5 20v-2.2c0-3.7 2.9-6.3 6.5-6.3s6.5 2.6 6.5 6.3V20z"></path></svg>`;
      }
      const memberIndex = state.officeChatMembers.findIndex((member) => member.username === message.username);
      const member = state.officeChatMembers[memberIndex];
      const agent = {
        name: message.author,
        role: member?.description || "",
        internal: message.username === "office-manager",
      };
      const sprite = officeSprite(agent, Math.max(1, memberIndex));
      return `<img class="agent-avatar-sprite" src="/assets/avatars/${sprite}.png" alt="" draggable="false">`;
    }

    const renderMembers = () => {
      $('#office-chat-members').replaceChildren(...state.officeChatMembers.map((member, index) => {
        const sprite = officeSprite({ name: member.name, role: member.description || '', internal: member.username === 'office-manager' }, Math.max(1, index));
        const avatar = this.createElement('span', { class: 'office-chat-member-avatar', 'aria-hidden': 'true' });
        if (member.type === 'human') renderUserAvatar(avatar, member);
        else avatar.append(this.createElement('img', { src: `/assets/avatars/${sprite}.png`, alt: '', draggable: 'false', width: '28', height: '28' }));
        avatar.append(this.createElement('i', { class: 'office-chat-member-status' }));
        return this.createElement('button', {
          class: 'office-chat-member', type: 'button',
          'data-username': member.username, 'data-status': member.status,
          title: `Mention @${member.username} · ${member.status}`,
          'aria-label': `${member.name}, ${member.status}. Mention @${member.username}`,
          children: [
            avatar,
            this.createElement('span', { class: 'office-chat-member-name', children: [
              this.createElement('strong', { textContent: member.name }),
              ['is typing', 'busy'].includes(member.status) ? this.createElement('em', { textContent: member.status }) : null,
            ] }),
          ],
        });
      }));
    };

    function renderOfficeChat({ preserveScroll = false } = {}) {
      renderMembers();
      $("#office-chat-member-count").textContent = `${state.officeChatMembers.length} MEMBER${state.officeChatMembers.length === 1 ? "" : "S"}`;

      const board = $("#office-board-messages");
      const wasAtBottom = board.scrollHeight - board.scrollTop - board.clientHeight < 70;
      const byId = new Map(state.officeChatMessages.map(message => [message.id, message]));
      const children = new Map();
      for (const message of state.officeChatMessages) {
        const parent = byId.has(message.replyToId) ? message.replyToId : null;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(message);
      }
      const messages = [];
      const visit = parent => { for (const message of children.get(parent) || []) { messages.push(message); visit(message.id); } };
      visit(null);
      const nextOfficeBoardMarkup = messages.length ? messages.map((message) => `
        <article data-message-id="${escapeHtml(message.id)}" class="office-board-message ${message.replyToId ? "thread-reply " : ""}${escapeHtml(message.kind)}${message.streaming ? " streaming" : ""}">
          <div class="office-board-avatar"${message.kind === "user" ? ` title="You · Human"` : ""}>${chatAvatar(message)}</div>
          <div class="office-board-message-body">
            <div class="office-board-message-meta"><strong>${escapeHtml(message.author)}</strong><span>@${escapeHtml(message.username)} · ${shortTime(message.createdAt)}</span></div>
            ${message.replyToId ? `<div class="chat-thread-parent">Reply to ${escapeHtml(byId.get(message.replyToId)?.author || 'earlier message')}: ${escapeHtml((byId.get(message.replyToId)?.text || '').slice(0, 140))}</div>` : ''}
            <div class="office-board-message-text markdown-body">${renderMarkdown(message.text)}</div>
            ${!message.streaming ? `<button type="button" class="chat-thread-action" data-reply-to="${escapeHtml(message.id)}"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><use href="/assets/bootstrap-icons/bootstrap-icons.svg#reply"></use></svg> Reply to thread</button>` : ''}
            ${message.artifacts?.length ? `<div class="office-board-artifacts">${renderChatArtifacts(message.artifacts)}</div>` : ""}
          </div>
        </article>`).join("") : `<div class="office-board-empty"><strong># ${escapeHtml(state.projects.find((project) => project.id === state.projectId)?.name.toUpperCase() || "CENTRAL OFFICE")} IS READY</strong><span>Mention @office-manager or a registered agent to begin.</span></div>`;
      const messagesChanged = nextOfficeBoardMarkup !== officeBoardMarkup;
      if (messagesChanged) {
        board.innerHTML = nextOfficeBoardMarkup;
        officeBoardMarkup = nextOfficeBoardMarkup;
      }
      const followLatest = document.body.dataset.page === "chat" && window.matchMedia("(max-width: 1100px)").matches;
      if (messagesChanged && (followLatest || !preserveScroll || wasAtBottom)) scrollOfficeChatToLatest();
      $("#office-chat-status").textContent = "LIVE CHANNEL";
    }

    function scrollOfficeChatToLatest() {
      const board = $("#office-board-messages");
      if (!board) return;
      const scroll = () => { board.scrollTop = board.scrollHeight; };
      requestAnimationFrame(scroll);
      $$("img", board).forEach((image) => {
        if (!image.complete) image.addEventListener("load", scroll, { once: true });
      });
    }

    function resizeOfficeBoardInput() {
      const input = $("#office-board-input");
      input.style.height = "31px";
      input.style.height = `${Math.min(130, Math.max(31, input.scrollHeight))}px`;
      requestAnimationFrame(syncOfficeBoardComposerHeight);
    }

    function syncOfficeBoardComposerHeight() {
      const composer = $("#office-board-form");
      if (!composer) return;
      document.documentElement.style.setProperty("--office-board-composer-height", `${composer.offsetHeight}px`);
      if (document.body.dataset.page === "chat" && window.matchMedia("(max-width: 1100px)").matches) scrollOfficeChatToLatest();
    }

    let officeBoardMarkup = null;
    let posting = false;
    const postOfficeChat = payload => this.request('chat-send', payload);
    const loadOfficeChat = () => this.request('chat-refresh');
    $("#office-board-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = $("#office-board-input");
      const prompt = input.value.trim();
      if (!prompt || posting) return;
      if (state.chatRunning) {
        showToast("Wait for the office manager's current response to finish.");
        return;
      }
      const sendButton = $("#office-board-send");
      posting = true;
      sendButton.disabled = true;
      try {
        const result = await postOfficeChat({ text: prompt, replyToId });
        if (state.projectId === result.message.projectId) { input.value = ""; setReply(null); }
        resizeOfficeBoardInput();
        await loadOfficeChat({ quiet: true });
        const failed = result.dispatches?.filter((dispatch) => !dispatch.ok) || [];
        if (failed.length) showToast(failed.map((dispatch) => dispatch.error).join(" · "), true);
        if (result.managerMentioned) showToast("Office manager notified.");
      } catch (error) {
        showToast(error.message, true);
      } finally {
        posting = false;
        sendButton.disabled = false;
      }
    });
    $("#office-board-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        $("#office-board-form").requestSubmit();
      }
    });
    $("#office-board-input").addEventListener("input", resizeOfficeBoardInput);
    $("#office-chat-members").addEventListener("click", (event) => {
      const member = event.target.closest(".office-chat-member[data-username]");
      if (!member) return;
      const input = $("#office-board-input");
      input.value = appendUniqueMention(input.value, member.dataset.username);
      resizeOfficeBoardInput();
      input.focus();
    });

    $('#project-chat-rooms').addEventListener('click', event => {
      const room = event.target.closest('[data-project-id]');
      if (room) this.emit('project-select', { id: room.dataset.projectId });
    });
    this.update = () => {
      $('office-add-member').data = { projectId: state.projectId, userRole: state.userRole, workerTokenName: state.workerTokenName };
      const project = state.projects.find(entry => entry.id === state.projectId);
      if (project) {
        $('#project-chat-title').textContent = project.name.toUpperCase();
        $('#project-chat-rooms').innerHTML = state.projects.map(entry => `<button class="office-chat-channel project-room${entry.id === project.id ? ' active' : ''}" type="button" data-project-id="${escapeHtml(entry.id)}" ${entry.id === project.id ? 'aria-current="true"' : ''}><span>#</span><strong>${escapeHtml(entry.name)}</strong></button>`).join('');
        $('#project-room-heading').textContent = `# ${project.name}`;
        $('#office-board-input').placeholder = `Message #${project.name} · use @name`;
      }
      renderOfficeChat({ preserveScroll: true });
    };
    this.clearDraft = () => { setReply(null); $('#office-board-input').value = ''; resizeOfficeBoardInput(); };
    this.syncComposer = syncOfficeBoardComposerHeight;
    this.onConnect = () => {
      initChatComposer({ root: this, signal: this.connectionSignal });
      window.addEventListener('resize', syncOfficeBoardComposerHeight, { signal: this.connectionSignal });
      window.visualViewport?.addEventListener('resize', syncOfficeBoardComposerHeight, { signal: this.connectionSignal });
      syncOfficeBoardComposerHeight();
    };
  }
}

customElements.define("office-chat", OfficeChat);
export default OfficeChat;
