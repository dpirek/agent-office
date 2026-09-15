import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createUserStore } from "../lib/users.js";
import { createAuthService } from "../api/auth.js";
import { Readable } from "node:stream";

const password = "correct horse battery staple";
const account = (email, extra = {}) => ({ email, name: "Test User", password, ...extra });

test("registration persists hashed credentials and sessions with server-assigned roles", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "office-users-"));
  const filename = path.join(dir, "users.sqlite");
  let store = createUserStore(filename);
  try {
    assert.equal(store.needsSetup(), true);
    const results = await Promise.all([store.register(account("Admin@Example.com")), store.register(account("member@example.com", { role: "admin" }))]);
    assert.equal(results.filter((user) => user.role === "admin").length, 1);
    assert.equal(results.filter((user) => user.role === "pending").length, 1);
    assert.equal(results[0].email, "admin@example.com");
    assert.equal(results[0].password_hash, undefined);
    await assert.rejects(store.register(account("ADMIN@example.com")), /Unable to register/);
    await assert.rejects(store.register(account("bad", { password: "short" })), /valid email/);
    const shortAccount = account("short@example.com", { password: "x" });
    const shortUser = await store.register(shortAccount);
    assert.equal((await store.login(shortAccount)).user.id, shortUser.id);
    await assert.rejects(store.register(account("empty@example.com", { password: "" })), /Password is required/);
    await assert.rejects(store.register(account("long@example.com", { password: "x".repeat(257) })), /at most 256/);
    await assert.rejects(store.login(account("admin@example.com", { password: "wrong" })), /Invalid email or password/);
    await assert.rejects(store.login(account("missing@example.com")), /Invalid email or password/);
    const loggedIn = await store.login(account("admin@example.com"));
    store.close(); store = createUserStore(filename);
    assert.equal(store.session(loggedIn.token).id, loggedIn.user.id);
    const db = new DatabaseSync(filename);
    const row = db.prepare("SELECT * FROM users WHERE email=?").get("admin@example.com");
    assert.notEqual(row.password_hash, password);
    assert.equal(db.prepare("SELECT token_hash FROM user_sessions").get().token_hash.includes(loggedIn.token), false);
    db.close();
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test("role changes and disabling revoke sessions, and preserve the last administrator", async () => {
  const revoked = [];
  const store = createUserStore(":memory:", { onRevoke: (id) => revoked.push(id) });
  try {
    const admin = await store.register(account("admin@example.com"));
    const user = await store.register(account("member@example.com"));
    assert.throws(() => store.update(admin.id, { role: "member" }), /at least one/);
    assert.throws(() => store.update(admin.id, { disabled: true }), /at least one/);
    assert.throws(() => store.update(user.id, { role: "owner" }), /Invalid role/);
    assert.throws(() => store.update(user.id, { disabled: "false" }), /boolean/);
    const session = await store.login(account(user.email));
    store.update(user.id, { role: "member" });
    assert.equal(store.session(session.token), null);
    assert.ok(revoked.includes(user.id));
    store.update(user.id, { disabled: true });
    await assert.rejects(store.login(account(user.email)), /Invalid email or password/);
    store.update(user.id, { role: "admin", disabled: false });
    store.update(admin.id, { role: "member" });
  } finally { store.close(); }
});

test("sessions expire and logout revokes the presented session", async () => {
  let now = Date.now();
  const store = createUserStore(":memory:", { now: () => now });
  try {
    await store.register(account("admin@example.com"));
    const first = await store.login(account("admin@example.com"));
    store.logout(first.token);
    assert.equal(store.session(first.token), null);
    const second = await store.login(account("admin@example.com"));
    now += 7*86400_000;
    assert.equal(store.session(second.token), null);
  } finally { store.close(); }
});

function client(service) {
  return async (route, { method = "GET", body, cookie, origin, contentType = "application/json", address = "127.0.0.1" } = {}) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method; req.socket = { remoteAddress: address };
    req.headers = { host: "localhost", "content-type": contentType, ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) };
    const result = { status: 200, headers: {} };
    const res = { setHeader(key, value) { result.headers[key] = value; }, writeHead(status, headers) { result.status = status; Object.assign(result.headers, headers); }, end(body) { result.body = body ? JSON.parse(body) : null; } };
    result.handled = await service.handle(req, res, new URL(route, "http://localhost"));
    return result;
  };
}

