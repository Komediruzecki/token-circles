import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { PLANS, BETA_NOTICE, FAIR_USE_NOTICE } from '../plans';

// Public plan catalogue — serves plans.ts (the single source of truth) to the frontend so the
// Billing tab's tier comparison stays in sync with worker enforcement. No auth: prices/features
// are public marketing info. No DB, so it's cheap.
export const plansRoutes = new Hono<AppEnv>();

plansRoutes.get('/api/plans', (c) => {
  return c.json({
    plans: Object.values(PLANS),
    notices: { beta: BETA_NOTICE, fairUse: FAIR_USE_NOTICE },
  });
});
