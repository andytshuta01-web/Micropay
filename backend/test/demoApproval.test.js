import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('DummyJSON approval submits a sandbox payout only after manual approval', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropay-demo-'));
  const dbPath = path.join(tempDir, 'micropay.sqlite');
  const env = {
    MICROPAY_DB_PATH: process.env.MICROPAY_DB_PATH,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
    PAYPAL_MODE: process.env.PAYPAL_MODE,
    PAYPAL_SANDBOX_RECEIVER_EMAIL: process.env.PAYPAL_SANDBOX_RECEIVER_EMAIL,
  };
  const realFetch = globalThis.fetch;
  const paypalCalls = [];
  let server;
  let paypalConfig;
  let originalPaypalConfig;

  process.env.MICROPAY_DB_PATH = dbPath;
  process.env.GROQ_API_KEY = 'test-key-not-used';
  process.env.PAYPAL_CLIENT_ID = 'sandbox-test-client';
  process.env.PAYPAL_CLIENT_SECRET = 'sandbox-test-secret';
  process.env.PAYPAL_MODE = 'sandbox';
  process.env.PAYPAL_SANDBOX_RECEIVER_EMAIL = '';

  try {
    const { getDb, saveDb } = await import('../src/store.js');
    const db = getDb();
    db.missions.mission_demo = {
      id: 'mission_demo',
      userId: 'test-user',
      objective: 'Find demo earphones',
      budgetTotal: 20,
      budgetRemaining: 20,
    };
    db.policies.mission_demo = {
      missionId: 'mission_demo',
      autoApproveThreshold: 0,
      allowedProviders: [],
      maxPaymentsPerMinute: 3,
      minConfidence: 0.5,
    };
    db.requests.request_demo = {
      id: 'request_demo',
      missionId: 'mission_demo',
      resourceTitle: 'Demo Wireless Earphones',
      providerId: 'prov_dummyjson',
      providerName: 'Boutique générique de démonstration',
      externalProductId: 7,
      isDemoProduct: true,
      amount: 19.99,
      transaction: { status: 'pending_approval' },
    };
    saveDb();

    const { config } = await import('../src/config.js');
    paypalConfig = config.paypal;
    originalPaypalConfig = { ...paypalConfig };
    paypalConfig.mode = 'sandbox';
    paypalConfig.sandboxReceiverEmail = '';

    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      if (url.hostname === '127.0.0.1') return realFetch(input, options);

      paypalCalls.push({ url: url.toString(), method: options.method || 'GET', body: options.body });
      if (url.pathname === '/v1/oauth2/token') {
        return new Response(JSON.stringify({ access_token: 'sandbox-test-token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.pathname === '/v1/payments/payouts' && options.method === 'POST') {
        return new Response(JSON.stringify({
          batch_header: { batch_status: 'PENDING', payout_batch_id: 'payout-test-123' },
        }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/v1/payments/payouts/payout-test-123') {
        return new Response(JSON.stringify({
          batch_header: { batch_status: 'SUCCESS', payout_batch_id: 'payout-test-123' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected PayPal test request: ${url.pathname}`);
    };

    const { missionsRouter } = await import('../src/routes/missions.js');
    const app = express();
    app.use(express.json());
    app.use('/api/missions', (req, res, next) => {
      req.user = { id: 'test-user' };
      next();
    }, missionsRouter);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/missions`;

    let response = await fetch(`${baseUrl}/requests/request_demo/approve`, { method: 'POST' });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /PAYPAL_SANDBOX_RECEIVER_EMAIL/);
    assert.equal(paypalCalls.length, 0);

    paypalConfig.sandboxReceiverEmail = 'merchant-sandbox@example.test';
    paypalConfig.mode = 'live';
    response = await fetch(`${baseUrl}/requests/request_demo/approve`, { method: 'POST' });
    assert.equal(response.status, 503);
    assert.equal(paypalCalls.length, 0);

    paypalConfig.mode = 'sandbox';
    response = await fetch(`${baseUrl}/requests/request_demo/approve`, { method: 'POST' });
    let result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.request.transaction.status, 'processing');
    assert.equal(result.request.transaction.paypalStatus, 'PENDING');
    assert.equal(result.request.transaction.paypalReference, 'payout-test-123');
    assert.equal(result.mission.budgetRemaining, 0.01);

    const payoutCall = paypalCalls.find((call) => new URL(call.url).pathname === '/v1/payments/payouts');
    assert.ok(payoutCall);
    assert.match(payoutCall.url, /^https:\/\/api-m\.sandbox\.paypal\.com\//);
    const payoutBody = JSON.parse(payoutCall.body);
    assert.equal(payoutBody.items[0].receiver, 'merchant-sandbox@example.test');
    assert.equal(payoutBody.sender_batch_header.sender_batch_id, 'micropay_request_demo');

    response = await fetch(`${baseUrl}/requests/request_demo/status`);
    result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.request.transaction.status, 'executed');
    assert.equal(result.request.transaction.paypalStatus, 'SUCCESS');
    assert.equal(result.mission.budgetRemaining, 0.01);

    assert.equal(fs.readFileSync(dbPath).subarray(0, 16).toString(), 'SQLite format 3\u0000');
    assert.equal(db.requests.request_demo.transaction.status, 'executed');
    assert.equal(db.missions.mission_demo.budgetRemaining, 0.01);

    const invalidMissionResponse = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objective: 'Reject an uncontrolled budget',
        budgetTotal: 1_000_001,
        autoApproveThreshold: 1,
        maxPaymentsPerMinute: 3,
        minConfidence: 0.5,
        allowedProviders: [],
      }),
    });
    assert.equal(invalidMissionResponse.status, 400);
    assert.match((await invalidMissionResponse.json()).error, /budgetTotal/);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = realFetch;
    if (originalPaypalConfig) Object.assign(paypalConfig, originalPaypalConfig);
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
