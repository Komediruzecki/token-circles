import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { authRoutes } from './routes/auth';
import { twofaRoutes } from './routes/twofa';
import { emailCodeRoutes } from './routes/email-code';
import { passkeyRoutes } from './routes/passkeys';
import { profilesRoutes } from './routes/profiles';
import { accountRoutes } from './routes/account';
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
import { turnstileConfigured } from './turnstile';
import { dashboardRoutes } from './routes/dashboard';
import { analyticsRoutes } from './routes/analytics';
import { calculatorsRoutes } from './routes/calculators';
import { reportsRoutes } from './routes/reports';
import { receiptsRoutes } from './routes/receipts';
import { importRoutes } from './routes/imports';
import { importLogsRoutes } from './routes/import-logs';
import { importSourcesRoutes } from './routes/import-sources';
import { exportRoutes } from './routes/exports';
import { billingRoutes } from './routes/billing';
import { notificationsRoutes } from './routes/notifications';
import { supportRoutes } from './routes/support';
import { plansRoutes } from './routes/plans';
import { apiTokensRoutes } from './routes/api-tokens';
import { v1Routes } from './routes/v1';
import { mcpRoutes } from './mcp';
import { runScheduledReminders } from './reminders';
import { runScheduledSheetSyncs } from './import-sync';
import { handleIngestEmail } from './import-email';
import { sweepRateLimits } from './ratelimit';
import { sweepExpiredSessions } from './auth';
import { isTransientD1Error } from './db';
import { logWorkerError } from './errorlog';
import { type TokenIdentity } from './apitoken';

/** Bindings declared in wrangler.toml (env.*) plus secrets (wrangler secret put). */
export interface Env {
  DB: D1Database;
  JWT_SECRET?: string; // secret — signs JWTs and the OAuth state
  GOOGLE_CLIENT_ID?: string; // var — OAuth client id (also checked as id_token aud)
  GOOGLE_CLIENT_SECRET?: string; // secret — for the server-side code exchange
  CORS_ORIGIN?: string; // the app origin (also auto-allowed as a returnTo)
  APP_ORIGINS?: string; // comma-separated extra allowed returnTo origins
  API_PUBLIC_ORIGIN?: string; // public origin of THIS worker — email links (unsubscribe) target it
  COOKIE_DOMAIN?: string; // e.g. ".yourdomain.com" to share the session cookie with the app
  APP_ENV?: string; // 'development' drops the Secure cookie flag for local http dev
  RECEIPTS?: R2Bucket; // R2 bucket for premium receipt files (optional until the bucket exists)
  STRIPE_SECRET_KEY?: string; // secret — Stripe API key (sk_…); unset → billing endpoints 501
  STRIPE_WEBHOOK_SECRET?: string; // secret — Stripe webhook signing secret (whsec_…)
  STRIPE_PRICE_ID?: string; // var — legacy single Price id; treated as Advanced monthly
  STRIPE_PRICE_BASIC_MONTHLY?: string; // var — per-tier Price ids (set when created in Stripe)
  STRIPE_PRICE_BASIC_ANNUAL?: string;
  STRIPE_PRICE_ADVANCED_MONTHLY?: string;
  STRIPE_PRICE_ADVANCED_ANNUAL?: string;
  STRIPE_PRICE_ULTIMATE_MONTHLY?: string;
  STRIPE_PRICE_ULTIMATE_ANNUAL?: string;
  RESEND_API_KEY?: string; // secret — Resend API key for reminder emails (unset → emails skip)
  EMAIL_FROM?: string; // var — From address, e.g. "Token Circles <hello@tokencircles.com>" (repliable, not no-reply)
  SUPPORT_EMAIL?: string; // secret — private inbox the contact form relays to (unset → disabled)
  TURNSTILE_SECRET?: string; // secret — Cloudflare Turnstile secret; unset → captcha gate disabled
  EMAIL_INGEST_SECRET?: string; // secret — token in the ingest address +tag (ingest+<secret>@…); unset → email-in disabled
  EMAIL_INGEST_PROFILE_ID?: string; // var — profile id that emailed statements import into
  EMAIL_INGEST_ALLOWED_SENDERS?: string; // var — optional comma-separated sender allowlist
}

