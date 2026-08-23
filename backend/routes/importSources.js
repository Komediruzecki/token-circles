const express = require('express');
const { asyncHandler } = require('../lib/errors');

/**
 * Connected Sources, as much of it as this backend has: none.
 *
 * A saved import source is a Worker feature (migration 0020, worker/src/routes/import-sources.ts)
 * and there is no table for it here. But `ConnectedSources.tsx` asks for the list
 * unconditionally from `onMount`, so without this route every page load against this server
 * answers 404 — which the client already tolerates (`listImportSources` returns [] on a
 * non-ok response) but the browser still logs, and an E2E console check still trips over.
 *
 * So answer it truthfully rather than not at all: this backend holds no saved sources.
 * Deliberately read-only — see #406, which retires this server rather than growing it. The
 * writes stay absent because implementing them means a schema this backend will not live
 * long enough to need.
 */
module.exports = function ({ requireAuth }) {
  const router = express.Router();

  router.get(
    '/api/import-sources',
    requireAuth,
    asyncHandler((req, res) => {
      res.json([]);
    })
  );

  return router;
};
