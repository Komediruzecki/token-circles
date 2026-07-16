/**
 * Branded transactional email templates — every mail Token Circles sends,
 * rendered by pure functions returning { subject, html, text }.
 *
 * Architecture notes (mirrors the proven MercuryPitch email module):
 *  - Hand-written, table-based HTML with ALL styles inline — the only layout
 *    dialect every mail client speaks. No email framework, no build step.
 *  - No inline SVG and no emoji: Gmail strips <svg>, many clients mangle
 *    emoji. Branding rides on hosted images (the app's PNG logo + a small
 *    orbit-animation GIF whose first frame stands alone for clients that
 *    freeze GIFs, e.g. some Outlooks).
 *  - Dark-only: <meta name="color-scheme" content="dark"> plus explicit dark
 *    backgrounds everywhere, so "smart" clients don't invert the design.
 *  - Every renderer also returns a plain-text twin (deliverability + a11y).
 *  - Renderers are pure (no I/O, no Env) so they can be unit-tested and
 *    previewed; callers pass links/currency in.
 */

// ── Brand constants ───────────────────────────────────────────────────────────

export const BRAND = 'Token Circles';

const APP_URL = 'https://tokencircles.com';
const ABOUT_URL = 'https://about.tokencircles.com';
const REPO_URL = 'https://github.com/Komediruzecki/token-circles';
const TERMS_URL = `${ABOUT_URL}/terms`;
const PRIVACY_URL = `${ABOUT_URL}/privacy`;
const CONTACT_EMAIL = 'hello@tokencircles.com';
// Mail assets load from the SENDING environment's app origin (dev mails must
// not depend on a prod release shipping the asset); footer links stay
// canonical. Defaults to the prod app for safety.
const logoUrl = (origin: string) => `${origin}/icon-192.png`;
const orbitGifUrl = (origin: string) => `${origin}/email/orbit.gif`;

// Orbital Observatory palette (mirrors frontend orbit-dark.css tokens).
const C = {
  page: '#0a0e1c',
  card: '#131c39',
  panel: '#0e1430',
  border: '#26324f',
  text: '#eaf0ff',
  muted: '#9fb0d6',
  faint: '#6b7a9e',
  primary: '#6e9bff',
  primaryStrong: '#3b6fe0',
  warm: '#f0a860',
  income: '#7dffb0',
  expense: '#ff9d9d',
} as const;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeColor(color: unknown): string {
  return /^#[0-9a-fA-F]{6}$/.test(String(color ?? '')) ? String(color) : C.faint;
}

/** Currency-aware money formatting; tolerates unknown ISO codes. */
export function formatMoney(amount: number, currency?: string | null): string {
  const value = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'EUR').toUpperCase(),
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ''}`.trim();
  }
}

const btn = (href: string, label: string, testId?: string) =>
  `<a href="${href}" ${testId ? `data-tid="${testId}"` : ''}style="display:inline-block;background:${C.primaryStrong};color:#ffffff;text-decoration:none;font-family:${FONT};font-size:15px;font-weight:600;padding:12px 26px;border-radius:10px">${escapeHtml(label)}</a>`;

/** Left-accented feature/info card (welcome mail, notices). */
const card = (title: string, body: string, accent: string = C.primary) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px"><tr>
    <td style="background:${C.panel};border:1px solid ${C.border};border-left:3px solid ${accent};border-radius:10px;padding:14px 16px">
      <div style="font-family:${FONT};font-size:14px;font-weight:600;color:${C.text};margin:0 0 4px">${title}</div>
      <div style="font-family:${FONT};font-size:13px;line-height:1.55;color:${C.muted}">${body}</div>
    </td>
  </tr></table>`;

/**
 * The shared shell: dark page, centered 600px card, orbit-GIF masthead with
 * the logo + serif wordmark, body content, and the branded footer.
 */
