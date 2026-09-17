import { safeTokenEqual, bearerToken } from '../lib/worker-auth.js';
import { json, readRequestBody, methodNotAllowed } from "./http.js";
import { canAccessProject } from '../lib/project-access.js';

const COOKIE = "office_session";
export function sessionToken(req) {
  return String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || "";
}
export function createAuthService({ userStore, publicOrigin = "", getProjects = () => [], getWorkerToken = () => "" }) {
  const origin = publicOrigin ? new URL(publicOrigin).origin : "";
  const attempts = new Map();
  function cookie(res, value) {
    res.setHeader("set-cookie", `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value ? 604800 : 0}${origin.startsWith("https:") ? "; Secure" : ""}`);
  }
  function rateLimit(req, action) {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const key = `${req.socket.remoteAddress}:${action}`;
    const entry = attempts.get(key) || { count: 0, until: now + 15*60_000 };
    attempts.set(key, entry);
    if (++entry.count > 20) throw Object.assign(new Error("Too many attempts. Try again in 15 minutes."), { statusCode: 429 });
  }
  function authorizeSocket(req) {
    const user = userStore.session(sessionToken(req));
    return user && user.role !== "pending" ? user : null;
  }
  async function handle(req, res, url) {
    const route = url.pathname;
    const authRoute = route.startsWith("/api/auth/") || route === "/api/users";
    const protectedRoute = route.startsWith("/api/") || route.startsWith("/files/") || route.startsWith("/downloads/");
    // Workers use their existing task-scoped bearer credentials.
    if (route === "/api/worker-artifacts" || route.startsWith("/mcp/projects/")) return false;
    if (!authRoute && !protectedRoute) return false;
    res.setHeader("cache-control", "no-store");
    const workerRoute = (req.method === 'GET' && ['/api/memory', '/api/tasks', '/api/chat'].includes(route))
      || (req.method === 'POST' && route === '/api/workspace-upload');
    if (workerRoute
      && safeTokenEqual(bearerToken(req.headers.authorization), getWorkerToken())) {
      req.workerAuthenticated = true;
      return false;
    }
    req.user = userStore.session(sessionToken(req));
    if (req.user?.role === 'member') req.user.publicProjectIds = getProjects().filter(project => project.isPublic).map(project => project.id);
    if (!authRoute) {
      if (!req.user) { json(res, 401, { ok: false, error: "Sign in to continue." }); return true; }
      if (req.user.role === "pending") { json(res, 403, { ok: false, error: "Your account is awaiting administrator approval." }); return true; }
      if (route === "/api/factory-reset" && req.user.role !== "admin") { json(res, 403, { ok: false, error: "Administrator access required." }); return true; }
      return false;
    }
    try {
      const checkInvitation = code => {
        const invite = userStore.getInvitation(code);
        const project = getProjects().find(project => project.id === invite.projectId);
        const inviter = userStore.list().find(user => user.id === invite.invitedBy);
        if (!project || !canAccessProject(inviter, project.id, project)) throw Object.assign(new Error('This invitation is no longer available.'), { statusCode: 400 });
        return { ...invite, projectName: project.name };
      };
      if (route === '/api/auth/invitation') {
        if (req.method !== 'GET') return methodNotAllowed(res, 'GET'), true;
        rateLimit(req, route);
        const { email, projectId, projectName, expiresAt } = checkInvitation(url.searchParams.get('code'));
        json(res, 200, { ok: true, invitation: { email, projectId, projectName, expiresAt } });
        return true;
      }
      if (route === "/api/auth/session") {
        if (req.method !== "GET") { methodNotAllowed(res, "GET"); return true; }
        json(res, 200, { ok: true, user: req.user, needsSetup: userStore.needsSetup() });
        return true;
      }
      if (route.startsWith("/api/users")) {
        if (!req.user || req.user.role !== "admin") { json(res, req.user ? 403 : 401, { ok: false, error: "Administrator access required." }); return true; }
        if (route === "/api/users" && req.method === "GET") { json(res, 200, { ok: true, users: userStore.list() }); return true; }
      }
      if (route === "/api/auth/profile" && !req.user) { json(res, 401, { ok: false, error: "Sign in to continue." }); return true; }
      const method = ["/api/users", "/api/auth/profile"].includes(route) ? "PATCH" : "POST";
      if (req.method !== method) { methodNotAllowed(res, method); return true; }
      if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) { json(res, 415, { ok: false, error: "Use application/json." }); return true; }
      rateLimit(req, route);
      const body = JSON.parse(await readRequestBody(req, 8192) || "{}");
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected a JSON object.");
      if (route === "/api/auth/profile") {
        json(res, 200, { ok: true, user: userStore.updateAvatar(req.user.id, body.avatar) });
      } else if (route === "/api/auth/register") {
        if (body.invitation) checkInvitation(body.invitation);
        const user = await userStore.register(body);
        json(res, 201, { ok: true, user });
      } else if (route === "/api/auth/login") {
        if (body.invitation) checkInvitation(body.invitation);
        const result = await userStore.login(body);
        if (body.invitation) {
          try { result.user = userStore.acceptInvitation(body.invitation, result.user.id); }
          catch (error) { userStore.logout(result.token); throw error; }
        }
        cookie(res, result.token);
        json(res, 200, { ok: true, user: result.user });
      } else if (route === '/api/auth/accept-invitation') {
        if (!req.user) throw Object.assign(new Error('Sign in to accept this invitation.'), { statusCode: 401 });
        checkInvitation(body.invitation);
        json(res, 200, { ok: true, user: userStore.acceptInvitation(body.invitation, req.user.id) });
      } else if (route === "/api/auth/logout") {
        userStore.logout(sessionToken(req)); cookie(res, ""); json(res, 200, { ok: true });
      } else if (route === "/api/users") {
        if (typeof body.id !== "string") throw new Error("User ID is required.");
        if (Array.isArray(body.projectIds) && body.projectIds.some(id => !getProjects().some(project => project.id === id))) throw new Error('Unknown project.');
        json(res, 200, { ok: true, user: userStore.update(body.id, body) });
      } else json(res, 404, { ok: false, error: "Not found." });
    } catch (error) {
      json(res, error.statusCode || 400, { ok: false, error: error.statusCode ? error.message : "Invalid request. Check the submitted fields." });
    }
    return true;
  }
  return { handle, authorizeSocket };
}
