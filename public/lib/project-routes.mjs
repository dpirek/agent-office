export const PROJECT_PAGES = new Set(["dashboard", "chat", "tasks", "workspace"]);

export function projectPagePath(section, projectId = "central-office") {
  return PROJECT_PAGES.has(section) ? `/${encodeURIComponent(projectId)}/${section}` : `/${section}`;
}

export function projectIdFromPath(pathname) {
  const match = /^\/([^/]+)\/(dashboard|chat|tasks|workspace)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]);
    return /^[A-Za-z0-9-]+$/.test(id) ? id : null;
  } catch { return null; }
}

export function registerProjectRoutes(router, { pages, getProjectId, selectProject, renderPage }) {
  router.addRoute("/", () => router.navigate(projectPagePath("dashboard", getProjectId()), { replace: true }));
  for (const [section, page] of Object.entries(pages)) {
    if (!PROJECT_PAGES.has(section)) {
      router.addRoute(page.path, () => renderPage(section));
      continue;
    }
    router.addRoute(page.path, () => router.navigate(projectPagePath(section, getProjectId()), { replace: true }));
    router.addRoute(`/:projectId/${section}`, ({ projectId }) => {
      const selected = selectProject(projectId);
      const canonical = projectPagePath(section, selected);
      if (window.location.pathname !== canonical) {
        router.navigate(canonical, { replace: true });
        return;
      }
      renderPage(section);
    });
  }
}
