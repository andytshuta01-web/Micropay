import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('SQLite migrates existing account and AI data and survives a reload', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropay-store-'));
  const dbPath = path.join(tempDir, 'micropay.sqlite');
  const legacyPath = path.join(tempDir, 'db.json');
  const previousDbPath = process.env.MICROPAY_DB_PATH;
  const previousLegacyPath = process.env.MICROPAY_LEGACY_DB_PATH;

  fs.writeFileSync(legacyPath, JSON.stringify({
    users: {
      user_1: { id: 'user_1', email: 'account@example.test', passwordHash: 'scrypt-hash', createdAt: '2026-01-01T00:00:00.000Z' },
    },
    sessions: {
      token_hash_1: { userId: 'user_1', expiresAt: '2026-01-01T12:00:00.000Z' },
    },
    missions: {
      mission_1: {
        id: 'mission_1',
        userId: 'user_1',
        objective: 'Find a suitable item',
        status: 'completed',
        createdAt: '2026-01-01T00:01:00.000Z',
      },
    },
    policies: { mission_1: { missionId: 'mission_1', allowedProviders: [] } },
    requests: {
      request_1: {
        id: 'request_1',
        missionId: 'mission_1',
        createdAt: '2026-01-01T00:02:00.000Z',
        transaction: { status: 'pending_approval' },
      },
    },
    logs: {
      mission_1: [
        { id: 'log_1', missionId: 'mission_1', ts: '2026-01-01T00:02:00.000Z', etape: 'exploration' },
      ],
    },
  }));
  process.env.MICROPAY_DB_PATH = dbPath;
  process.env.MICROPAY_LEGACY_DB_PATH = legacyPath;

  try {
    const { getDb, saveDb } = await import('../src/store.js');
    const db = getDb();
    assert.equal(db.users.user_1.email, 'account@example.test');
    assert.equal(db.sessions.token_hash_1.userId, 'user_1');
    assert.equal(db.missions.mission_1.objective, 'Find a suitable item');
    assert.equal(db.requests.request_1.transaction.status, 'pending_approval');
    assert.equal(db.logs.mission_1[0].etape, 'exploration');

    db.missions.mission_1.status = 'running';
    db.requests.request_1.transaction.status = 'executed';
    db.logs.mission_1.push({
      id: 'log_2',
      missionId: 'mission_1',
      ts: '2026-01-01T00:03:00.000Z',
      etape: 'mission_terminee',
    });
    saveDb();

    assert.equal(fs.readFileSync(dbPath).subarray(0, 16).toString(), 'SQLite format 3\u0000');
    assert.ok(fs.existsSync(legacyPath));

    const storeUrl = new URL('../src/store.js', import.meta.url).href;
    const script = `const { getDb } = await import(${JSON.stringify(storeUrl)}); console.log(JSON.stringify(getDb()));`;
    const persisted = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MICROPAY_DB_PATH: dbPath,
        MICROPAY_LEGACY_DB_PATH: legacyPath,
      },
    }));

    assert.equal(persisted.users.user_1.email, 'account@example.test');
    assert.equal(persisted.missions.mission_1.status, 'running');
    assert.equal(persisted.requests.request_1.transaction.status, 'executed');
    assert.deepEqual(persisted.logs.mission_1.map((entry) => entry.id), ['log_1', 'log_2']);
  } finally {
    if (previousDbPath === undefined) delete process.env.MICROPAY_DB_PATH;
    else process.env.MICROPAY_DB_PATH = previousDbPath;
    if (previousLegacyPath === undefined) delete process.env.MICROPAY_LEGACY_DB_PATH;
    else process.env.MICROPAY_LEGACY_DB_PATH = previousLegacyPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
