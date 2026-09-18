// Apply before the first paint so a saved light theme never flashes dark.
(() => {
  const key = 'agent-office-theme';
  const themes = {
    grog: { label: 'Grog', color: '#100f0b', logo: '/assets/logo-grog.svg' },
    terminal: { label: 'Terminal', color: '#080c0e', logo: '/assets/logo.svg' },
    teams: { label: 'Teams', color: '#5055a0', logo: '/assets/logo-teams.svg' },
    matrix: { label: 'Matrix', color: '#001008', logo: '/assets/logo-matrix.svg' },
    sakura: { label: 'Japanese · Sakura', color: '#282942', logo: '/assets/kojomiki-icon.svg' },
  };
  const normalize = value => Object.hasOwn(themes, value) ? value : 'sakura';
  function apply(value) {
    const theme = normalize(value);
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeFamily = ['teams', 'sakura'].includes(theme) ? 'modern' : 'terminal';
    const { logo, color } = themes[theme];
    document.querySelector('link[rel="icon"]').href = logo;
    document.querySelector('link[rel="icon"]').type = "image/svg+xml";
    document.querySelector('meta[name="theme-color"]').content = color;
    window.dispatchEvent(new CustomEvent('office-theme-change', { detail: { value: theme, logo, label: themes[theme].label } }));
  }
  let saved;
  try { saved = localStorage.getItem(key); } catch { /* Storage may be disabled. */ }
  apply(saved);
  window.addEventListener('office-theme-select', ({ detail }) => {
    apply(detail.value);
    let saved = true;
    try { localStorage.setItem(key, normalize(detail.value)); } catch { saved = false; }
    window.dispatchEvent(new CustomEvent('office-theme-saved', { detail: { saved, label: themes[normalize(detail.value)].label } }));
  });
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
