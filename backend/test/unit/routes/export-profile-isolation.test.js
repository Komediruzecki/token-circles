/**
 * In-process integration test for GET /api/export cross-user isolation.
 *
 * Regression coverage: the export built its `profiles` array with an unscoped
 * `SELECT * FROM profiles`, so ANY signed-in user's export leaked EVERY user's profile
 * rows (names + user_ids). It now uses profiles.listByUserId(session.userId). (Financial
 * tables were already scoped via getProfileIds, which also fails closed with 403 on a
 * profile the caller doesn't own — asserted below as defense-in-depth.)
 *
 * Runs entirely in-process (supertest + real router + real repositories + in-memory
 * better-sqlite3) — no live server.
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const request = require('supertest');
const Database = require('better-sqlite3');
const { initRepositories } = require('../../../repositories');
const exportRouter = require('../../../routes/exportRoutes');

function buildApp(sessionUserId) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, '../../../schema.sql'), 'utf8'));

  // TWO users, each owning one profile.
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (1, ?, ?), (2, ?, ?)').run(
    'alice',
    'x',
    'bob',
    'y'
  );
  db.prepare('INSERT INTO profiles (id, name, user_id) VALUES (1, ?, 1), (2, ?, 2)').run(
    'Alice-Home',
    'Bob-Secret'
  );

  const repos = initRepositories(db);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: sessionUserId };
    req.repos = repos;
    next();
  });
  const passthrough = (_req, _res, next) => next();
  app.use(
    exportRouter({ apiRateLimiter: passthrough, requireAuth: passthrough, logError: () => {} })
  );
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) =>
    res.status(err.statusCode || err.status || 500).json({ error: err.message })
  );
  return { app, db };
}

describe('GET /api/export — cross-user profile isolation', () => {
  test('exports only the signed-in user’s own profiles, never another user’s', async () => {
    const { app } = buildApp(1); // signed in as Alice (user 1)
    const res = await request(app).get('/api/export').set('X-Profile-Id', '1');

    expect(res.status).toBe(200);
    const ids = res.body.profiles.map((p) => p.id).sort();
    const ownerIds = [...new Set(res.body.profiles.map((p) => p.user_id))];
    expect(ids).toEqual([1]); // only Alice's profile row
    expect(ownerIds).toEqual([1]); // never Bob's
    expect(res.body.profiles.some((p) => p.name === 'Bob-Secret')).toBe(false);
  });

  test('requesting another user’s profile is refused (403) — financial data never leaks', async () => {
    const { app } = buildApp(1); // Alice tries to export Bob's profile (id 2)
    const res = await request(app).get('/api/export').set('X-Profile-Id', '2');
    expect(res.status).toBe(403);
  });
});
