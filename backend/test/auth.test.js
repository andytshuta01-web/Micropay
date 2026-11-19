import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('accounts can register, log in, and access only their own missions', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropay-auth-'));
  const dbPath = path.join(tempDir, 'micropay.sqlite');
  const previousDbPath = process.env.MICROPAY_DB_PATH;
  process.env.MICROPAY_DB_PATH = dbPath;
  let server;

  try {
    const [{ authRouter, requireAuth }, { missionsRouter }] = await Promise.all([
      import('../src/routes/auth.js'),
      import('../src/routes/missions.js'),
    ]);
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    app.use('/api/missions', requireAuth, missionsRouter);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    async function register(email) {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'secure-password-123' }),
      });
      assert.equal(response.status, 201);
      return response.headers.get('set-cookie').split(';')[0];
    }

    async function createMission(cookie, objective) {
      const response = await fetch(`${baseUrl}/api/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ objective, budgetTotal: 10, allowedProviders: [] }),
      });
      assert.equal(response.status, 201);
      return response.json();
    }

    const unauthenticated = await fetch(`${baseUrl}/api/missions`);
    assert.equal(unauthenticated.status, 401);

    const crossOriginLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'first@example.test', password: 'secure-password-123' }),
    });
    assert.equal(crossOriginLogin.status, 403);

    const firstCookie = await register('FIRST@example.test');
    const firstProfile = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: firstCookie } });
    assert.equal((await firstProfile.json()).user.email, 'first@example.test');

    const duplicate = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'first@example.test', password: 'secure-password-123' }),
    });
    assert.equal(duplicate.status, 409);

    const firstMission = await createMission(firstCookie, 'Mission privée A');
    const secondCookie = await register('second@example.test');
    const secondMission = await createMission(secondCookie, 'Mission privée B');

    const firstList = await fetch(`${baseUrl}/api/missions`, { headers: { Cookie: firstCookie } });
    assert.deepEqual((await firstList.json()).map((mission) => mission.id), [firstMission.mission.id]);
    const crossAccountMission = await fetch(
      `${baseUrl}/api/missions/${secondMission.mission.id}`,
      { headers: { Cookie: firstCookie } },
    );
    assert.equal(crossAccountMission.status, 404);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: firstCookie },
    });
    assert.equal(logout.status, 204);
    const expiredSession = await fetch(`${baseUrl}/api/missions`, { headers: { Cookie: firstCookie } });
    assert.equal(expiredSession.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'FIRST@example.test', password: 'secure-password-123' }),
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);

    const invalidLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'first@example.test', password: 'incorrect-password' }),
    });
    assert.equal(invalidLogin.status, 401);
    assert.equal(fs.readFileSync(dbPath).subarray(0, 16).toString(), 'SQLite format 3\u0000');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousDbPath === undefined) delete process.env.MICROPAY_DB_PATH;
    else process.env.MICROPAY_DB_PATH = previousDbPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
