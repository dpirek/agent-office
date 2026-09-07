function normalizePath(value) {
  const raw = String(value || "/").split(/[?#]/, 1)[0] || "/";
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function compileRoute(path) {
  const keys = [];
  const pattern = normalizePath(path).split("/").map((part) => {
    if (!part.startsWith(":")) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    keys.push(part.slice(1));
    return "([^/]+)";
  }).join("/");
  return { keys, regex: new RegExp(`^${pattern}$`) };
}

class Router {
  constructor({ fallback = "/dashboard" } = {}) {
    this.routes = [];
    this.fallback = normalizePath(fallback);
    this.current = null;
    this.onPopState = () => this.dispatch(window.location.pathname, { source: "popstate" });
  }

  addRoute(path, handler) {
    if (typeof handler !== "function") throw new TypeError("Route handler must be a function.");
    const normalized = normalizePath(path);
    this.routes.push({ path: normalized, handler, ...compileRoute(normalized) });
    return this;
  }

  match(path) {
    const normalized = normalizePath(path);
    for (const route of this.routes) {
      const match = route.regex.exec(normalized);
      if (!match) continue;
      try {
        const params = Object.fromEntries(route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]));
        return { ...route, params, pathname: normalized };
      } catch {
        return null;
      }
    }
    return null;
  }

  dispatch(path = window.location.pathname, context = {}) {
    const requested = normalizePath(path);
    const match = this.match(requested) || this.match(this.fallback);
    if (!match) return false;
    this.current = match.pathname;
    match.handler(match.params, { ...context, pathname: match.pathname, requestedPath: requested });
    window.dispatchEvent(new CustomEvent("routechange", { detail: { pathname: match.pathname, params: match.params } }));
    return true;
  }

  navigate(path, { replace = false, state = null } = {}) {
    const destination = normalizePath(path);
    const target = this.match(destination) ? destination : this.fallback;
    if (window.location.pathname !== target) {
      window.history[replace ? "replaceState" : "pushState"](state, "", target);
    }
    return this.dispatch(target, { source: replace ? "replace" : "navigate" });
  }

  start() {
    window.addEventListener("popstate", this.onPopState);
    const path = normalizePath(window.location.pathname);
    if (!this.match(path)) return this.navigate(this.fallback, { replace: true });
    return this.dispatch(path, { source: "startup" });
  }

  destroy() {
    window.removeEventListener("popstate", this.onPopState);
  }
}

export { Router, normalizePath };
export default Router;
