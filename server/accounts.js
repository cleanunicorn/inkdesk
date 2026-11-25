import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const MAX_WORKSPACE = 64 * 1024 * 1024;
const cookieName = "inkdesk_session";

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function json(req, limit, message = "Request exceeds the size limit.") {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new RequestError(415, "Expected a JSON request.");
  }
  if (Number(req.headers["content-length"]) > limit) throw new RequestError(413, message);
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) throw new RequestError(413, message);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "Invalid request.");
  }
}

function credentials(body) {
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  const { password } = body ?? {};
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) {
    throw new RequestError(400, "Use 3–32 letters, numbers, dots, hyphens or underscores for your username.");
  }
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    throw new RequestError(400, "Use a password between 12 and 128 characters.");
  }
  return { username, password };
}

const validKey = (key) => /^(?:signature|document:[\w-]{1,100}|draft:[\w-]{1,100}:\d+)$/.test(key);

function validRecord(entry) {
  return typeof entry?.version === "string" && entry.version.length > 0 &&
    entry.version.length <= 100 && entry.value && typeof entry.value === "object";
}

function workspace(records) {
  if (!records || typeof records !== "object" || Array.isArray(records) ||
      Object.entries(records).some(([key, record]) => !validKey(key) || !validRecord(record))) {
    throw new RequestError(400, "Invalid workspace.");
  }
  return records;
}

function transaction(store, action) {
  store.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    store.exec("COMMIT");
    return result;
  } catch (error) {
    store.exec("ROLLBACK");
    throw error;
  }
}

function putRecord(store, account, key, record) {
  if (record === null) {
    store.prepare("DELETE FROM workspace_records WHERE account_id = ? AND key = ?").run(account, key);
  } else {
    store.prepare(`
      INSERT INTO workspace_records (account_id, key, version, record) VALUES (?, ?, ?, ?)
      ON CONFLICT (account_id, key) DO UPDATE SET version = excluded.version, record = excluded.record
    `).run(account, key, record.version, JSON.stringify(record));
  }
}

function migrateWorkspace(store, account) {
  if (!store.prepare("SELECT 1 FROM accounts WHERE id = ? AND workspace <> '{}'").get(account)) return;
  transaction(store, () => {
    const { workspace: legacy } = store.prepare("SELECT workspace FROM accounts WHERE id = ?").get(account);
    for (const [key, record] of Object.entries(JSON.parse(legacy))) putRecord(store, account, key, record);
    store.prepare("UPDATE accounts SET workspace = '{}' WHERE id = ?").run(account);
  });
}

function readWorkspace(store, account, etag, versionsOnly) {
  store.exec("BEGIN");
  try {
    const { revision } = store.prepare("SELECT revision FROM accounts WHERE id = ?").get(account);
    const query = versionsOnly
      ? "SELECT key, version FROM workspace_records WHERE account_id = ?"
      : "SELECT key, record FROM workspace_records WHERE account_id = ?";
    const rows = etag === `"${revision}"` ? null : store.prepare(query).all(account);
    store.exec("COMMIT");
    return { revision, rows };
  } catch (error) {
    store.exec("ROLLBACK");
    throw error;
  }
}

function updateWorkspace(store, account, digest, revision, update) {
  if (!Number.isSafeInteger(revision)) throw new RequestError(400, "Invalid workspace revision.");
  return transaction(store, () => {
    const changed = store.prepare(`
      UPDATE accounts SET revision = revision + 1 WHERE id = ? AND revision = ?
      AND EXISTS (SELECT 1 FROM sessions WHERE token_hash = ? AND expires > ?)
    `).run(account, revision, digest, Date.now());
    if (!changed.changes) throw new RequestError(409, "The workspace changed during sync.");
    update();
    return { revision: revision + 1 };
  });
}

