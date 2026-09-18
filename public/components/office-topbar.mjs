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
        this.createElement('span', { textContent: 'Kojomiki' }),
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
        this.createElement('button', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'topbar-user-menu', class: 'topbar-user', children: [
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
    const trigger = this.querySelector('.topbar-user');
    const wrapper = this.createElement('div', { class: 'topbar-user-dropdown' });
    trigger.replaceWith(wrapper);
    const menu = this.createElement('nav', { id: 'topbar-user-menu', class: 'topbar-user-menu', 'aria-label': 'User navigation', hidden: '', children:
      [['Account', '/account/profile', 'person'], ['Settings', '/settings/appearance', 'gear']].map(([label, href, icon]) =>
        this.createElement('a', { href, children: [this.icon(icon), this.createElement('span', { textContent: label })] }))
    });
    wrapper.append(trigger, menu);
    this.closeMenu = () => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
    const openMenu = () => { menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); };
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); openMenu(); menu.querySelector('a').focus(); }
    });
    wrapper.addEventListener('keydown', event => {
      if (event.key === 'Escape') { this.closeMenu(); trigger.focus(); }
    });
    wrapper.addEventListener('focusout', event => { if (!wrapper.contains(event.relatedTarget)) this.closeMenu(); });
    this.onConnect = () => {
      document.addEventListener('pointerdown', event => { if (!wrapper.contains(event.target)) this.closeMenu(); }, { signal: this.connectionSignal });
      window.addEventListener('routechange', this.closeMenu, { signal: this.connectionSignal });
    };
    menu.addEventListener('click', event => {
      const link = event.target.closest('a');
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); this.closeMenu();
      this.emit('office-navigate', { href: link.getAttribute('href') });
    });
    this.querySelector('.topbar-user').addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (menu.hidden) openMenu(); else this.closeMenu();
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
      this.querySelector('.topbar-user').setAttribute('aria-label', `${user.name} — Account and settings`);
      renderUserAvatar(this.querySelector('.topbar-avatar'), user);
    };
  }
}
customElements.define('office-topbar', OfficeTopbar);
