import assert from "node:assert/strict";
import test from "node:test";
import Router from "../public/lib/router.mjs";
import { projectIdFromPath, projectPagePath, registerProjectRoutes } from "../public/lib/project-routes.mjs";
import { serveStatic } from "../lib/response.js";
import { fileURLToPath } from "node:url";

test("project routing handles deep links, legacy links, switching projects and browser history", (t) => {
  const originalWindow = globalThis.window;
  const originalEvent = globalThis.CustomEvent;
  const events = new Map();
  const history = [];
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  globalThis.window = {
    location: { pathname: "/beta/workspace" },
    history: {
      pushState(_state, _title, path) { history.push(path); window.location.pathname = path; },
      replaceState(_state, _title, path) { window.location.pathname = path; },
    },
    addEventListener: (type, callback) => events.set(type, callback),
    removeEventListener: (type) => events.delete(type),
    dispatchEvent() {},
  };
  t.after(() => { globalThis.window = originalWindow; globalThis.CustomEvent = originalEvent; });
  let project = "alpha";
  let page;
  const router = new Router();
  registerProjectRoutes(router, {
    pages: Object.fromEntries(["dashboard", "workspace", "chat", "tasks", "settings"].map((section) => [section, { path: `/${section}` }])),
    getProjectId: () => project,
    selectProject: (id) => { project = ["alpha", "beta", "central-office"].includes(id) ? id : "central-office"; return project; },
    renderPage: (section) => { page = section; },
  });
  router.start();
  assert.equal(project, "beta");
  assert.equal(page, "workspace");
  router.navigate("/tasks");
  assert.equal(window.location.pathname, "/beta/tasks");
  router.navigate(projectPagePath(page, "alpha"));
  assert.equal(project, "alpha");
  assert.equal(window.location.pathname, "/alpha/tasks");
  window.location.pathname = "/beta/workspace";
  events.get("popstate")();
  assert.equal(project, "beta");
  assert.equal(page, "workspace");
  router.navigate("/settings");
  assert.equal(window.location.pathname, "/settings");
  assert.equal(project, "beta");
  router.navigate("/missing/chat");
  assert.equal(window.location.pathname, "/central-office/chat");
  assert.equal(page, "chat");
  router.navigate("/");
  assert.equal(window.location.pathname, "/central-office/dashboard");
  assert.ok(history.includes("/alpha/tasks"));
  router.destroy();
});

test("project path helpers distinguish project pages from office-wide pages", () => {
  assert.equal(projectIdFromPath("/beta/workspace"), "beta");
  assert.equal(projectIdFromPath("/beta/chat/"), "beta");
  assert.equal(projectIdFromPath("/workspace"), null);
  assert.equal(projectIdFromPath("/beta/settings"), null);
  assert.equal(projectIdFromPath("/%2F/workspace"), null);
  assert.equal(projectPagePath("tasks", "beta"), "/beta/tasks");
  assert.equal(projectPagePath("settings", "beta"), "/settings");
});

test("the server serves the app shell for a direct project workspace URL", async () => {
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  await serveStatic({ method: "GET", url: "/alpha/workspace", headers: { host: "office.test" } }, response, fileURLToPath(new URL("../public", import.meta.url)));
  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.match(response.body.toString(), /src="\/app.mjs"/);
});
