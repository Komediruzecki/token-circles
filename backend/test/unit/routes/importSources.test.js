/**
 * GET /api/import-sources on the legacy backend.
 *
 * Connected Sources is a Worker feature; this server has no table for it. The route exists
 * only so the answer is an honest empty list rather than a 404 — `ConnectedSources.tsx`
 * asks for it from `onMount` on every visit to the import page, and a 404 there is a
 * console error on a page that is otherwise fine.
 *
 * Runs in-process (supertest + the real router), no live server.
 */
const express = require('express');
const request = require('supertest');
const importSourcesRouter = require('../../../routes/importSources');

function buildApp({ authed = true } = {}) {
  const app = express();
  const requireAuth = (req, res, next) => {
    if (!authed) return res.status(401).json({ error: 'Unauthorized' });
    next();
  };
  app.use(importSourcesRouter({ requireAuth }));
  return app;
}

describe('GET /api/import-sources', () => {
  it('answers with an empty list rather than 404', async () => {
    const res = await request(buildApp()).get('/api/import-sources');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('is a JSON array, which is what the client destructures', async () => {
    const res = await request(buildApp()).get('/api/import-sources');
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('still requires a session, like every other /api route', async () => {
    const res = await request(buildApp({ authed: false })).get('/api/import-sources');
    expect(res.status).toBe(401);
  });

  it('does not accept writes — this backend has nowhere to put them', async () => {
    const app = buildApp();
    for (const method of ['post', 'put', 'delete']) {
      const res = await request(app)[method]('/api/import-sources/1');
      expect(res.status).toBe(404);
    }
  });
});