/** Hono generics shared across route modules: bindings + per-request vars. */
export type AppEnv = {
  Bindings: Env;
  Variables: { userId: number; sessionId?: string; token?: TokenIdentity };
};

const app = new Hono<AppEnv>();

// CORS — origin comes from the env var. credentials:true is required so the browser sends the
// session cookie cross-origin; with credentials, `*` is invalid anyway, so fail CLOSED (allow
// nothing cross-origin) rather than reflect `*` when CORS_ORIGIN is unset/misconfigured.
app.use('*', (c, next) => cors({ origin: c.env.CORS_ORIGIN ?? '', credentials: true })(c, next));

// Security headers on every response (audit S2). The API returns JSON plus a few inline-styled
// transactional HTML pages (password-reset landing, unsubscribe), so the CSP allows inline styles
// but no scripts, and forbids framing. HSTS pins HTTPS; nosniff blocks MIME sniffing on any
// file/receipt bytes proxied through the API.
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      styleSrc: ["'unsafe-inline'"],
      imgSrc: ['data:', 'https:'],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
    xFrameOptions: 'DENY',
    referrerPolicy: 'no-referrer',
  })
);

// Public health check (no auth) — handy for uptime checks and the deploy smoke test.
// `captcha` is here so a deploy can be checked without attempting a sign-in: "missing" means
// the gate has no secret and every password sign-in on this environment fails closed. It
// reports only whether a secret exists, which is not a fact worth hiding — in the "missing"
// state nobody can authenticate at all.
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    env: c.env.APP_ENV ?? 'unknown',
    captcha: turnstileConfigured(c.env)
      ? 'configured'
      : c.env.APP_ENV === 'development'
        ? 'disabled'
        : 'missing',
  })
);

// Auth: Google Sign-In + session endpoints. start/callback are public; me/logout self-gate.
app.route('/', authRoutes);
app.route('/', twofaRoutes);
app.route('/', emailCodeRoutes);
app.route('/', passkeyRoutes);

// ── Data route modules (each applies requireAuth + profile scoping) ───────────
// Ported from backend/routes/*.js. The remaining 501 stubs (see the modules) only
// cover things that need Workers infra not set up yet: PDF/xlsx generation, receipt
// file storage (needs an R2 bucket), and spreadsheet-file imports.
app.route('/', profilesRoutes);
app.route('/', accountRoutes);
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
app.route('/', importLogsRoutes);
app.route('/', importSourcesRoutes);
app.route('/', exportRoutes);
app.route('/', billingRoutes);
app.route('/', notificationsRoutes);
app.route('/', supportRoutes);
app.route('/', plansRoutes);
app.route('/', apiTokensRoutes);
app.route('/', v1Routes);
app.route('/', mcpRoutes);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Mirrors the Express AppError handler: honor an attached statusCode, else 500.
app.onError((err, c) => {
  // A `d1 export` backup (deploy-worker.yml) or a transient blip briefly locks D1 — and the
  // in-helper retries (db.ts) were exhausted (or the query bypassed the helpers). Return a
  // retryable 503 instead of a hard 500, and skip persisting it to the (also-locked) error_logs.
  if (isTransientD1Error(err)) {
    c.header('Retry-After', '5');
    return c.json({ error: 'Service temporarily unavailable, please retry shortly.' }, 503);
  }
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  // Log the failure (structured console.error → Workers Observability; 5xx also persisted to the
  // error_logs D1 table). Best-effort; never let logging change the response.
  logWorkerError(c, err, status);
  return c.json({ error: err.message || 'Internal Server Error' }, status as 500);
});

// Object export: the Worker serves HTTP (app.fetch) AND runs cron reminders (scheduled).
// Cron schedules live in wrangler.jsonc → env.<env>.triggers.crons.
export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(
      Promise.all([
        runScheduledReminders(event.cron, env),
        sweepRateLimits(env),
        sweepExpiredSessions(env),
        runScheduledSheetSyncs(event.cron, env),
      ])
    );
  },
  // Cloudflare Email Routing → email-in (Ask 3). Configured via EMAIL_INGEST_* (see import-email.ts);
  // a no-op reject when unset. Awaited directly so setReject lands before the runtime finalizes.
  email: async (message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext) => {
    await handleIngestEmail(message, env);
  },
};