function shell(opts: {
  title: string;
  preheader: string;
  body: string;
  footerReason: string;
  unsubUrl?: string | null;
  /** Show the animated orbit ornament under the masthead (default true). */
  orbit?: boolean;
  /** Origin serving the logo/GIF assets (the sending env's app origin). */
  assetOrigin?: string;
}): string {
  const unsub = opts.unsubUrl
    ? ` &nbsp;&middot;&nbsp; <a href="${opts.unsubUrl}" style="color:${C.faint};text-decoration:underline">Unsubscribe</a>`
    : '';
  const assets = opts.assetOrigin || APP_URL;
  const orbit =
    opts.orbit === false
      ? ''
      : `<tr><td align="center" style="padding:2px 0 14px">
          <img src="${orbitGifUrl(assets)}" width="72" height="72" alt="" style="display:block;border:0;outline:none" />
        </td></tr>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page}">
  <!-- preheader: shows next to the subject in inbox lists, invisible in the mail -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(opts.preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}">
    <tr><td align="center" style="padding:28px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
        <!-- masthead -->
        <tr><td align="center" style="padding:6px 0 16px">
          <a href="${APP_URL}" style="text-decoration:none">
            <img src="${logoUrl(assets)}" width="34" height="34" alt="${BRAND}" style="vertical-align:middle;border:0;border-radius:9px" />
            <span style="font-family:${SERIF};font-size:22px;font-weight:700;color:${C.text};letter-spacing:0.3px;vertical-align:middle">&nbsp;Token&nbsp;Circles</span>
          </a>
        </td></tr>
        ${orbit}
        <!-- card -->
        <tr><td style="background:${C.card};border:1px solid ${C.border};border-radius:16px;padding:30px 30px 26px">
          ${opts.body}
        </td></tr>
        <!-- footer -->
        <tr><td align="center" style="padding:22px 16px 6px">
          <div style="font-family:${FONT};font-size:12px;line-height:1.7;color:${C.faint}">
            Your money, in clear orbit. Open source and local-first.<br />
            <a href="${APP_URL}" style="color:${C.muted};text-decoration:none">Open the app</a> &nbsp;&middot;&nbsp;
            <a href="${ABOUT_URL}" style="color:${C.muted};text-decoration:none">About</a> &nbsp;&middot;&nbsp;
            <a href="${REPO_URL}" style="color:${C.muted};text-decoration:none">GitHub</a> &nbsp;&middot;&nbsp;
            <a href="${TERMS_URL}" style="color:${C.muted};text-decoration:none">Terms</a> &nbsp;&middot;&nbsp;
            <a href="${PRIVACY_URL}" style="color:${C.muted};text-decoration:none">Privacy</a> &nbsp;&middot;&nbsp;
            <a href="mailto:${CONTACT_EMAIL}" style="color:${C.muted};text-decoration:none">Contact</a>
          </div>
          <div style="font-family:${FONT};font-size:11.5px;line-height:1.7;color:${C.faint};margin-top:8px">
            ${escapeHtml(opts.footerReason)}${unsub}<br />
            &copy; ${new Date().getUTCFullYear()} ${BRAND} &middot; AGPL-3.0
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const h1 = (text: string) =>
  `<h1 style="font-family:${SERIF};font-size:24px;font-weight:700;color:${C.text};margin:0 0 12px">${text}</h1>`;
const p = (text: string, extra = '') =>
  `<p style="font-family:${FONT};font-size:14.5px;line-height:1.65;color:${C.muted};margin:0 0 14px;${extra}">${text}</p>`;

const textFooter = (reason: string, unsubUrl?: string | null) =>
  `\n—\n${BRAND} — your money, in clear orbit.\nApp: ${APP_URL}\nAbout: ${ABOUT_URL}\nGitHub: ${REPO_URL}\nTerms: ${TERMS_URL} · Privacy: ${PRIVACY_URL} · Contact: ${CONTACT_EMAIL}\n${reason}${unsubUrl ? `\nUnsubscribe: ${unsubUrl}` : ''}`;

// ── Renderers ─────────────────────────────────────────────────────────────────

/** Welcome — sent to every brand-new account (email/password AND Google). */
export function renderWelcome(opts: { appUrl?: string }): RenderedEmail {
  const app = opts.appUrl || APP_URL;
  const subject = `Welcome to ${BRAND} — your orbit is ready`;
  const body = `
    ${h1('Welcome aboard')}
    ${p(`Your ${BRAND} account is ready. Everything orbits your accounts: add one, bring your history, and the dashboards light up.`)}
    ${card('Create your first account', 'The home for your balance and transactions — checking, savings, cash or brokerage. The setup wizard walks you through it.')}
    ${card('Bring your history', 'Import bank statements (Revolut, Erste, PBZ), CSV files, or Google Sheets. Duplicates are detected and skipped automatically.', C.warm)}
    ${card('Subscriptions, spotted', 'We recognize recurring charges — Netflix, Spotify, Claude and 40+ more — from your imported transactions and offer to track them.')}
    <div style="padding:8px 0 4px">${btn(app, `Open ${BRAND}`)}</div>
    ${p(`If you didn't create this account, you can safely ignore this email.`, `font-size:12.5px;color:${C.faint};margin:16px 0 0`)}
  `;
  return {
    subject,
    html: shell({
      title: subject,
      preheader: 'Your account is ready — set up your first account and bring your history.',
      body,
      footerReason: 'You received this because an account was created with this address.',
      assetOrigin: opts.appUrl,
    }),
    text: `Welcome to ${BRAND}\n\nYour account is ready. Sign in to set up your first account, import your history (bank statements, CSV, Google Sheets), and let us spot your subscriptions automatically.\n\nOpen the app: ${app}\n\nIf you didn't create this account, you can safely ignore this email.${textFooter('You received this because an account was created with this address.')}`,
  };
}

