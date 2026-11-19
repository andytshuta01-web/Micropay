import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

const require = createRequire(import.meta.url);
const sqlJsDirectory = path.dirname(require.resolve('sql.js'));
const SQL = await initSqlJs({ locateFile: (file) => path.join(sqlJsDirectory, file) });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.MICROPAY_DB_PATH
  ? path.resolve(process.env.MICROPAY_DB_PATH)
  : path.join(DATA_DIR, 'micropay.sqlite');
const LEGACY_DB_PATH = process.env.MICROPAY_LEGACY_DB_PATH
  ? path.resolve(process.env.MICROPAY_LEGACY_DB_PATH)
  : process.env.MICROPAY_DB_PATH
    ? null
    : path.join(DATA_DIR, 'db.json');
const LEGACY_MIGRATION_KEY = 'legacy_json_imported';

function emptyDb() {
  return {
    users: {},
    sessions: {},
    missions: {},
    policies: {},
    requests: {},
    logs: {},
  };
}

function normalizeDb(source = {}) {
  const normalized = { ...emptyDb(), ...source };
  normalized.users ||= {};
  normalized.sessions ||= {};
  normalized.missions ||= {};
  normalized.policies ||= {};
  normalized.requests ||= {};
  normalized.logs ||= {};
  return normalized;
}

function ensureDir() {
  const directory = path.dirname(DB_PATH);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
}

ensureDir();
const databaseFileExists = fs.existsSync(DB_PATH);
const sqlite = databaseFileExists
  ? new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH)))
  : new SQL.Database();

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS store_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS users_email_idx ON users(email COLLATE NOCASE);
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS missions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    objective TEXT,
    status TEXT,
    created_at TEXT,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS missions_user_created_idx ON missions(user_id, created_at);
  CREATE TABLE IF NOT EXISTS policies (
    mission_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payment_requests (
    id TEXT PRIMARY KEY,
    mission_id TEXT,
    created_at TEXT,
    status TEXT,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS payment_requests_mission_created_idx
    ON payment_requests(mission_id, created_at);
  CREATE TABLE IF NOT EXISTS agent_logs (
    id TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_logs_mission_position_idx ON agent_logs(mission_id, position);
`);

function persistFile() {
  const temporaryPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(temporaryPath, Buffer.from(sqlite.export()));
  try {
    fs.renameSync(temporaryPath, DB_PATH);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
}

const replaceState = (state, migratedFrom = null) => {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite.exec(`
      DELETE FROM users;
      DELETE FROM sessions;
      DELETE FROM missions;
      DELETE FROM policies;
      DELETE FROM payment_requests;
      DELETE FROM agent_logs;
    `);

    for (const [id, user] of Object.entries(state.users)) {
      sqlite.run(
        'INSERT INTO users (id, email, password_hash, created_at, payload) VALUES (?, ?, ?, ?, ?)',
        [user.id || id, String(user.email || ''), String(user.passwordHash || ''), String(user.createdAt || ''), JSON.stringify(user)],
      );
    }

    for (const [tokenHash, session] of Object.entries(state.sessions)) {
      sqlite.run(
        'INSERT INTO sessions (token_hash, user_id, expires_at, payload) VALUES (?, ?, ?, ?)',
        [tokenHash, String(session.userId || ''), String(session.expiresAt || ''), JSON.stringify(session)],
      );
    }

    for (const [id, mission] of Object.entries(state.missions)) {
      sqlite.run(
        'INSERT INTO missions (id, user_id, objective, status, created_at, payload) VALUES (?, ?, ?, ?, ?, ?)',
        [
          mission.id || id,
          mission.userId || null,
          mission.objective || null,
          mission.status || null,
          mission.createdAt || null,
          JSON.stringify(mission),
        ],
      );
    }

    for (const [missionId, policy] of Object.entries(state.policies)) {
      sqlite.run('INSERT INTO policies (mission_id, payload) VALUES (?, ?)', [missionId, JSON.stringify(policy)]);
    }

    for (const [id, request] of Object.entries(state.requests)) {
      sqlite.run(
        'INSERT INTO payment_requests (id, mission_id, created_at, status, payload) VALUES (?, ?, ?, ?, ?)',
        [
          request.id || id,
          request.missionId || null,
          request.createdAt || null,
          request.transaction?.status || null,
          JSON.stringify(request),
        ],
      );
    }

    for (const [missionId, entries] of Object.entries(state.logs)) {
      entries.forEach((entry, position) => {
        sqlite.run(
          'INSERT INTO agent_logs (id, mission_id, position, created_at, payload) VALUES (?, ?, ?, ?, ?)',
          [entry.id || `${missionId}:${position}`, missionId, position, entry.ts || null, JSON.stringify(entry)],
        );
      });
    }

    if (migratedFrom) {
      sqlite.run('INSERT OR REPLACE INTO store_metadata (key, value) VALUES (?, ?)', [
        LEGACY_MIGRATION_KEY,
        migratedFrom,
      ]);
    }
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
  persistFile();
};

function readRows(query) {
  const statement = sqlite.prepare(query);
  const rows = [];
  try {
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

function isStoreEmpty() {
  const [row] = readRows(`
    SELECT
      (SELECT COUNT(*) FROM users) +
      (SELECT COUNT(*) FROM sessions) +
      (SELECT COUNT(*) FROM missions) +
      (SELECT COUNT(*) FROM policies) +
      (SELECT COUNT(*) FROM payment_requests) +
      (SELECT COUNT(*) FROM agent_logs) AS count
  `);
  return row.count === 0;
}

function readState() {
  const state = emptyDb();
  const parsePayload = (row) => JSON.parse(row.payload);

  for (const row of readRows('SELECT id, payload FROM users')) state.users[row.id] = parsePayload(row);
  for (const row of readRows('SELECT token_hash, payload FROM sessions')) state.sessions[row.token_hash] = parsePayload(row);
  for (const row of readRows('SELECT id, payload FROM missions')) state.missions[row.id] = parsePayload(row);
  for (const row of readRows('SELECT mission_id, payload FROM policies')) state.policies[row.mission_id] = parsePayload(row);
  for (const row of readRows('SELECT id, payload FROM payment_requests')) state.requests[row.id] = parsePayload(row);
  for (const row of readRows('SELECT mission_id, payload FROM agent_logs ORDER BY mission_id, position')) {
    state.logs[row.mission_id] ||= [];
    state.logs[row.mission_id].push(parsePayload(row));
  }
  return state;
}

function loadDb() {
  if (!databaseFileExists) persistFile();

  const hasMigrated = readRows(
    `SELECT value FROM store_metadata WHERE key = '${LEGACY_MIGRATION_KEY}'`,
  ).length > 0;
  if (!hasMigrated && LEGACY_DB_PATH && path.resolve(LEGACY_DB_PATH) !== DB_PATH &&
      fs.existsSync(LEGACY_DB_PATH) && isStoreEmpty()) {
    const legacy = normalizeDb(JSON.parse(fs.readFileSync(LEGACY_DB_PATH, 'utf8')));
    replaceState(legacy, LEGACY_DB_PATH);
    return legacy;
  }
  return readState();
}

let db = loadDb();

export function saveDb() {
  replaceState(db);
}

export function getDb() {
  return db;
}

export function resetDb() {
  db = emptyDb();
  saveDb();
  return db;
}
