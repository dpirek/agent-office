import OfficeComponent from './office-component.mjs';
import { renderUserAvatar } from '../lib/user-avatars.mjs';

class OfficeTopbar extends OfficeComponent {
  static hostAttributes = { class: 'office-topbar', role: 'banner' };
  model = { user: null, query: '', collapsed: false, projects: [], projectId: 'central-office' };

  icon(name) {
    return this.createElement('svg', { width: '18', height: '18', viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true', children: [
      this.createElement('use', { href: `/assets/bootstrap-icons/bootstrap-icons.svg#${name}` }),
    ] });
  }

  render() {
    this.appendChildren(this, [
      this.createElement('button', { type: 'button', class: 'topbar-brand', 'aria-controls': 'primary-navigation', 'aria-label': 'Collapse navigation', addEventListener: { name: 'click', handler: () => this.emit('navigation-toggle') }, children: [
        this.createElement('img', { src: '/assets/logo-teams.svg', width: '28', height: '28', alt: '' }),
        this.icon('chevron-bar-left'),
        this.createElement('span', { textContent: 'Agent Office' }),
      ] }),
      this.createElement('div', { class: 'topbar-search-area', children: [
        this.createElement('div', { class: 'topbar-history', children: [
          this.createElement('button', { type: 'button', 'aria-label': 'Go back', children: [this.icon('chevron-left')], addEventListener: { name: 'click', handler: () => history.back() } }),
          this.createElement('button', { type: 'button', 'aria-label': 'Go forward', children: [this.icon('chevron-right')], addEventListener: { name: 'click', handler: () => history.forward() } }),
        ] }),
        this.createElement('form', { class: 'topbar-search', role: 'search', children: [
          this.createElement('input', { type: 'search', name: 'q', maxlength: '200', placeholder: 'Search agents, tasks, files, and more…', 'aria-label': 'Search office', autocomplete: 'off' }),
          this.createElement('button', { type: 'submit', 'aria-label': 'Search', title: 'Search', children: [this.icon('search')] }),
        ] }),
      ] }),
      this.createElement('div', { class: 'topbar-actions', children: [
        this.createElement('div', { class: 'topbar-projects', children: [
          this.createElement('select', { 'aria-label': 'Current project', addEventListener: { name: 'change', handler: event => this.emit('project-select', { id: event.target.value }) } }),
          this.createElement('button', { type: 'button', class: 'topbar-new-project', children: [this.icon('plus-lg'), this.createElement('span', { textContent: 'New project' })], addEventListener: { name: 'click', handler: () => this.emit('project-create-open') } }),
        ] }),
        this.createElement('button', { type: 'button', class: 'topbar-new', children: [this.icon('plus-lg'), this.createElement('span', { textContent: 'New task' })], addEventListener: { name: 'click', handler: () => this.emit('new-task') } }),
        this.createElement('a', { href: '/account', class: 'topbar-user', children: [
          this.createElement('span', { class: 'topbar-avatar-wrap', children: [
            this.createElement('span', { class: 'topbar-avatar', 'aria-hidden': 'true' }),
            this.createElement('i', { class: 'topbar-user-status', 'aria-hidden': 'true' }),
          ] }),
          this.createElement('span', { class: 'topbar-user-copy', children: [
            this.createElement('strong', { class: 'topbar-user-name' }),
            this.createElement('small', { textContent: 'Signed in' }),
          ] }),
        ] }),
      ] }),
    ]);
  }

  initialize() {
    const input = this.querySelector('input');
    this.querySelector('.topbar-user').addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      this.emit('office-navigate', { href: '/account' });
    });
    this.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      this.emit('office-search', { query: input.value.trim() });
    });
    this.update = () => {
      input.value = this.model.query;
      const projects = this.querySelector('.topbar-projects select');
      projects.replaceChildren(...this.model.projects.map(project => this.createElement('option', { value: project.id, textContent: project.name })));
      projects.value = this.model.projectId;
      projects.disabled = !this.model.projects.length;
      if (!this.model.projects.length) projects.append(this.createElement('option', { textContent: 'No projects' }));
      const brand = this.querySelector('.topbar-brand');
      const label = this.model.collapsed ? 'Expand navigation' : 'Collapse navigation';
      brand.setAttribute('aria-expanded', String(!this.model.collapsed));
      brand.setAttribute('aria-label', label);
      brand.title = label;
      brand.querySelector('use').setAttribute('href', `/assets/bootstrap-icons/bootstrap-icons.svg#chevron-bar-${this.model.collapsed ? 'right' : 'left'}`);
      const user = this.model.user;
      if (!user) return;
      this.querySelector('.topbar-user-name').textContent = user.name;
      this.querySelector('.topbar-user').setAttribute('aria-label', `${user.name} — Your account`);
      renderUserAvatar(this.querySelector('.topbar-avatar'), user);
    };
  }
}
customElements.define('office-topbar', OfficeTopbar);
