import { renderAccount } from './account.mjs';

void renderAccount(document.querySelector('#account-view'), {
  mode: location.pathname.replace(/\/$/, '').replace(/\.html$/, '') === '/register' ? 'register' : 'login',
  onAuthenticated: (_user, projectId) => location.replace(projectId ? `/${encodeURIComponent(projectId)}/chat` : '/'),
});
