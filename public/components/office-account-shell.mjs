import OfficeComponent from './office-component.mjs';
import './office-navigation.mjs';
import './office-toast.mjs';
import { fetchJson } from './office-format.mjs';

class OfficeAccountShell extends OfficeComponent {
  model = { user: null };

  render() {
    const account = this.querySelector('.account-layout');
    this.append(this.createElement('div', { class: 'app-frame', children: [
      this.createElement('div', { class: 'workspace', children: [
        this.createElement('office-navigation'),
        this.createElement('div', { class: 'project-content account-content-area', children: [account] }),
      ] }),
      this.createElement('office-toast'),
    ] }));
  }

  initialize() {
    const navigation = this.querySelector('office-navigation');
    let projects = [{ id: 'central-office', name: 'Central Office' }];
    let projectId = 'central-office';
    try { projectId = localStorage.getItem('office-project') || projectId; } catch { /* Use the default project. */ }
    const update = () => { navigation.data = { projects, projectId, page: 'account' }; };
    const selectProject = id => {
      projectId = id;
      try { localStorage.setItem('office-project', id); } catch { /* Navigation still works without storage. */ }
      update();
    };
    this.addEventListener('office-navigate', ({ detail }) => location.assign(detail.href));
    this.addEventListener('project-select', ({ detail }) => selectProject(detail.id));
    this.addEventListener('office-notify', ({ detail }) => this.querySelector('office-toast').show(detail.message, detail.error));
    this.addEventListener('project-create', ({ detail }) => {
      detail.respondWith((async () => {
        const response = await fetch('/api/projects', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: detail.name, description: detail.description }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        projects = (await fetchJson('/api/projects')).projects;
        selectProject(data.project.id);
        return data.project;
      })());
    });
    update();
    this.load = async () => {
      if (this.model.user?.role === 'pending') return;
      await Promise.allSettled([
        fetchJson('/api/projects').then(data => {
          projects = data.projects;
          if (!projects.some(project => project.id === projectId)) projectId = 'central-office';
          update();
        }),
        fetchJson('/api/health').then(health => {
          navigation.data = { online: true, context: `v${health.version || '0.0.0'} · Workspace ${health.workspace || '—'}` };
        }),
      ]);
    };
    void this.load();
  }
}
customElements.define('office-account-shell', OfficeAccountShell);