/** Anti-enumeration notice: someone tried to register an existing address. */
export function renderAccountExists(opts: { appUrl?: string }): RenderedEmail {
  const app = opts.appUrl || APP_URL;
  const subject = `You already have a ${BRAND} account`;
  const body = `
    ${h1('You already have an account')}
    ${p(`Someone just tried to create a ${BRAND} account with this email address — but one already exists.`)}
    ${p(`If that was you, simply sign in, or reset your password if you've forgotten it. If it wasn't you, no action is needed; your account is unchanged.`)}
    <div style="padding:8px 0 4px">${btn(app, 'Sign in')}</div>
  `;
  return {
    subject,
    html: shell({
      title: subject,
      preheader: 'A signup was attempted with your address — your account is unchanged.',
      body,
      footerReason: 'Security notice for your existing account.',
      orbit: false,
      assetOrigin: opts.appUrl,
    }),
    text: `You already have a ${BRAND} account\n\nSomeone tried to register with this email address, but an account already exists. If that was you, sign in at ${app} — or reset your password. If it wasn't you, no action is needed.${textFooter('Security notice for your existing account.')}`,
  };
}

/** Password reset magic link. */
export function renderPasswordReset(opts: {
  link: string;
  ttlHours: number;
  assetOrigin?: string;
}): RenderedEmail {
  const ttl = opts.ttlHours === 1 ? '1 hour' : `${opts.ttlHours} hours`;
  const subject = `Reset your ${BRAND} password`;
  const body = `
    ${h1('Reset your password')}
    ${p(`We received a request to reset the password for your ${BRAND} account. Click the button below to choose a new one.`)}
    <div style="padding:8px 0 12px">${btn(opts.link, 'Reset password')}</div>
    ${p(`This link expires in ${ttl}. If you didn't request a reset, ignore this email — your password won't change.`, `font-size:12.5px;color:${C.faint}`)}
    ${p(`If the button doesn't work, copy this link:<br /><span style="word-break:break-all;color:${C.muted}">${escapeHtml(opts.link)}</span>`, `font-size:12px;color:${C.faint};margin:0`)}
  `;
  return {
    subject,
    html: shell({
      title: subject,
      preheader: `Choose a new password — the link expires in ${ttl}.`,
      body,
      footerReason: 'Sent because a password reset was requested for this address.',
      orbit: false,
      assetOrigin: opts.assetOrigin,
    }),
    text: `Reset your ${BRAND} password\n\nOpen this link to choose a new password (expires in ${ttl}):\n${opts.link}\n\nIf you didn't request a reset, ignore this email — your password won't change.${textFooter('Sent because a password reset was requested for this address.')}`,
  };
}

// ── Reminder mails (paid feature) ────────────────────────────────────────────

export interface BudgetAlertRow {
  categoryName: string;
  categoryColor: string;
  budgetAmount: number;
  spent: number;
  percentage: number;
  status: 'over' | 'warning';
}

const tableHead = (cols: { label: string; align?: 'left' | 'right' }[]) =>
  `<tr>${cols
    .map(
      (col) =>
        `<th style="font-family:${FONT};font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${C.faint};text-align:${col.align ?? 'left'};padding:0 10px 8px;border-bottom:1px solid ${C.border}">${escapeHtml(col.label)}</th>`
    )
    .join('')}</tr>`;

const cell = (content: string, align: 'left' | 'right' = 'left', color: string = C.text) =>
  `<td style="font-family:${FONT};font-size:13.5px;color:${color};text-align:${align};padding:10px;border-bottom:1px solid ${C.border}">${content}</td>`;

const dot = (color: string) =>
  `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${sanitizeColor(color)};margin-right:8px;vertical-align:middle"></span>`;

export function renderBudgetAlert(opts: {
  alerts: BudgetAlertRow[];
  currency?: string | null;
  unsubUrl?: string | null;
  periodLabel?: string;
  test?: boolean;
  assetOrigin?: string;
}): RenderedEmail | null {
  if (opts.alerts.length === 0) return null;
  const anyOver = opts.alerts.some((a) => a.status === 'over');
  const subject = `${opts.test ? '[Test] ' : ''}Budget alert${opts.periodLabel ? ` (${opts.periodLabel})` : ''} — ${BRAND}`;
  const rows = opts.alerts
    .map((a) => {
      const statusColor = a.status === 'over' ? C.expense : C.warm;
      const status = a.status === 'over' ? 'OVER' : `${a.percentage}%`;
      return `<tr>${cell(`${dot(a.categoryColor)}${escapeHtml(a.categoryName)}`)}${cell(formatMoney(a.budgetAmount, opts.currency), 'right', C.muted)}${cell(formatMoney(a.spent, opts.currency), 'right')}${cell(`<strong>${status}</strong>`, 'right', statusColor)}</tr>`;
    })
    .join('');
  const body = `
    ${h1('Budget alert')}
    ${p(
      anyOver
        ? 'These budgets have gone over their limit this month:'
        : 'These budgets are approaching their limit (80%+ used):'
    )}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 14px">
      ${tableHead([{ label: 'Category' }, { label: 'Budget', align: 'right' }, { label: 'Spent', align: 'right' }, { label: 'Status', align: 'right' }])}
      ${rows}
    </table>
    <div style="padding:2px 0 4px">${btn(`${APP_URL}/#budgets`, 'Review budgets')}</div>
  `;
  const text = `Budget alert — ${BRAND}\n\n${
    anyOver ? 'Budgets over their limit:' : 'Budgets approaching their limit (80%+):'
  }\n${opts.alerts
    .map(
      (a) =>
        `- ${a.categoryName}: ${formatMoney(a.spent, opts.currency)} of ${formatMoney(a.budgetAmount, opts.currency)} (${a.status === 'over' ? 'OVER' : `${a.percentage}%`})`
    )
    .join(
      '\n'
    )}\n\nReview budgets: ${APP_URL}/#budgets${textFooter('You get budget alerts because email reminders are enabled in Settings → Notifications.', opts.unsubUrl)}`;
  return {
    subject,
    html: shell({
      title: subject,
      preheader: anyOver
        ? 'One or more budgets went over their limit.'
        : 'One or more budgets crossed 80% of their limit.',
      body,
      footerReason:
        'You get budget alerts because email reminders are enabled in Settings → Notifications.',
      unsubUrl: opts.unsubUrl,
      assetOrigin: opts.assetOrigin,
    }),
    text,
  };
}

export interface SpendingReportData {
  totalIncome: number;
  totalExpenses: number;
  netBalance: number;
  categoryBreakdown: { name: string | null; color: string | null; total: number }[];
  transactionCount: number;
  startDate: string;
  endDate: string;
}

export function renderSpendingReport(opts: {
  report: SpendingReportData;
  currency?: string | null;
  unsubUrl?: string | null;
  periodLabel?: string;
  test?: boolean;
  assetOrigin?: string;
}): RenderedEmail | null {
  const r = opts.report;
  if (r.transactionCount === 0) return null;
  const subject = `${opts.test ? '[Test] ' : ''}Your spending report${opts.periodLabel ? ` (${opts.periodLabel})` : ''} — ${BRAND}`;
  const net = r.netBalance;
  const stat = (label: string, value: string, color: string) =>
    `<td width="33%" style="background:${C.panel};border:1px solid ${C.border};border-radius:10px;padding:12px 8px;text-align:center">
      <div style="font-family:${FONT};font-size:10.5px;letter-spacing:0.6px;text-transform:uppercase;color:${C.faint};margin-bottom:4px">${escapeHtml(label)}</div>
      <div style="font-family:${FONT};font-size:16px;font-weight:700;color:${color}">${value}</div>
    </td>`;
  const cats = r.categoryBreakdown
    .map(
      (cat) =>
        `<tr>${cell(`${dot(cat.color || C.faint)}${escapeHtml(cat.name || 'Uncategorized')}`)}${cell(formatMoney(cat.total, opts.currency), 'right')}</tr>`
    )
    .join('');
  const body = `
    ${h1('Your spending report')}
    ${p(`${escapeHtml(r.startDate)} to ${escapeHtml(r.endDate)} &middot; ${r.transactionCount} transactions`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="4" style="border-collapse:separate;margin:0 0 14px"><tr>
      ${stat('Income', formatMoney(r.totalIncome, opts.currency), C.income)}
      ${stat('Expenses', formatMoney(r.totalExpenses, opts.currency), C.expense)}
      ${stat('Net', formatMoney(net, opts.currency), net >= 0 ? C.income : C.expense)}
    </tr></table>
    <div style="font-family:${FONT};font-size:13px;font-weight:600;color:${C.text};margin:0 0 6px">Top spending categories</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 14px">
      ${cats || `<tr>${cell('No spending recorded', 'left', C.faint)}</tr>`}
    </table>
    <div style="padding:2px 0 4px">${btn(`${APP_URL}/#analytics`, 'Open analytics')}</div>
  `;
  const text = `Your spending report — ${BRAND}\n${r.startDate} to ${r.endDate} · ${r.transactionCount} transactions\n\nIncome:   ${formatMoney(r.totalIncome, opts.currency)}\nExpenses: ${formatMoney(r.totalExpenses, opts.currency)}\nNet:      ${formatMoney(net, opts.currency)}\n\nTop spending categories:\n${r.categoryBreakdown.map((cat) => `- ${cat.name || 'Uncategorized'}: ${formatMoney(cat.total, opts.currency)}`).join('\n') || '- No spending recorded'}\n\nOpen analytics: ${APP_URL}/#analytics${textFooter('You get spending reports because email reminders are enabled in Settings → Notifications.', opts.unsubUrl)}`;
  return {
    subject,
    html: shell({
      title: subject,
      preheader: `Income ${formatMoney(r.totalIncome, opts.currency)}, expenses ${formatMoney(r.totalExpenses, opts.currency)}, net ${formatMoney(net, opts.currency)}.`,
      body,
      footerReason:
        'You get spending reports because email reminders are enabled in Settings → Notifications.',
      unsubUrl: opts.unsubUrl,
      assetOrigin: opts.assetOrigin,
    }),
    text,
  };
}

export interface UpcomingBillRow {
  name: string;
  amount: number;
  due_date: string | null;
  daysUntilDue: number;
  overdue: boolean;
}

export function renderBillsReminder(opts: {
  bills: UpcomingBillRow[];
  currency?: string | null;
  unsubUrl?: string | null;
  test?: boolean;
  assetOrigin?: string;
}): RenderedEmail | null {
  if (opts.bills.length === 0) return null;
  const subject = `${opts.test ? '[Test] ' : ''}Upcoming bills — ${BRAND}`;
  const when = (b: UpcomingBillRow) =>
    b.overdue
      ? 'Overdue'
      : b.daysUntilDue === 0
        ? 'Due today'
        : b.daysUntilDue === 1
          ? 'Tomorrow'
          : `In ${b.daysUntilDue} days`;
  const whenColor = (b: UpcomingBillRow) =>
    b.overdue || b.daysUntilDue === 0 ? C.expense : b.daysUntilDue <= 2 ? C.warm : C.muted;
  const rows = opts.bills
    .map(
      (b) =>
        `<tr>${cell(escapeHtml(b.name))}${cell(formatMoney(b.amount, opts.currency), 'right')}${cell(escapeHtml(b.due_date || '—'), 'right', C.muted)}${cell(`<strong>${when(b)}</strong>`, 'right', whenColor(b))}</tr>`
    )
    .join('');
  const overdueCount = opts.bills.filter((b) => b.overdue).length;
  const body = `
    ${h1('Upcoming bills')}
    ${p(
      `${opts.bills.length} bill${opts.bills.length === 1 ? ' is' : 's are'} due within a week${overdueCount > 0 ? ` — ${overdueCount} ${overdueCount === 1 ? 'is' : 'are'} overdue` : ''}.`
    )}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 14px">
      ${tableHead([{ label: 'Bill' }, { label: 'Amount', align: 'right' }, { label: 'Due', align: 'right' }, { label: 'When', align: 'right' }])}
      ${rows}
    </table>
    <div style="padding:2px 0 4px">${btn(`${APP_URL}/#bills`, 'Open bills')}</div>
  `;
  const text = `Upcoming bills — ${BRAND}\n\n${opts.bills
    .map(
      (b) =>
        `- ${b.name}: ${formatMoney(b.amount, opts.currency)} · ${b.due_date || '—'} · ${when(b)}`
    )
    .join(
      '\n'
    )}\n\nOpen bills: ${APP_URL}/#bills${textFooter('You get bill reminders because email reminders are enabled in Settings → Notifications.', opts.unsubUrl)}`;
  return {
    subject,
    html: shell({
      title: subject,
      preheader: `${opts.bills.length} bill${opts.bills.length === 1 ? '' : 's'} due within a week${overdueCount ? `, ${overdueCount} overdue` : ''}.`,
      body,
      footerReason:
        'You get bill reminders because email reminders are enabled in Settings → Notifications.',
      unsubUrl: opts.unsubUrl,
      assetOrigin: opts.assetOrigin,
    }),
    text,
  };
}

// ── Small utility mails ───────────────────────────────────────────────────────

/** Settings → "Send a test email" (basic connectivity check). */
export function renderTestBasic(opts: { assetOrigin?: string } = {}): RenderedEmail {
  const subject = `Test email — ${BRAND}`;
  const body = `
    ${h1('Notifications are working')}
    ${p('This is a test email from Token Circles — delivery to this address works. Reminder emails (budget alerts, spending reports, bill reminders) will look like this.')}
    <div style="padding:2px 0 4px">${btn(`${APP_URL}/#settings`, 'Notification settings')}</div>
  `;
  return {
    subject,
    html: shell({
      title: subject,
      preheader: 'Delivery works — reminders will arrive like this.',
      body,
      footerReason: 'Sent on demand from Settings → Notifications.',
      assetOrigin: opts.assetOrigin,
    }),
    text: `Notifications are working\n\nThis is a test email from ${BRAND} — delivery to this address works.\n\nNotification settings: ${APP_URL}/#settings${textFooter('Sent on demand from Settings → Notifications.')}`,
  };
}

