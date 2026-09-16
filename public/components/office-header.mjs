// Coordinate the shared header through the navigation component's public API.
export function bindOfficeHeader(shell, defaultVisible = () => false) {
  const header = shell.querySelector('office-topbar');
  const navigation = shell.querySelector('office-navigation');
  shell.addEventListener('navigation-toggle', () => navigation.toggle());
  shell.addEventListener('sidebar-toggle', ({ detail }) => {
    header.data = { collapsed: detail.collapsed };
  });
  return () => {
    const visible = document.documentElement.dataset.theme === 'teams' || defaultVisible();
    header.hidden = !visible;
    header.data = { collapsed: navigation.collapsed };
    shell.classList.toggle('has-topbar', visible);
  };
}
