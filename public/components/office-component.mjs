import BaseComponent from './base-component.js';
import { normalizeFileUrl } from '../lib/file-url.mjs';

// Light DOM preserves the office theme and native form accessibility.
export default class OfficeComponent extends BaseComponent {
  static observedAttributes = ["project-id"];
  #initialized = false;
  #connection;

  connectedCallback() {
    if (!this.#initialized) {
      for (const [name, value] of Object.entries(this.constructor.hostAttributes || {})) {
        if (!this.hasAttribute(name)) this.setAttribute(name, value);
      }
      this.render();
      this.initialize();
      this.#initialized = true;
    }
    this.#connection?.abort();
    this.#connection = new AbortController();
    this.onConnect?.();
    this.update?.();
  }

  disconnectedCallback() {
    this.#connection?.abort();
    this.onDisconnect?.();
  }

  get projectId() { return this.getAttribute('project-id') || this.model.projectId || 'central-office'; }
  set projectId(value) { this.setAttribute('project-id', value); }
  attributeChangedCallback(name, previous, value) {
    if (name === 'project-id' && previous !== value) {
      this.model.projectId = value || 'central-office';
      if (this.#initialized) this.update?.();
    }
  }

  get connectionSignal() { return this.#connection.signal; }
  get data() { return { ...this.model }; }
  set data(value) {
    Object.assign(this.model, value);
    if (value.projectId && this.getAttribute('project-id') !== value.projectId) {
      this.projectId = value.projectId;
      return;
    }
    if (this.#initialized) this.update?.();
  }

  deactivate() {
    this.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  }

  enableFileLinks() {
    this.addEventListener('click', event => {
      const link = event.target.closest('a[href]');
      if (!link || !this.contains(link) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const href = normalizeFileUrl(link.getAttribute('href'));
      if (!href.startsWith('/files/')) return;
      event.preventDefault();
      this.emit('file-open', { href });
    });
  }

  // The coordinator responds synchronously with a promise; components own
  // pending/error UI and never need access to another component's DOM.
  request(name, payload = {}) {
    let response;
    let handled = false;
    this.emit(name, {
      ...payload,
      respondWith(value) { handled = true; response = value; },
    });
    return handled ? Promise.resolve(response) : Promise.reject(new Error(`No handler for ${name}`));
  }
}
