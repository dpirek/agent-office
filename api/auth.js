import { json, readRequestBody, methodNotAllowed } from "./http.js";

const COOKIE = "office_session";
export function sessionToken(req) {
  return String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || "";
}
export function createAuthService({ userStore, publicOrigin = "" }) {
  const origin = publicOrigin ? new URL(publicOrigin).origin : "";
  const attempts = new Map();
  function sameOrigin(req) {
    return req.headers["sec-fetch-site"] !== "cross-site" && (!req.headers.origin || req.headers.origin === (origin || `http://${req.headers.host}`));
  }
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
    return sameOrigin(req) && user && user.role !== "pending" ? user : null;
  }
  async function handle(req, res, url) {
    const route = url.pathname;
    const authRoute = route.startsWith("/api/auth/") || route === "/api/users";
    const protectedRoute = route.startsWith("/api/") || route.startsWith("/files/") || route.startsWith("/downloads/");
    // Workers use their existing task-scoped bearer credentials.
    if (route === "/api/worker-artifacts" || route.startsWith("/mcp/projects/")) return false;
    if (!authRoute && !protectedRoute) return false;
    res.setHeader("cache-control", "no-store");
    if (!sameOrigin(req)) { json(res, 403, { ok: false, error: "Cross-origin requests are not allowed." }); return true; }
    req.user = userStore.session(sessionToken(req));
    if (!authRoute) {
      if (!req.user) { json(res, 401, { ok: false, error: "Sign in to continue." }); return true; }
      if (req.user.role === "pending") { json(res, 403, { ok: false, error: "Your account is awaiting administrator approval." }); return true; }
      if (route === "/api/factory-reset" && req.user.role !== "admin") { json(res, 403, { ok: false, error: "Administrator access required." }); return true; }
      return false;
    }
    try {
      if (route === "/api/auth/session") {
        if (req.method !== "GET") { methodNotAllowed(res, "GET"); return true; }
        json(res, 200, { ok: true, user: req.user, needsSetup: userStore.needsSetup() });
        return true;
      }
      if (route.startsWith("/api/users")) {
        if (!req.user || req.user.role !== "admin") { json(res, req.user ? 403 : 401, { ok: false, error: "Administrator access required." }); return true; }
        if (route === "/api/users" && req.method === "GET") { json(res, 200, { ok: true, users: userStore.list() }); return true; }
      }
      const method = route === "/api/users" ? "PATCH" : "POST";
      if (req.method !== method) { methodNotAllowed(res, method); return true; }
      if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) { json(res, 415, { ok: false, error: "Use application/json." }); return true; }
      rateLimit(req, route);
      const body = JSON.parse(await readRequestBody(req, 8192) || "{}");
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected a JSON object.");
      if (route === "/api/auth/register") {
        const user = await userStore.register(body);
        json(res, 201, { ok: true, user });
      } else if (route === "/api/auth/login") {
        const result = await userStore.login(body);
        cookie(res, result.token);
        json(res, 200, { ok: true, user: result.user });
      } else if (route === "/api/auth/logout") {
        userStore.logout(sessionToken(req)); cookie(res, ""); json(res, 200, { ok: true });
      } else if (route === "/api/users") {
        if (typeof body.id !== "string") throw new Error("User ID is required.");
        json(res, 200, { ok: true, user: userStore.update(body.id, body) });
      } else json(res, 404, { ok: false, error: "Not found." });
    } catch (error) {
      json(res, error.statusCode || 400, { ok: false, error: error.statusCode ? error.message : "Invalid request. Check the submitted fields." });
    }
    return true;
  }
  return { handle, authorizeSocket };
}
