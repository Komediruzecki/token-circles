/**
 * GET/PUT /api/retirement/settings on the legacy backend.
 *
 * The planner asks for these on every visit to the retirement page, unconditionally, and
 * this server had no route for them — so every visit was a guaranteed 404 and a console
 * error on a page that otherwise worked. page-loading.spec.ts catches it whenever its
 * sampling window happens to cover the request, which is why it surfaced as a flake.
 *
 * The route deliberately stores no defaults: an empty object is the honest answer when
 * nothing has been saved, and the client's normalizeSettings() fills every field in.
 * Restating DEFAULT_SETTINGS here would be a second copy of shared/retirementSettings.ts
 * with nothing keeping it in step.
 *
 * Runs in-process (supertest + the real router + a real settings repository backed by
 * in-memory sqlite), no live server.
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const request = require('supertest');
const Database = require('better-sqlite3');
const { initRepositories } = require('../../../repositories');
const retirementRouter = require('../../../routes/retirement');

function buildApp({ profileId = 3, authed = true } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, '../../../schema.sql'), 'utf8'));
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (1, ?, ?)').run('alice', 'x');
  db.prepare('INSERT INTO profiles (id, name, user_id) VALUES (1, ?, 1), (3, ?, 1)').run(
    'One',
    'Three'
  );

  const repos = initRepositories(db);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.repos = repos;
    req.headers['x-profile-id'] = String(profileId);
    req.session = { userId: 1 };
    next();
  });
  const requireAuth = (req, res, next) =>
    authed ? next() : res.status(401).json({ error: 'Unauthorized' });
  app.use(
    retirementRouter({
      apiRateLimiter: (req, res, next) => next(),
      logError: () => {},
      requireAuth,
    })
  );
  // The repos come back so a test can write a value the route did not produce.
  app.repos = repos;
  return app;
}

describe('GET /api/retirement/settings', () => {
  it('answers with an empty settings object rather than 404', async () => {
    const res = await request(buildApp()).get('/api/retirement/settings');
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({});
  });

  it('returns the envelope the planner destructures', async () => {
    const res = await request(buildApp()).get('/api/retirement/settings');
    expect(Array.isArray(res.body.filled)).toBe(true);
    expect(Array.isArray(res.body.missing)).toBe(true);
    // The planner indexes the projection by month, so a malformed one is worse than none.
    expect(res.body.startMonth).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });

  it('still requires a session', async () => {
    const res = await request(buildApp({ authed: false })).get('/api/retirement/settings');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/retirement/settings', () => {
  it('stores what it is given and reads it back', async () => {
    const app = buildApp();
    const saved = { netWorth: 54321, mode: 'advanced', annualReturnPct: 6.5 };
    const put = await request(app).put('/api/retirement/settings').send(saved);
    expect(put.status).toBe(200);
    expect(put.body.settings).toEqual(saved);

    const get = await request(app).get('/api/retirement/settings');
    expect(get.body.settings).toEqual(saved);
  });

  it('keeps each profile’s plan to itself', async () => {
    const three = buildApp({ profileId: 3 });
    await request(three).put('/api/retirement/settings').send({ netWorth: 54321 });
    expect((await request(three).get('/api/retirement/settings')).body.settings).toEqual({
      netWorth: 54321,
    });

    // A different profile on the same database must not inherit it.
    const one = buildApp({ profileId: 1 });
    expect((await request(one).get('/api/retirement/settings')).body.settings).toEqual({});
  });

  it('survives a blob it cannot parse instead of failing the page', async () => {
    const app = buildApp();
    // Write a value the route would never produce — a truncated row, or something left by
    // an older format. Answering 500 here would take down a page that works fine on
    // defaults.
    app.repos.settings.upsert('retirement_settings:3', '{"netWorth": 1', 3);

    const res = await request(app).get('/api/retirement/settings');
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({});
  });
});
