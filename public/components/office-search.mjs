import OfficeComponent from './office-component.mjs';
import { loadOfficeSearch, searchOfficeData } from '../lib/office-search.mjs';

class OfficeSearch extends OfficeComponent {
  static hostAttributes = { class: 'office-search-page' };
  model = {};
  render() {
    this.appendChildren(this, [
      this.createElement('header', { class: 'search-heading', children: [
        this.createElement('span', { class: 'search-eyebrow', textContent: 'YOUR OFFICE' }),
        this.createElement('h1', { textContent: 'Search' }),
        this.createElement('p', { class: 'search-scope' }),
      ] }),
      this.createElement('div', { class: 'search-filters', role: 'group', 'aria-label': 'Filter search results', children: ['All', 'Agents', 'Tasks', 'Files', 'Operations', 'Skills'].map(type => this.createElement('button', { type: 'button', 'data-type': type, 'aria-pressed': String(type === 'All'), textContent: type })) }),
      this.createElement('p', { class: 'search-status', role: 'status', 'aria-live': 'polite' }),
      this.createElement('div', { class: 'search-results' }),
    ]);
  }
  initialize() {
    let controller, revision = 0, results = [], filter = 'All', unavailable = [], query = '';
    const status = this.querySelector('.search-status');
    const list = this.querySelector('.search-results');
    const show = () => {
      const visible = filter === 'All' ? results : results.filter(item => item.type === filter);
      this.querySelectorAll('[data-type]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.type === filter));
        const count = button.dataset.type === 'All' ? results.length : results.filter(item => item.type === button.dataset.type).length;
        button.textContent = `${button.dataset.type} (${count})`;
      });
      status.textContent = !query ? 'Enter a search above to find something in your office.' : `${visible.length} result${visible.length === 1 ? '' : 's'}${unavailable.length ? `. Could not search ${unavailable.join(', ')}. Try again.` : ''}`;
      list.replaceChildren(...visible.slice(0, 200).map(item => {
        const link = this.createElement('a', { class: 'search-result', href: item.href, children: [
          this.createElement('span', { class: 'search-result-type', textContent: item.type }),
          this.createElement('strong', { textContent: item.title }),
          this.createElement('span', { class: 'search-result-description', textContent: item.description }),
          this.createElement('span', { class: 'search-result-open', 'aria-hidden': 'true', textContent: '→' }),
        ] });
        link.addEventListener('click', event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); this.emit('search-result-open', item);
        });
        return link;
      }));
      if (visible.length > 200) list.append(this.createElement('p', { textContent: 'Showing the first 200 matches. Refine your search to see more.' }));
      if (query && !visible.length) list.append(this.createElement('div', { class: 'search-empty', children: [
        this.createElement('strong', { textContent: unavailable.length === 5 ? 'Search is unavailable' : 'No matches found' }),
        this.createElement('p', { textContent: 'Try another name, keyword, or result type.' }),
      ] }));
    };
    this.querySelector('.search-filters').addEventListener('click', event => {
      const button = event.target.closest('[data-type]');
      if (button) { filter = button.dataset.type; show(); }
    });
    this.search = async (value, projectId, projectName) => {
      controller?.abort(); controller = new AbortController(); const request = ++revision;
      query = value.trim().slice(0, 200); filter = 'All'; results = []; unavailable = [];
      this.querySelector('h1').textContent = query ? `Results for “${query}”` : 'Search your office';
      this.querySelector('.search-scope').textContent = `${projectName} · Project tasks, file names, and operations, plus office agents and skills`;
      show();
      if (!query) { this.removeAttribute('aria-busy'); return; }
      status.textContent = 'Searching…'; this.setAttribute('aria-busy', 'true');
      try {
        const loaded = await loadOfficeSearch(projectId, { signal: controller.signal });
        if (request !== revision) return;
        unavailable = loaded.unavailable; results = searchOfficeData(query, loaded.data, projectId); show();
      } catch (error) {
        if (error.name !== 'AbortError' && request === revision) status.textContent = 'Search failed. Please try again.';
      } finally { if (request === revision) this.removeAttribute('aria-busy'); }
    };
    this.onDisconnect = () => { revision++; controller?.abort(); this.removeAttribute('aria-busy'); };
  }
  deactivate() { super.deactivate(); this.onDisconnect?.(); }
}
customElements.define('office-search', OfficeSearch);
