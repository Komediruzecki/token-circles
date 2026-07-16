const express = require('express');

// Billing is a hosted feature (Stripe lives on the Cloudflare worker). This
// backend — self-hosted/test deployments — mirrors the worker's "unconfigured"
// response so the client's plan probe on boot gets a clean 200 instead of a
// console-spamming 404. Everything stays on the free tier here.
module.exports = function ({ apiRateLimiter, requireAuth }) {
  const router = express.Router();

  router.get('/api/billing/status', apiRateLimiter, requireAuth, (req, res) => {
    res.json({
      plan: 'free',
      status: null,
      renews_at: null,
      cancel_at_period_end: false,
      configured: false,
      availablePlans: [],
    });
  });

  return router;
};
