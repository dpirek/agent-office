import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { USER_AVATARS } from "../public/lib/user-avatars.mjs";

const scrypt = promisify(scryptCallback);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
export const USER_ROLES = ["admin", "member", "pending"];
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
function emailAddress(value) {
  if (typeof value !== "string" || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) fail("Enter a valid email address.");
  return value.trim().toLowerCase();
}
async function passwordHash(password) {
  if (typeof password !== "string" || password.length === 0) fail("Password is required.");
  if (password.length > 256) fail("Password must contain at most 256 characters.");
  const salt = token();
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}
async function verifyPassword(password, hash) {
  if (typeof password !== "string" || password.length > 256) return false;
  const [salt, expected] = hash.split(":");
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
const publicUser = (row) => row ? { id: row.id, email: row.email, name: row.name, avatar: row.avatar, role: row.role, projectIds: row.project_ids == null ? null : JSON.parse(row.project_ids), disabled: Boolean(row.disabled), createdAt: row.created_at } : null;

export function createUserStore(databasePath, { now = Date.now, onRevoke = () => {} } = {}) {
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','member','pending')),
      disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS user_sessions_user ON user_sessions(user_id);`);
  if (!db.prepare("PRAGMA table_info(users)").all().some(column => column.name === "avatar")) {
    db.exec("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT 'initials'");
  }
  if (!db.prepare("PRAGMA table_info(users)").all().some(column => column.name === "project_ids")) {
    db.exec("ALTER TABLE users ADD COLUMN project_ids TEXT");
  }
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function revoke(id) { db.prepare("DELETE FROM user_sessions WHERE user_id=?").run(id); }
  const dummyHash = `${token()}:${randomBytes(64).toString("hex")}`;
  return {
    close: () => db.close(),
    needsSetup: () => db.prepare("SELECT COUNT(*) AS count FROM users").get().count === 0,
    list: () => db.prepare("SELECT * FROM users ORDER BY created_at, email").all().map(publicUser),
    updateAvatar(id, avatar) {
      if (!USER_AVATARS.some(choice => choice.id === avatar)) fail("Choose an available avatar.");
      const result = db.prepare("UPDATE users SET avatar=? WHERE id=? AND disabled=0").run(avatar, id);
      if (!result.changes) fail("User not found.", 404);
      return publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id));
    },
    async register({ email, name, password }) {
      email = emailAddress(email);
      if (typeof name !== "string" || !name.trim() || name.trim().length > 100) fail("Name must contain 1–100 characters.");
      const hash = await passwordHash(password);
      return transaction(() => {
        if (db.prepare("SELECT id FROM users WHERE email=?").get(email)) fail("Unable to register this email address.", 409);
        const role = db.prepare("SELECT COUNT(*) AS count FROM users").get().count === 0 ? "admin" : "pending";
        const id = randomUUID();
        db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(id,email,name.trim(),hash,role,now());
        if (role === 'pending') db.prepare("UPDATE users SET project_ids='[]' WHERE id=?").run(id);
        return publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id));
      });
    },
    async login({ email, password }) {
      const row = db.prepare("SELECT * FROM users WHERE email=?").get(typeof email === "string" ? email.trim().toLowerCase() : "");
      const matches = await verifyPassword(password, row?.password_hash || dummyHash);
      if (!matches || !row || row.disabled) fail("Invalid email or password.", 401);
      // Re-read after asynchronous hashing in case the account changed meanwhile.
      const current = db.prepare("SELECT * FROM users WHERE id=?").get(row.id);
      if (!current || current.disabled || current.password_hash !== row.password_hash) fail("Invalid email or password.", 401);
      db.prepare("DELETE FROM user_sessions WHERE expires_at<=?").run(now());
      const sessionToken = token();
      db.prepare("INSERT INTO user_sessions VALUES(?,?,?)").run(digest(sessionToken),row.id,now()+7*86400_000);
      return { user: publicUser(current), token: sessionToken };
    },
    session(value) {
      if (!value) return null;
      return publicUser(db.prepare(`SELECT users.* FROM user_sessions JOIN users ON users.id=user_sessions.user_id
        WHERE token_hash=? AND expires_at>? AND disabled=0`).get(digest(value),now()));
    },
    logout(value) {
      if (!value) return;
      db.prepare("DELETE FROM user_sessions WHERE token_hash=?").run(digest(value));
      onRevoke(null, value);
    },
    grantProject(id, projectId) {
      const row = db.prepare("SELECT * FROM users WHERE id=?").get(id);
      if (!row) fail("User not found.", 404);
      if (row.project_ids != null) {
        const projects = [...new Set([...JSON.parse(row.project_ids), projectId])];
        db.prepare("UPDATE users SET project_ids=? WHERE id=?").run(JSON.stringify(projects), id);
      }
      return publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id));
    },
    update(id, { role, disabled, projectIds }) {
      const result = transaction(() => {
        const row = db.prepare("SELECT * FROM users WHERE id=?").get(id);
        if (!row) fail("User not found.", 404);
        if (role !== undefined && !USER_ROLES.includes(role)) fail("Invalid role.");
        if (disabled !== undefined && typeof disabled !== "boolean") fail("Disabled must be a boolean.");
        if (projectIds !== undefined && projectIds !== null && (!Array.isArray(projectIds) || projectIds.length > 1000 || projectIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9-]+$/.test(id)))) fail('Choose valid projects.');
        role ??= row.role;
        disabled ??= Boolean(row.disabled);
        if (row.role === "admin" && !row.disabled && (role !== "admin" || disabled)
          && db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND disabled=0").get().count <= 1) fail("Keep at least one active administrator.", 409);
        db.prepare("UPDATE users SET role=?,disabled=? WHERE id=?").run(role,Number(disabled),id);
        if (projectIds !== undefined) db.prepare("UPDATE users SET project_ids=? WHERE id=?").run(projectIds === null ? null : JSON.stringify([...new Set(projectIds)]), id);
        if (role !== row.role || disabled !== Boolean(row.disabled)) revoke(id);
        return publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id));
      });
      onRevoke(id);
      return result;
    },
  };
}