function hashPassword(password, salt) {
  return derive(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
}

const tokenHash = (token) => createHash("sha256").update(token).digest("hex");

export function createAccountsApi({ database, secureCookies = false, maxRecordBytes = MAX_WORKSPACE }) {
  let db;
  // Limit concurrent password hashing to bound CPU and memory use.
  let hashing = 0;
  const attempts = new Map();
  async function verifyPassword(password, salt) {
    if (hashing >= 4) throw new RequestError(429, "Sign-in is busy. Try again shortly.");
    hashing++;
    try {
      return await hashPassword(password, salt);
    } finally {
      hashing--;
    }
  }
  function throttle(key, limit) {
    const now = Date.now();
    for (const [id, attempt] of attempts) {
      if (attempt.until <= now) attempts.delete(id);
    }
    if (attempts.size >= 10000 && !attempts.has(key)) {
      throw new RequestError(429, "Sign-in is busy. Try again shortly.");
    }
    const attempt = attempts.get(key) ?? { count: 0, until: now + 60_000 };
    if (attempt.count >= limit) throw new RequestError(429, "Too many attempts. Try again in a minute.");
    attempt.count++;
    attempts.set(key, attempt);
  }
  function open() {
    if (db) return db;
    if (database !== ":memory:") mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
    db = new DatabaseSync(database);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        salt TEXT NOT NULL,
        password_hash BLOB NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        workspace TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_records (
        account_id TEXT NOT NULL REFERENCES accounts(id),
        key TEXT NOT NULL,
        version TEXT NOT NULL,
        record TEXT NOT NULL,
        PRIMARY KEY (account_id, key)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        expires INTEGER NOT NULL
      );
    `);
    return db;
  }
  function setCookie(res, token, maxAge) {
    res.setHeader("Set-Cookie",
      `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookies ? "; Secure" : ""}`);
  }
  function startSession(store, res, accountId, previousToken) {
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    store.prepare("DELETE FROM sessions WHERE expires <= ? OR token_hash = ?").run(now, previousToken);
    store.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(tokenHash(token), accountId, now + SESSION_SECONDS * 1000);
    setCookie(res, token, SESSION_SECONDS);
  }

  return async function accountsApi(req, res, next) {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/")) return next();
    try {
      if (req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(req.headers["sec-fetch-site"])) {
        throw new RequestError(403, "Open Inkdesk directly to access your account.");
      }
      const store = open();
      const token = req.headers.cookie?.match(/(?:^|;\s*)inkdesk_session=([\w-]{43})(?:;|$)/)?.[1];
      const digest = token ? tokenHash(token) : "";
      const session = digest && store.prepare(`
        SELECT accounts.id, accounts.username FROM sessions
        JOIN accounts ON accounts.id = sessions.account_id
        WHERE token_hash = ? AND expires > ?
      `).get(digest, Date.now());

      switch (`${req.method} ${path}`) {
        case "GET /api/session":
          return send(res, 200, { account: session || null });
        case "POST /api/claim":
        case "POST /api/sign-in": {
          throttle(`ip:${req.socket.remoteAddress}`, 60);
          const claiming = path === "/api/claim";
          const body = await json(req, claiming ? MAX_WORKSPACE + 4096 : 4096);
          const { username, password } = credentials(body);
          throttle(`name:${username}`, 10);
          const account = store.prepare("SELECT id, salt, password_hash FROM accounts WHERE username = ?").get(username);
          let id;
          if (claiming) {
            if (account) throw new RequestError(409, "That username is already taken.");
            const initial = workspace(body.records ?? {});
            const salt = randomBytes(16).toString("hex");
            const passwordHash = await verifyPassword(password, salt);
            id = randomUUID();
            const insert = store.prepare("INSERT OR IGNORE INTO accounts (id, username, salt, password_hash, workspace) VALUES (?, ?, ?, ?, ?)");
            transaction(store, () => {
              if (!insert.run(id, username, salt, passwordHash, "{}").changes) {
                throw new RequestError(409, "That username is already taken.");
              }
              for (const [key, record] of Object.entries(initial)) putRecord(store, id, key, record);
            });
          } else {
            const passwordHash = await verifyPassword(password, account?.salt ?? "inkdesk-unknown-user");
            if (!account || !timingSafeEqual(passwordHash, account.password_hash)) {
              throw new RequestError(401, "The username or password is incorrect.");
            }
            id = account.id;
          }
          startSession(store, res, id, digest);
          return send(res, 200, { account: { id, username } });
        }
        case "POST /api/sign-out":
          await json(req, 4096);
          if (session && req.headers["x-inkdesk-account"] !== session.id) {
            throw new RequestError(401, "Your account session has changed.");
          }
          store.prepare("DELETE FROM sessions WHERE token_hash = ?").run(digest);
          setCookie(res, "", 0);
          return send(res, 200, {});
        case "GET /api/workspace":
        case "PUT /api/workspace":
        case "GET /api/records":
        case "GET /api/record":
        case "PUT /api/record": {
          if (!session || req.headers["x-inkdesk-account"] !== session.id) {
            throw new RequestError(401, "Sign in again to sync your workspace.");
          }
          migrateWorkspace(store, session.id);
          if (path === "/api/record") {
            const params = new URL(req.url, "http://localhost").searchParams;
            const key = params.get("key") ?? "";
            if (!validKey(key)) throw new RequestError(400, "Invalid workspace item.");
            if (req.method === "GET") {
              const row = store.prepare("SELECT version, record FROM workspace_records WHERE account_id = ? AND key = ?")
                .get(session.id, key);
              if (params.has("version") && params.get("version") !== row?.version) {
                throw new RequestError(409, "The workspace changed during sync.");
              }
              if (!row) throw new RequestError(404, "Workspace item not found.");
              res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
              return res.end(`{"record":${row.record}}`);
            }
            const message = "This item exceeds the sync size limit.";
            const body = await json(req, maxRecordBytes + 256, message);
            if (body?.record !== null && !validRecord(body?.record)) throw new RequestError(400, "Invalid workspace item.");
            if (Buffer.byteLength(JSON.stringify(body.record)) > maxRecordBytes) throw new RequestError(413, message);
            return send(res, 200, updateWorkspace(store, session.id, digest, body.revision, () => {
              putRecord(store, session.id, key, body.record);
            }));
          }
          if (req.method === "GET") {
            const snapshot = readWorkspace(store, session.id, req.headers["if-none-match"], path === "/api/records");
            res.setHeader("ETag", `"${snapshot.revision}"`);
            if (snapshot.rows === null) {
              res.writeHead(304, { "Cache-Control": "no-store" });
              return res.end();
            }
            if (path === "/api/records") {
              return send(res, 200, {
                revision: snapshot.revision,
                versions: Object.fromEntries(snapshot.rows.map(({ key, version }) => [key, version])),
              });
            }
            return send(res, 200, {
              revision: snapshot.revision,
              records: Object.fromEntries(snapshot.rows.map(({ key, record }) => [key, JSON.parse(record)])),
            });
          }
          const body = await json(req, MAX_WORKSPACE + 4096);
          const records = workspace(body?.records);
          return send(res, 200, updateWorkspace(store, session.id, digest, body.revision, () => {
            store.prepare("DELETE FROM workspace_records WHERE account_id = ?").run(session.id);
            for (const [key, record] of Object.entries(records)) putRecord(store, session.id, key, record);
          }));
        }
        default:
          return send(res, 404, { error: "Account endpoint not found." });
      }
    } catch (error) {
      if (!error.status) console.error("Inkdesk account API:", error.code || error.name);
      if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : "The account service is unavailable." });
    }
  };
}