test("HTTP auth enforces approval, admin access, CSRF, cookies, and rate limits", async () => {
  const store = createUserStore(":memory:");
  const service = createAuthService({ userStore: store });
  const request = client(service);
  try {
    assert.equal((await request("/api/tasks")).status, 401);
    assert.equal((await request("/files/private.txt")).status, 401);
    assert.equal((await request("/downloads/tasks/one")).status, 401);
    assert.equal((await request("/api/worker-artifacts", { method: "POST" })).handled, false);
    assert.equal((await request("/mcp/projects/task", { method: "POST" })).handled, false);
    const post = (route, body, extra = {}) => request(route, { method: "POST", body, ...extra });
    assert.equal((await post("/api/auth/register", account("admin@example.com"))).status, 201);
    assert.equal((await post("/api/auth/register", account("member@example.com", { role: "admin" }))).body.user.role, "pending");
    const login = await post("/api/auth/login", account("admin@example.com"));
    const cookie = login.headers["set-cookie"].split(";")[0];
    assert.match(login.headers["set-cookie"], /HttpOnly; SameSite=Lax/);
    assert.equal((await request("/api/tasks", { cookie })).handled, false);
    const pending = await post("/api/auth/login", account("member@example.com"));
    const pendingCookie = pending.headers["set-cookie"].split(";")[0];
    assert.equal((await request("/api/tasks", { cookie: pendingCookie })).status, 403);
    assert.equal((await request("/api/users", { cookie: pendingCookie })).status, 403);
    assert.equal((await request("/api/users")).status, 401);
    const users = await request("/api/users", { cookie });
    assert.equal(users.body.users.length, 2);
    assert.equal(JSON.stringify(users.body).includes("password_hash"), false);
    assert.equal((await request("/api/users", { method: "PATCH", cookie, body: { id: pending.body.user.id, role: "member" } })).status, 200);
    const memberLogin = await post("/api/auth/login", account("member@example.com"));
    const memberCookie = memberLogin.headers["set-cookie"].split(";")[0];
    assert.equal((await request("/api/tasks", { cookie: memberCookie })).handled, false);
    assert.equal((await post("/api/factory-reset", {}, { cookie: memberCookie })).status, 403);
    assert.equal((await post("/api/auth/logout", {}, { cookie, origin: "http://evil.example" })).status, 403);
    assert.equal((await post("/api/auth/login", {}, { contentType: "text/plain" })).status, 415);
    assert.equal(service.authorizeSocket({ headers: { cookie, host: "localhost", origin: "http://localhost" } }).role, "admin");
    assert.equal(service.authorizeSocket({ headers: { cookie, host: "localhost", origin: "http://evil.example" } }), null);
    assert.equal(service.authorizeSocket({ headers: { host: "localhost" } }), null);
    await post("/api/auth/logout", {}, { cookie });
    assert.equal((await request("/api/tasks", { cookie })).status, 401);
    for (let i = 0; i < 21; i++) {
      const result = await post("/api/auth/login", { email: "missing@example.com", password }, { address: "192.0.2.1" });
      assert.equal(result.status, i === 20 ? 429 : 401);
    }
  } finally { store.close(); }
});

test("HTTPS configuration sets secure cookies and uses the configured origin", async () => {
  const store = createUserStore(":memory:");
  try {
    await store.register(account("admin@example.com"));
    const request = client(createAuthService({ userStore: store, publicOrigin: "https://office.example.com" }));
    const result = await request("/api/auth/login", { method: "POST", body: account("admin@example.com"), origin: "https://office.example.com" });
    assert.equal(result.status, 200);
    assert.match(result.headers["set-cookie"], /; Secure/);
  } finally { store.close(); }
});
