// Apply before the first paint so a saved light theme never flashes dark.
(() => {
  const key = 'agent-office-theme';
  const themes = { terminal: { label: 'Terminal', color: '#080c0e', logo: '/assets/logo.svg' }, teams: { label: 'Teams', color: '#5055a0', logo: '/assets/logo-teams.svg' }, matrix: { label: 'Matrix', color: '#001008', logo: '/assets/logo-matrix.svg' }, sakura: { label: 'Sakura', color: '#282942', logo: '/assets/logo-sakura.svg' } };
  const normalize = value => Object.hasOwn(themes, value) ? value : 'terminal';
  function apply(value) {
    const theme = normalize(value);
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeFamily = ['teams', 'sakura'].includes(theme) ? 'modern' : 'terminal';
    const { logo, color } = themes[theme];
    document.querySelector('link[rel="icon"]').href = logo;
    document.querySelectorAll('.sidebar-logo img, .sidebar-toggle-logo').forEach((image) => {
      image.src = logo;
    });
    document.querySelector('meta[name="theme-color"]').content = color;
    document.querySelectorAll('input[name="office-theme"]').forEach((input) => {
      input.checked = input.value === theme;
    });
  }
  let saved;
  try { saved = localStorage.getItem(key); } catch { /* Storage may be disabled. */ }
  apply(saved);
  document.addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.dataset.theme);
    document.querySelectorAll('input[name="office-theme"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        apply(input.value);
        const status = document.getElementById('theme-save-status');
        try {
          localStorage.setItem(key, input.value);
          status.textContent = `${themes[input.value].label} theme saved.`;
        } catch {
          status.textContent = 'Theme applied for this visit. Browser storage is unavailable.';
        }
      });
    });
  });
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
