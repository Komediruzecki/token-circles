import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth';
import { profilesRoutes } from './routes/profiles';
import { accountsRoutes } from './routes/accounts';
import { transactionsRoutes } from './routes/transactions';
import { categoriesRoutes } from './routes/categories';
import { tagsRoutes } from './routes/tags';
import { budgetsRoutes } from './routes/budgets';
import { billsRoutes } from './routes/bills';
import { recurringRoutes } from './routes/recurring';
import { savingsGoalsRoutes } from './routes/savings-goals';
import { loansRoutes } from './routes/loans';
import { portfolioRoutes } from './routes/portfolio';
import { housingRoutes } from './routes/housing';
import { retirementGoalsRoutes } from './routes/retirement-goals';
import { counterpartiesRoutes } from './routes/counterparties';
import { settingsRoutes } from './routes/settings';
import { dashboardRoutes } from './routes/dashboard';
import { analyticsRoutes } from './routes/analytics';
import { calculatorsRoutes } from './routes/calculators';
import { reportsRoutes } from './routes/reports';
import { receiptsRoutes } from './routes/receipts';
import { importRoutes } from './routes/imports';
import { exportRoutes } from './routes/exports';
import { billingRoutes } from './routes/billing';

/** Bindings declared in wrangler.toml (env.*) plus secrets (wrangler secret put). */
export interface Env {
  DB: D1Database;
  JWT_SECRET?: string; // secret — signs JWTs and the OAuth state
  GOOGLE_CLIENT_ID?: string; // var — OAuth client id (also checked as id_token aud)
  GOOGLE_CLIENT_SECRET?: string; // secret — for the server-side code exchange
  CORS_ORIGIN?: string; // the app origin (also auto-allowed as a returnTo)
  APP_ORIGINS?: string; // comma-separated extra allowed returnTo origins
  COOKIE_DOMAIN?: string; // e.g. ".yourdomain.com" to share the session cookie with the app
  APP_ENV?: string; // 'development' drops the Secure cookie flag for local http dev
  RECEIPTS?: R2Bucket; // R2 bucket for premium receipt files (optional until the bucket exists)
  STRIPE_SECRET_KEY?: string; // secret — Stripe API key (sk_…); unset → billing endpoints 501
  STRIPE_WEBHOOK_SECRET?: string; // secret — Stripe webhook signing secret (whsec_…)
  STRIPE_PRICE_ID?: string; // var — recurring Price id (price_…) for the premium plan
}

/** Hono generics shared across route modules: bindings + per-request vars. */
export type AppEnv = { Bindings: Env; Variables: { userId: number } };

const app = new Hono<AppEnv>();

// CORS — origin comes from the env var so it's domain-agnostic until you have one.
// credentials:true is required so the browser sends the session cookie cross-origin.
app.use('*', (c, next) => cors({ origin: c.env.CORS_ORIGIN ?? '*', credentials: true })(c, next));

// Public health check (no auth) — handy for uptime checks and the deploy smoke test.
app.get('/api/health', (c) => c.json({ ok: true, env: c.env.APP_ENV ?? 'unknown' }));

// Auth: Google Sign-In + session endpoints. start/callback are public; me/logout self-gate.
app.route('/', authRoutes);

// ── Data route modules (each applies requireAuth + profile scoping) ───────────
// Ported from backend/routes/*.js. The remaining 501 stubs (see the modules) only
// cover things that need Workers infra not set up yet: PDF/xlsx generation, receipt
// file storage (needs an R2 bucket), and spreadsheet-file imports.
app.route('/', profilesRoutes);
app.route('/', accountsRoutes);
app.route('/', transactionsRoutes);
app.route('/', categoriesRoutes);
app.route('/', tagsRoutes);
app.route('/', budgetsRoutes);
app.route('/', billsRoutes);
app.route('/', recurringRoutes);
app.route('/', savingsGoalsRoutes);
app.route('/', loansRoutes);
app.route('/', portfolioRoutes);
app.route('/', housingRoutes);
app.route('/', retirementGoalsRoutes);
app.route('/', counterpartiesRoutes);
app.route('/', settingsRoutes);
app.route('/', dashboardRoutes);
app.route('/', analyticsRoutes);
app.route('/', calculatorsRoutes);
app.route('/', reportsRoutes);
app.route('/', receiptsRoutes);
app.route('/', importRoutes);
app.route('/', exportRoutes);
app.route('/', billingRoutes);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Mirrors the Express AppError handler: honor an attached statusCode, else 500.
app.onError((err, c) => {
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  return c.json({ error: err.message || 'Internal Server Error' }, status as 500);
});

export default app;