/** Support-request acknowledgement (no user-controlled content — see support.ts). */
export function renderSupportAck(opts: { ticketId: string; assetOrigin?: string }): RenderedEmail {
  const subject = `We received your message (${opts.ticketId}) — ${BRAND}`;
  const body = `
    ${h1('We got your message')}
    ${p(`Thanks for reaching out. We've received your message and will get back to you as soon as we can.`)}
    ${card('Your reference', `<span style="font-family:${FONT};font-weight:700;color:${C.text}">${escapeHtml(opts.ticketId)}</span> — please mention it if you follow up.`, C.warm)}
    ${p(`If you didn't contact us, you can safely ignore this email.`, `font-size:12.5px;color:${C.faint};margin:14px 0 0`)}
  `;
  return {
    subject,
    html: shell({
      title: subject,
      preheader: `Reference ${opts.ticketId} — we'll get back to you soon.`,
      body,
      footerReason: 'Confirmation for a message sent to our support inbox.',
      orbit: false,
      assetOrigin: opts.assetOrigin,
    }),
    text: `We got your message\n\nThanks for reaching out to ${BRAND}. We've received your message and will reply as soon as we can.\nYour reference: ${opts.ticketId}\n\nIf you didn't contact us, you can safely ignore this email.${textFooter('Confirmation for a message sent to our support inbox.')}`,
  };
}
