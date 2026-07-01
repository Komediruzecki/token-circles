/**
 * In-process integration tests for the transactions router money paths.
 *
 * Regression coverage for two CRITICAL defects fixed alongside this test:
 *   1. Account-balance mutations bound a profile-id ARRAY to a single `IN (?)` placeholder.
 *      better-sqlite3 flattens an array argument into anonymous params, so any request that
 *      selected more than one profile (the `X-Profile-Ids` header) bound too many values and
 *      threw "Too many parameter values were provided" — crashing every balance mutation.
 *   2. The transaction row was persisted before the balance updates ran, with no wrapping
 *      `db.transaction()`, so a mid-sequence failure committed a row with half-applied (or
 *      un-applied) balances — literally creating or destroying money.
 *
 * The test runs entirely in-process (supertest against the real router + real repositories +
 * an in-memory better-sqlite3), so it needs no live server.
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const request = require('supertest');
const Database = require('better-sqlite3');
const { initRepositories } = require('../../../repositories');
const transactionsRouter = require('../../../routes/transactions');

function buildApp() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, '../../../schema.sql'), 'utf8'));

  // One user, two profiles owned by that user, two accounts + a category on profile 1.
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (1, ?, ?)').run('tester', 'x');
  db.prepare('INSERT INTO profiles (id, name, user_id) VALUES (1, ?, 1), (2, ?, 1)').run(
    'P1',
    'P2'
  );
  db.prepare(
    'INSERT INTO accounts (id, name, type, balance, starting_balance, profile_id) VALUES (1, ?, ?, ?, ?, 1)'
  ).run('Checking', 'giro', 1000, 1000);
  db.prepare(
    'INSERT INTO accounts (id, name, type, balance, starting_balance, profile_id) VALUES (2, ?, ?, ?, ?, 1)'
  ).run('Savings', 'savings', 500, 500);
  db.prepare(
    "INSERT INTO categories (id, name, type, profile_id) VALUES (1, 'Food', 'expense', 1)"
  ).run();

  const repos = initRepositories(db);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: 1 };
    req.repos = repos;
    next();
  });
  const passthrough = (_req, _res, next) => next();
  app.use(
    transactionsRouter({
      apiRateLimiter: passthrough,
      requireAuth: passthrough,
      logError: () => {},
    })
  );
  // Minimal error handler so thrown AppErrors/DB errors surface as clean status codes.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

  return { app, db, repos };
}

const balanceOf = (db, id) =>
  db.prepare('SELECT balance FROM accounts WHERE id = ?').get(id).balance;
const txCount = (db) => db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;

const post = (app, body, headers = { 'X-Profile-Id': '1' }) =>
  Object.entries(headers)
    .reduce((r, [k, v]) => r.set(k, v), request(app).post('/api/transactions'))
    .send(body);

describe('transactions router — account balance integrity', () => {
  let app, db, repos;
  beforeEach(() => {
    ({ app, db, repos } = buildApp());
  });
  afterEach(() => {
    db.close();
  });

  test('expense decrements the linked account (single profile)', async () => {
    const res = await post(app, {
      description: 'Lunch',
      amount: 100,
      type: 'expense',
      account_id: 1,
      category_id: 1,
    });
    expect(res.status).toBe(200);
    expect(balanceOf(db, 1)).toBe(900);
  });

  test('income increments the linked account', async () => {
    const res = await post(app, {
      description: 'Paycheck',
      amount: 200,
      type: 'income',
      account_id: 1,
    });
    expect(res.status).toBe(200);
    expect(balanceOf(db, 1)).toBe(1200);
  });

  test('transfer moves money between the two accounts', async () => {
    const res = await post(app, {
      description: 'Move to savings',
      amount: 300,
      type: 'transfer',
      account_id: 1,
      transfer_account_id: 2,
    });
    expect(res.status).toBe(200);
    expect(balanceOf(db, 1)).toBe(700);
    expect(balanceOf(db, 2)).toBe(800);
  });

  // --- CRITICAL #1: the multi-profile regression ---
  test('balance mutation succeeds when multiple profiles are selected (X-Profile-Ids)', async () => {
    const res = await post(
      app,
      {
        description: 'Multi-profile expense',
        amount: 150,
        type: 'expense',
        account_id: 1,
        category_id: 1,
      },
      { 'X-Profile-Id': '1', 'X-Profile-Ids': JSON.stringify([1, 2]) }
    );
    // Before the fix this returned 500 (RangeError: Too many parameter values were provided).
    expect(res.status).toBe(200);
    expect(balanceOf(db, 1)).toBe(850);
  });

  test('updating an amount reverses the old effect and applies the new one', async () => {
    const created = await post(app, {
      description: 'Groceries',
      amount: 100,
      type: 'expense',
      account_id: 1,
    });
    expect(balanceOf(db, 1)).toBe(900);
    const res = await request(app)
      .put(`/api/transactions/${created.body.id}`)
      .set('X-Profile-Id', '1')
      .send({ amount: 30 });
    expect(res.status).toBe(200);
    expect(balanceOf(db, 1)).toBe(970); // +100 reversal, -30 re-apply
  });

  test('changing an expense to income flips the balance effect', async () => {
    const created = await post(app, {
      description: 'Refundable',
      amount: 100,
      type: 'expense',
      account_id: 1,
    });
    expect(balanceOf(db, 1)).toBe(900);
    const res = await request(app)
      .put(`/api/transactions/${created.body.id}`)
      .set('X-Profile-Id', '1')
      .send({ type: 'income' });
    expect(res.status).toBe(200);
    expect(balanceOf(db, 1)).toBe(1100); // +100 reversal, +100 income re-apply
  });

  test('deleting a transaction reverses its balance effect', async () => {
    const created = await post(app, {
      description: 'Toaster',
      amount: 100,
      type: 'expense',
      account_id: 1,
    });
    expect(balanceOf(db, 1)).toBe(900);
    const res = await request(app)
      .delete(`/api/transactions/${created.body.id}`)
      .set('X-Profile-Id', '1');
    expect(res.status).toBe(200);
    expect(balanceOf(db, 1)).toBe(1000);
    expect(txCount(db)).toBe(0);
  });

  // --- CRITICAL #2: atomicity ---
  test('a failed balance update rolls back the inserted row (no orphaned money)', async () => {
    const before = txCount(db);
    const originalRun = repos.accounts.run.bind(repos.accounts);
    repos.accounts.run = () => {
      throw new Error('simulated balance-update failure');
    };
    try {
      const res = await post(app, {
        description: 'Should roll back',
        amount: 100,
        type: 'expense',
        account_id: 1,
      });
      expect(res.status).toBe(500);
    } finally {
      repos.accounts.run = originalRun;
    }
    // The INSERT must have rolled back with the failed balance update.
    expect(txCount(db)).toBe(before);
    expect(balanceOf(db, 1)).toBe(1000);
  });

  // --- bulk-delete parity: transfers stored with a NULL account_id were skipped ---
  test('bulk delete reverses a transfer credited only to a destination account', async () => {
    const created = await post(app, {
      description: 'Incoming transfer',
      amount: 250,
      type: 'transfer',
      transfer_account_id: 2,
    });
    expect(created.status).toBe(200);
    expect(balanceOf(db, 2)).toBe(750); // +250 credited to the destination on create
    const res = await request(app)
      .put('/api/transactions/bulk')
      .set('X-Profile-Id', '1')
      .send({ ids: [created.body.id], action: 'delete' });
    expect(res.status).toBe(200);
    expect(balanceOf(db, 2)).toBe(500); // credit reversed on bulk delete
    expect(txCount(db)).toBe(0);
  });

  test('bulk delete reverses a transfer with only a source account', async () => {
    const created = await post(app, {
      description: 'Outgoing transfer',
      amount: 200,
      type: 'transfer',
      account_id: 1,
    });
    expect(created.status).toBe(200);
    expect(balanceOf(db, 1)).toBe(800); // -200 from the source on create
    const res = await request(app)
      .put('/api/transactions/bulk')
      .set('X-Profile-Id', '1')
      .send({ ids: [created.body.id], action: 'delete' });
    expect(res.status).toBe(200);
    expect(balanceOf(db, 1)).toBe(1000); // source restored on bulk delete
    expect(txCount(db)).toBe(0);
  });

  // --- list endpoint attaches tags in one batched query (was N+1) ---
  test('GET list attaches tags to each row', async () => {
    const created = await post(app, {
      description: 'Tagged',
      amount: 10,
      type: 'expense',
      account_id: 1,
    });
    const txId = created.body.id;
    db.prepare(
      "INSERT INTO tags (id, name, color, profile_id) VALUES (1, 'Vacation', '#abcdef', 1)"
    ).run();
    db.prepare('INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, 1)').run(txId);
    const res = await request(app).get('/api/transactions').set('X-Profile-Id', '1');
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r) => r.id === txId);
    expect(row.tags).toEqual([{ id: 1, name: 'Vacation', color: '#abcdef' }]);
  });
});
