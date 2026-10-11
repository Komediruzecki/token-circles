/**
 * Branded transactional email templates — every mail Token Circles sends,
 * rendered by pure functions returning { subject, html, text }.
 *
 * Architecture notes (mirrors the proven MercuryPitch email module):
 *  - Hand-written, table-based HTML with ALL styles inline — the only layout
 *    dialect every mail client speaks. No email framework, no build step.
 *  - No inline SVG and no emoji: Gmail strips <svg>, many clients mangle
 *    emoji. Branding rides on hosted images from the app's origin.
 *  - Every renderer also returns a plain-text twin (deliverability + a11y).
 *  - Renderers are pure (no I/O, no Env) so they can be unit-tested and
 *    previewed; callers pass links/currency in. This module imports nothing, so
 *    worker/scripts/ can load it under plain Node as well.
 *
 * Two layouts live here: the mail layout of 2026-10-11 (renderMail), with the engraved art, dark
 * by default and paper in light mode; and the first shell (`shell`), dark only, with the orbit GIF.
 *
 * The sign-up and account mails are on the new layout. The mails that show an amount of money
 * (the budget alert, the spending report, upcoming bills and the failed payment) stay on the first
 * shell, word for word: maff's call of 2026-10-11. The two billing mails that show no amount stay
 * there too until that call is made for them. worker/test/mail-catalogue.test.ts pins all six.
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

// ── The mail layout (2026-10-11) ──────────────────────────────────────────────
//
// One card per mail, in the shape the design settled (docs/design/mail-art/README.md): the
// wordmark above the card; the engraved art flush at the top of the card; then an eyebrow, one
// headline, one or two short paragraphs, a button and at most one list of numbered steps; the
// footer outside the card. 600 px wide at most, 36 px side padding, and on phones 22 px with a
// full-width button.
//
// Dark by default, which is what Gmail and classic Outlook show; paper in light mode through
// prefers-color-scheme, which Apple Mail reads. Every dark colour of the page, the card and the
// button is also a bgcolor attribute, which classic Outlook reads where it ignores CSS. The
// system font stack, as the app uses: no web fonts, no serif.
//
// The art is a real <img> above live text, never a CSS background: Gmail's desktop webmail draws
// background images badly and classic Outlook needs VML for them. Its files sit in
// frontend/public/email/ under versioned names and are never overwritten, because a mail already
// sent points at its image for as long as it is kept: new art gets a new name.

/** The dark palette. Its light counterpart is in MAIL_STYLE. */
const INK = {
  page: '#0b1020',
  card: '#151d31',
  text: '#eef2ff',
  soft: '#b4c0dc',
  muted: '#8f9cbd',
  rule: '#2a3552',
  link: '#9db8ff',
  button: '#6e9bff',
  buttonText: '#0b1020',
} as const;

const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

/** The engraved art: the hero tops the welcome, the banner every other mail. */
const ART = {
  hero: { path: '/email/hero-engraved-night-v1.jpg', width: 600, height: 280 },
  banner: { path: '/email/banner-engraved-night-v1.jpg', width: 600, height: 180 },
} as const;

/** The light scheme and the phone width: the only rules that cannot be inline. */
const MAIL_STYLE = `<style>
:root { color-scheme: dark light; supported-color-schemes: dark light; }
@media (prefers-color-scheme: light) {
  .tc-page { background:#eeeae1 !important; }
  .tc-card { background:#fbf9f4 !important; }
  .tc-text { color:#141b30 !important; }
  .tc-soft { color:#424d6b !important; }
  .tc-muted { color:#525c79 !important; }
  .tc-link { color:#2f5cc4 !important; }
  .tc-rule { border-color:#ddd8cc !important; }
  .tc-btn-td { background:#2f5cc4 !important; }
  .tc-btn { color:#ffffff !important; }
  .tc-btn2-td { border-color:#2f5cc4 !important; }
  .tc-btn2 { color:#2f5cc4 !important; }
  .tc-code { background:#eeeae1 !important; border-color:#ddd8cc !important; }
}
@media (max-width: 480px) {
  .tc-pad { padding-left:22px !important; padding-right:22px !important; }
  .tc-h1 { font-size:24px !important; }
  .tc-btn-table { width:100% !important; }
  .tc-btn-table td { display:block !important; width:auto !important; }
  .tc-btn-gap { height:10px !important; }
  .tc-btn, .tc-btn2 { display:block !important; text-align:center !important; }
}
</style>`;

/** A run of words in a paragraph: plain, or in bold (an address the reader should check). */
export type MailRun = string | { strong: string };

/** A paragraph: its words, or runs of them. */
export type MailParagraph = string | MailRun[];

export interface MailLink {
  label: string;
  href: string;
}

export interface MailStep {
  title: string;
  text: string;
  link: MailLink;
}

/**
 * What one mail says, in the order the layout shows it. The types hold the layout's limits: one
 * headline, one or two paragraphs, one button or a button and a quieter second one, and at most
 * one list of steps. Every string is plain text; renderMail escapes it.
 */
export interface MailSpec {
  subject: string;
  /** The line inbox lists show beside the subject, hidden in the mail itself. */
  preheader: string;
  /** The art at the top of the card. */
  art: keyof typeof ART;
  /** Where the art links, if anywhere. */
  artHref?: string;
  /** A short line above the headline. */
  eyebrow?: string;
  headline: string;
  /** A one-time code, large and monospaced, right under the headline. */
  code?: string;
  paragraphs: [MailParagraph] | [MailParagraph, MailParagraph];
  buttons?: [MailLink] | [MailLink, MailLink];
  /** Small print under the button. */
  notes?: string[];
  /** The button's link again, as text to paste when the button does not open. */
  paste?: string;
  steps?: { title: string; items: MailStep[] };
  /** A last paragraph at the foot of the card. */
  signOff?: string;
  /** Small print under a hairline at the foot of the card. */
  aside?: string;
  /** Why this mail came, in the footer. */
  reason: string;
  /** The origin that serves the wordmark and the art: the sending environment's app. */
  assetOrigin?: string;
}

const paragraphText = (paragraph: MailParagraph): string =>
  typeof paragraph === 'string'
    ? paragraph
    : paragraph.map((run) => (typeof run === 'string' ? run : run.strong)).join('');

const paragraphHtml = (paragraph: MailParagraph): string =>
  typeof paragraph === 'string'
    ? escapeHtml(paragraph)
    : paragraph
        .map((run) =>
          typeof run === 'string'
            ? escapeHtml(run)
            : `<strong class="tc-text" style="color:${INK.text};font-weight:600">${escapeHtml(run.strong)}</strong>`
        )
        .join('');

const mailParagraph = (html: string) =>
  `<p class="tc-soft" style="margin:14px 0 0;font:16px/1.6 ${FONT};color:${INK.soft}">${html}</p>`;

const mailSmall = (html: string, top = 14) =>
  `<p class="tc-muted" style="margin:${top}px 0 0;font:14px/1.6 ${FONT};color:${INK.muted}">${html}</p>`;

const mailLink = ({ label, href }: MailLink) =>
  `<a class="tc-link" href="${escapeHtml(href)}" style="color:${INK.link};text-decoration:none;font-weight:600">${escapeHtml(label)}</a>`;

/** The button, solid in the brand blue; a second one, outlined, sits beside it. */
function mailButtons([first, second]: [MailLink] | [MailLink, MailLink]): string {
  const primary = `<td class="tc-btn-td" bgcolor="${INK.button}" style="background:${INK.button};border-radius:10px"><a class="tc-btn" href="${escapeHtml(first.href)}" style="display:inline-block;padding:15px 26px;font:600 16px/1.2 ${FONT};color:${INK.buttonText};text-decoration:none;border-radius:10px">${escapeHtml(first.label)}</a></td>`;
  const quieter = second
    ? `<td class="tc-btn-gap" width="12" style="width:12px;font-size:0;line-height:0">&nbsp;</td><td class="tc-btn2-td" style="border:1px solid ${INK.link};border-radius:10px"><a class="tc-btn2" href="${escapeHtml(second.href)}" style="display:inline-block;padding:14px 25px;font:600 16px/1.2 ${FONT};color:${INK.link};text-decoration:none;border-radius:10px">${escapeHtml(second.label)}</a></td>`
    : '';
  return `<table role="presentation" class="tc-btn-table" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px"><tr>${primary}${quieter}</tr></table>`;
}

const mailCode = (code: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px"><tr><td class="tc-code" bgcolor="${INK.page}" style="background:${INK.page};border:1px solid ${INK.rule};border-radius:12px;padding:14px 22px"><span class="tc-text" style="font:700 36px/1.2 ${MONO};letter-spacing:6px;color:${INK.text}">${escapeHtml(code)}</span></td></tr></table>`;

function mailSteps({ title, items }: NonNullable<MailSpec['steps']>, bottom: number): string {
  const rows = items
    .map(
      (step, i) =>
        `<tr><td class="tc-rule" style="border-top:1px solid ${INK.rule};padding:16px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="34" valign="top" class="tc-muted" style="font:600 14px/1.5 ${FONT};color:${INK.muted}">${i + 1}</td><td valign="top"><div class="tc-text" style="font:600 16px/1.4 ${FONT};color:${INK.text}">${escapeHtml(step.title)}</div><div class="tc-soft" style="margin:4px 0 0;font:14px/1.6 ${FONT};color:${INK.soft}">${escapeHtml(step.text)}</div><div style="margin:8px 0 0;font:14px/1.4 ${FONT}">${mailLink({ label: `${step.link.label} →`, href: step.link.href })}</div></td></tr></table></td></tr>`
    )
    .join('');
  return `<tr><td class="tc-pad" style="padding:26px 36px ${bottom}px"><div class="tc-muted" style="font:600 14px/1.4 ${FONT};letter-spacing:0.2px;color:${INK.muted};margin:0 0 6px">${escapeHtml(title)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>`;
}

/** The text twin's last lines, the same for every mail on this layout. */
const mailTextFooter = (reason: string) =>
  `Your money, in clear orbit.\n${APP_URL} · ${ABOUT_URL} · ${REPO_URL}\n${reason}`;

/** One mail on the layout: its HTML and its plain-text twin, from the same words. */
export function renderMail(spec: MailSpec): RenderedEmail {
  const assets = spec.assetOrigin || APP_URL;
  const art = ART[spec.art];
  const img = `<img src="${assets}${art.path}" width="${art.width}" height="${art.height}" alt="" style="display:block;width:100%;height:auto;border:0;border-radius:18px 18px 0 0">`;
  // The card's last row carries its bottom padding.
  const after = { steps: !!spec.steps, signOff: !!spec.signOff, aside: !!spec.aside };
  const rows = [
    `<tr><td style="padding:0;font-size:0;line-height:0">${spec.artHref ? `<a href="${escapeHtml(spec.artHref)}" style="display:block">${img}</a>` : img}</td></tr>`,
    `<tr><td class="tc-pad" style="padding:30px 36px ${after.steps || after.signOff || after.aside ? 6 : 30}px">` +
      (spec.eyebrow
        ? `<div class="tc-link" style="font:600 14px/1.4 ${FONT};letter-spacing:0.2px;color:${INK.link};margin:0 0 10px">${escapeHtml(spec.eyebrow)}</div>`
        : '') +
      `<h1 class="tc-text tc-h1" style="margin:0;font:600 32px/1.15 ${FONT};letter-spacing:-0.4px;color:${INK.text}">${escapeHtml(spec.headline)}</h1>` +
      (spec.code ? mailCode(spec.code) : '') +
      spec.paragraphs.map((paragraph) => mailParagraph(paragraphHtml(paragraph))).join('') +
      (spec.buttons ? mailButtons(spec.buttons) : '') +
      (spec.notes ?? []).map((note, i) => mailSmall(escapeHtml(note), i === 0 ? 16 : 14)).join('') +
      (spec.paste
        ? mailSmall(
            `${escapeHtml("If the button doesn't open, paste this into your browser:")}<br><a class="tc-link" href="${escapeHtml(spec.paste)}" style="color:${INK.link};text-decoration:none;word-break:break-all;font:12px/1.6 ${MONO}">${escapeHtml(spec.paste)}</a>`
          )
        : '') +
      '</td></tr>',
    spec.steps ? mailSteps(spec.steps, after.signOff || after.aside ? 4 : 30) : '',
    spec.signOff
      ? `<tr><td class="tc-pad" style="padding:6px 36px ${after.aside ? 6 : 30}px"><p class="tc-soft" style="margin:0;font:16px/1.6 ${FONT};color:${INK.soft}">${escapeHtml(spec.signOff)}</p></td></tr>`
      : '',
    spec.aside
      ? `<tr><td class="tc-pad" style="padding:8px 36px 30px"><div class="tc-rule" style="border-top:1px solid ${INK.rule};padding-top:16px">${mailSmall(escapeHtml(spec.aside), 0)}</div></td></tr>`
      : '',
  ].join('');
  const footerLinks = [
    { label: 'Open the app', href: APP_URL },
    { label: 'About', href: ABOUT_URL },
    { label: 'GitHub', href: REPO_URL },
    { label: 'Terms', href: TERMS_URL },
    { label: 'Privacy', href: PRIVACY_URL },
  ]
    .map(mailLink)
    .join(' &nbsp;&middot;&nbsp; ');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${escapeHtml(spec.subject)}</title>
${MAIL_STYLE}
</head>
<body class="tc-page" bgcolor="${INK.page}" style="margin:0;padding:0;background:${INK.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(spec.preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" class="tc-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${INK.page}" style="background:${INK.page}"><tr><td align="center" style="padding:22px 12px 30px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td style="padding:2px 6px 14px"><a href="${APP_URL}" style="text-decoration:none"><img src="${assets}/icon-192.png" width="26" height="26" alt="" style="vertical-align:middle;border:0;border-radius:7px"><span class="tc-text" style="font:600 16px/1 ${FONT};color:${INK.text};vertical-align:middle;letter-spacing:-0.1px">&nbsp;&nbsp;${BRAND}</span></a></td></tr>
<tr><td class="tc-card" bgcolor="${INK.card}" style="background:${INK.card};border-radius:18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>
<tr><td class="tc-pad" style="padding:22px 36px 4px">
<p class="tc-muted" style="margin:0;font:12px/1.7 ${FONT};color:${INK.muted}">Your money, in clear orbit. Open source and local-first.<br>${footerLinks}</p>
<p class="tc-muted" style="margin:10px 0 0;font:12px/1.6 ${FONT};color:${INK.muted}">${escapeHtml(spec.reason)}<br>&copy; ${new Date().getUTCFullYear()} ${BRAND} &middot; AGPL-3.0 &middot; <a class="tc-muted" href="mailto:${CONTACT_EMAIL}" style="color:${INK.muted};text-decoration:none">${CONTACT_EMAIL}</a></p>
</td></tr>
</table>
</td></tr></table>
</body>
</html>
`;
  const text = [
    spec.headline,
    ...(spec.code ? [spec.code] : []),
    ...spec.paragraphs.map(paragraphText),
    ...(spec.buttons
      ? [spec.buttons.map(({ label, href }) => `${label}: ${href}`).join('\n')]
      : []),
    ...(spec.notes ?? []),
    ...(spec.steps
      ? [
          spec.steps.title,
          ...spec.steps.items.map(
            (step, i) =>
              `${i + 1}. ${step.title}\n${step.text}\n${step.link.label}: ${step.link.href}`
          ),
        ]
      : []),
    ...(spec.signOff ? [spec.signOff] : []),
    ...(spec.aside ? [spec.aside] : []),
    mailTextFooter(spec.reason),
  ].join('\n\n');
  return { subject: spec.subject, html, text };
}

// ── The first shell ───────────────────────────────────────────────────────────

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
//
// The sign-up mails: Confirm, its fresh link, and the Welcome, on the mail layout.
//
// A password sign-up gets Confirm, which carries the link that opens the account and nothing
// else. The Welcome comes once the address is confirmed (by that link, Google sign-in, an emailed
// sign-in code or a reset link), or at once for a Google sign-up, whose address Google confirmed:
// worker/src/welcome.ts decides when, and makes sure it goes once.

/** How long a link lasts, in words. */
const lasts = (hours: number) => (hours === 1 ? '1 hour' : `${hours} hours`);

/**
 * Everything the two confirm mails share: the button, the small print and the footer.
 *
 * Both say what the link does today. It spends itself only for its own account's session, which
 * a new password account does not have yet, so opening it asks for a sign-in, in any browser, and
 * that sign-in confirms the address (email-link.ts). They promise nothing more until the
 * same-browser sign-in ships, which is when Confirm can say "One click" again (maff's call of
 * 2026-10-11).
 */
function confirmMail(opts: {
  subject: string;
  preheader: string;
  headline: string;
  paragraphs: MailSpec['paragraphs'];
  link: string;
  ttlHours: number;
  assetOrigin?: string;
}): RenderedEmail {
  return renderMail({
    subject: opts.subject,
    preheader: opts.preheader,
    art: 'banner',
    headline: opts.headline,
    paragraphs: opts.paragraphs,
    buttons: [{ label: 'Confirm my email', href: opts.link }],
    notes: [
      `The link works once, for ${lasts(opts.ttlHours)}. Run out? Open it anyway and choose Send the link again.`,
    ],
    paste: opts.link,
    aside: `Didn't sign up for ${BRAND}? Ignore this mail. Nobody can use the account until this address is confirmed.`,
    reason: `You are getting this because this address was used to sign up for ${BRAND}.`,
    assetOrigin: opts.assetOrigin,
  });
}

/** Confirm: the mail a password sign-up gets, with the link that opens the account. */
export function renderConfirmEmail(opts: {
  link: string;
  ttlHours: number;
  assetOrigin?: string;
}): RenderedEmail {
  return confirmMail({
    subject: `Confirm your email for ${BRAND}`,
    preheader: `Open the link, then sign in where it opens. It works for ${lasts(opts.ttlHours)}.`,
    headline: "One link, one sign-in, and you're in.",
    paragraphs: [
      `Open the link in any browser and sign in there. That confirms this address and opens your ${BRAND} account.`,
    ],
    ...opts,
  });
}

/**
 * A fresh confirm link: Send the link again, or a sign-up again for an address still waiting for
 * its link, which an inbox gets without having asked, so the mail says nothing of asking. Minting
 * it retires the links sent before it (createEmailVerification), and the mail says so.
 */
export function renderEmailVerification(opts: {
  link: string;
  ttlHours: number;
  assetOrigin?: string;
}): RenderedEmail {
  return confirmMail({
    subject: `Your new confirm link for ${BRAND}`,
    preheader: `It replaces the links sent before. It works once, for ${lasts(opts.ttlHours)}.`,
    headline: "Here's a fresh link.",
    paragraphs: [
      'Use this link to confirm your address. It replaces the ones sent before.',
      `Open it in any browser and sign in there, and your ${BRAND} account opens.`,
    ],
    ...opts,
  });
}

/**
 * The Welcome. Step 3 is the version for before finance prints ship: what Progress counts, and the
 * badge a year earns (frontend/src/core/achievements/definitions.ts). `appUrl` is the app the links
 * open; the art loads from `assetOrigin`, or from the app.
 */
export function renderWelcome(opts: { appUrl?: string; assetOrigin?: string } = {}): RenderedEmail {
  const app = opts.appUrl || APP_URL;
  return renderMail({
    subject: `${BRAND} is ready for your first statement`,
    preheader: 'Import a year from your bank and the app has something to show you on day one.',
    art: 'hero',
    artHref: `${app}/#dashboard`,
    eyebrow: `Welcome to ${BRAND}`,
    headline: 'Start with a year.',
    paragraphs: [
      `${BRAND} shows where your money goes, month by month, for you alone or for a whole household. The more history it can read, the more it can tell you, so begin with a year of statements from your bank.`,
    ],
    buttons: [{ label: 'Import statements', href: `${app}/#import` }],
    steps: {
      title: 'Where to go first',
      items: [
        {
          title: 'Bring your history',
          text: 'Statements from Revolut, N26, Wise, Erste, PBZ, ING, DKB and Sparkasse import as they are, and so do YNAB exports. Any other CSV or Excel file works once you match its columns. Rows you already have are skipped.',
          link: { label: 'Open Import', href: `${app}/#import` },
        },
        {
          title: 'Find your subscriptions',
          text: `${BRAND} spots the subscriptions in your statements, from streaming to cloud storage, with each one's price and how often it charges. Tick the ones you want tracked as bills.`,
          link: { label: 'Open Bills', href: `${app}/#bills` },
        },
        {
          title: 'Watch your year fill in',
          text: "Progress counts every month that holds three or more entries. Twelve in a row earns the A year badge, and a full year's import can earn it on day one.",
          link: { label: 'Open Progress', href: `${app}/#progress` },
        },
      ],
    },
    signOff: "Questions, or a bank file that won't import? Reply to this mail.",
    reason: `You are getting this because a ${BRAND} account was created with this address.`,
    assetOrigin: opts.assetOrigin || opts.appUrl,
  });
}

/**
 * The link that moves an account to a new address, sent to that address. Opening it is the
 * change: until then the account keeps the address it has. It says only what is true for every
 * account, Google ones included: the sign-in it may ask for is with the address in use now.
 */
export function renderEmailChange(opts: {
  link: string;
  ttlHours: number;
  assetOrigin?: string;
}): RenderedEmail {
  return renderMail({
    subject: `Confirm your new email for ${BRAND}`,
    preheader: `Open the link and your account uses this address. It works for ${lasts(opts.ttlHours)}.`,
    art: 'banner',
    headline: 'Make this your new address.',
    paragraphs: [
      `Open the link to make this the email address of your ${BRAND} account. From then on, mail about your account comes here.`,
      "If you're asked to sign in first, use the address you sign in with now. The change is made as soon as you do. Until then, nothing changes.",
    ],
    buttons: [{ label: 'Confirm my new email', href: opts.link }],
    notes: [`The link works once, for ${lasts(opts.ttlHours)}.`],
    paste: opts.link,
    aside: "Didn't ask for this? Ignore this mail. Without the link, nothing changes.",
    reason: `You are getting this because this address was entered as the new email for a ${BRAND} account.`,
    assetOrigin: opts.assetOrigin,
  });
}

/**
 * Sent to an account's current address when a change to `newEmail` is asked for. It carries no
 * link that makes the change: it says what was asked, in one sentence, and the one thing to do
 * when it was not the owner, which is Settings, where the change can be cancelled. `newEmail` is
 * null when the notice should not name it (the current address is unconfirmed).
 */
export function renderEmailChangeNotice(opts: {
  newEmail: string | null;
  appUrl?: string;
}): RenderedEmail {
  const app = opts.appUrl || APP_URL;
  const named = opts.newEmail;
  return renderMail({
    subject: `Someone asked to change your ${BRAND} email`,
    preheader: `Nothing changes unless ${named ?? 'the new address'} confirms it.`,
    art: 'banner',
    headline: 'A new email address is waiting.',
    paragraphs: [
      named
        ? [
            `Someone signed in to your ${BRAND} account asked to change its email to `,
            { strong: named },
            ', and nothing changes unless that address confirms it with the link we sent there.',
          ]
        : `Someone signed in to your ${BRAND} account asked to change its email address, and nothing changes unless the new address confirms it with the link we sent there.`,
      "If that was you, there's nothing to do. If it wasn't, open Settings, cancel the change, and choose Sign out on all devices under About.",
    ],
    buttons: [{ label: 'Open Settings', href: `${app}/#settings` }],
    reason: `You are getting this because a new email address was asked for on your ${BRAND} account.`,
    assetOrigin: opts.appUrl,
  });
}

/**
 * Anti-enumeration notice: someone tried to sign up with an address that has an account. Both
 * buttons open the app's sign-in screen, which has Forgot password: the app has no link that
 * opens the reset form itself.
 */
export function renderAccountExists(opts: { appUrl?: string }): RenderedEmail {
  const app = opts.appUrl || APP_URL;
  return renderMail({
    subject: `You already have a ${BRAND} account`,
    preheader: 'Someone tried to sign up with your address. Your account is unchanged.',
    art: 'banner',
    headline: 'This address already has an account.',
    paragraphs: [
      `Someone just tried to create a ${BRAND} account with this email address, but one already exists.`,
      "If that was you, sign in, or choose Forgot password on the sign-in screen to reset it. If it wasn't, there's nothing to do: your account is unchanged.",
    ],
    buttons: [
      { label: 'Sign in', href: app },
      { label: 'Reset password', href: app },
    ],
    reason: `You are getting this because someone tried to sign up for ${BRAND} with this address.`,
    assetOrigin: opts.appUrl,
  });
}

/** The password reset link. */
export function renderPasswordReset(opts: {
  link: string;
  ttlHours: number;
  assetOrigin?: string;
}): RenderedEmail {
  return renderMail({
    subject: `Reset your ${BRAND} password`,
    preheader: `Choose a new password. The link works for ${lasts(opts.ttlHours)}.`,
    art: 'banner',
    headline: 'Choose a new password.',
    paragraphs: [
      `Someone asked to reset the password of your ${BRAND} account. Open the link to choose a new one.`,
    ],
    buttons: [{ label: 'Reset password', href: opts.link }],
    notes: [`The link works once, for ${lasts(opts.ttlHours)}.`],
    paste: opts.link,
    aside: "Didn't ask for a reset? Ignore this mail. Your password stays as it is.",
    reason: 'You are getting this because a password reset was asked for on this address.',
    assetOrigin: opts.assetOrigin,
  });
}

/** A one-time sign-in code. The subject starts with the code, so an inbox list shows it. */
export function renderLoginCode(opts: {
  code: string;
  ttlMinutes: number;
  assetOrigin?: string;
}): RenderedEmail {
  return renderMail({
    subject: `${opts.code} is your ${BRAND} sign-in code`,
    preheader: `It works once, for ${opts.ttlMinutes} minutes.`,
    art: 'banner',
    headline: "Here's your sign-in code.",
    code: opts.code,
    paragraphs: [
      `Enter it on the ${BRAND} sign-in screen. It works once, for ${opts.ttlMinutes} minutes.`,
    ],
    aside: "Didn't try to sign in? Ignore this mail. Nobody gets in without the code.",
    reason: 'You are getting this because a sign-in code was asked for on this address.',
    assetOrigin: opts.assetOrigin,
  });
}

// ── Billing mails (Stripe webhooks) ──────────────────────────────────────────
//
// Stripe can send its own versions of these, and it says less than we can: it knows the invoice
// failed, we know what the plan does and where the button is. If Stripe's own failed-payment mail
// is switched on, switch it OFF — two mails about one decline, in two voices, reads as a system
// that has lost track of itself.
//
// Every one of these is triggered by a webhook, never by a user, so the sends are best-effort and
// must never fail the request: an unacked webhook is retried, and a retry that re-sends mail is
// worse than a mail that never arrived.

/** A card was declined and Stripe is retrying. The subscription is still live meanwhile. */
export function renderPaymentFailed(opts: {
  planName: string;
  amountDue?: number | null;
  currency?: string | null;
  nextAttempt?: Date | null;
  payUrl?: string | null;
  appUrl?: string;
}): RenderedEmail {
  const app = opts.appUrl || APP_URL;
  const pay = opts.payUrl || `${app}/#settings`;
  const amount =
    typeof opts.amountDue === 'number' && opts.amountDue > 0
      ? formatMoney(opts.amountDue, opts.currency)
      : null;
  const retry = opts.nextAttempt
    ? opts.nextAttempt.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;
  const subject = `Your ${BRAND} payment didn't go through`;
  const body = `
    ${h1("Your payment didn't go through")}
    ${p(`Your bank declined the ${amount ? `${escapeHtml(amount)} ` : ''}payment for ${BRAND} ${escapeHtml(opts.planName)}. It happens — an expired card, a new number, or the bank simply asking questions.`)}
    ${p(`<strong>Nothing has changed yet.</strong> Your plan is still active and we will try the card again${retry ? ` on ${escapeHtml(retry)}` : ''}. Updating it now is the quickest way to end this.`)}
    <div style="padding:8px 0 12px">${btn(pay, 'Update your card')}</div>
    ${p(`If the retries run out, the account moves to Free. Nothing is deleted — your data stays where it is and you can pick the plan back up whenever you like.`, `font-size:12.5px;color:${C.faint}`)}
  `;
  return {
    subject,
    html: shell({
      title: subject,
      preheader: `Your card was declined${retry ? ` — we retry on ${retry}` : ''}. Your plan is still active.`,
      body,
      footerReason: 'Sent because a payment for your subscription could not be collected.',
      orbit: false,
      assetOrigin: opts.appUrl,
    }),
    text: `Your ${BRAND} payment didn't go through\n\nYour bank declined the ${amount ? `${amount} ` : ''}payment for ${BRAND} ${opts.planName}.\n\nNothing has changed yet — your plan is still active and we will try again${retry ? ` on ${retry}` : ''}.\n\nUpdate your card: ${pay}\n\nIf the retries run out the account moves to Free. Nothing is deleted.${textFooter('Sent because a payment for your subscription could not be collected.')}`,
  };
}

/**
 * The bank wants the cardholder to confirm (3-D Secure / SCA). Deliberately not the same mail as a
 * decline: nothing is wrong, and the only thing that fixes it is the user opening a page — which a
 * "your payment failed" subject line makes them less likely to do, not more.
 */
export function renderPaymentActionRequired(opts: {
  planName: string;
  payUrl?: string | null;
  appUrl?: string;
}): RenderedEmail {
  const app = opts.appUrl || APP_URL;
  const confirm = opts.payUrl || `${app}/#settings`;
  const subject = `Your bank needs you to confirm a ${BRAND} payment`;
  const body = `
    ${h1('One step from your bank')}
    ${p(`Your bank wants you to confirm the payment for ${BRAND} ${escapeHtml(opts.planName)} before it goes through — the usual card-verification step, not a problem with your card.`)}
    <div style="padding:8px 0 12px">${btn(confirm, 'Confirm the payment')}</div>
    ${p(`Your plan stays active while this is outstanding. If it is not confirmed, the payment is treated as failed and we retry it.`, `font-size:12.5px;color:${C.faint}`)}
  `;
  return {
    subject,
    html: shell({
      title: subject,
      preheader: 'A quick confirmation with your bank, then the payment goes through.',
      body,
      footerReason: 'Sent because your bank asked for confirmation of a subscription payment.',
      orbit: false,
      assetOrigin: opts.appUrl,
    }),
    text: `Your bank needs you to confirm a ${BRAND} payment\n\nYour bank wants you to confirm the payment for ${BRAND} ${opts.planName} before it goes through. This is the usual card-verification step, not a problem with your card.\n\nConfirm it here: ${confirm}\n\nYour plan stays active while this is outstanding.${textFooter('Sent because your bank asked for confirmation of a subscription payment.')}`,
  };
}

/** The subscription is over — cancelled, or dunning ran out. Says what happens to the data. */
export function renderSubscriptionEnded(opts: {
  planName: string;
  appUrl?: string;
}): RenderedEmail {
  const app = opts.appUrl || APP_URL;
  const subject = `Your ${BRAND} ${opts.planName} plan has ended`;
  const body = `
    ${h1('Your plan has ended')}
    ${p(`Your ${BRAND} ${escapeHtml(opts.planName)} plan has ended and the account is now on Free.`)}
    ${card('Your data is still here', 'Nothing has been deleted. You can open everything, and export all of it from Settings at any time.')}
    ${card('Picking it back up', 'Choosing a plan again restores the paid features immediately — there is nothing to restore or re-import.', C.warm)}
    <div style="padding:8px 0 4px">${btn(`${app}/#settings`, 'Open Settings')}</div>
    ${p(`If this was not deliberate — a card that expired, say — choosing the plan again is all it takes.`, `font-size:12.5px;color:${C.faint};margin:16px 0 0`)}
  `;
  return {
    subject,
    html: shell({
      title: subject,
      preheader: 'The account is on Free now. Nothing has been deleted.',
      body,
      footerReason: 'Sent because your subscription ended.',
      assetOrigin: opts.appUrl,
    }),
    text: `Your ${BRAND} ${opts.planName} plan has ended\n\nThe account is now on Free. Nothing has been deleted — you can open everything, and export all of it from Settings at any time.\n\nChoosing a plan again restores the paid features immediately.\n\nOpen Settings: ${app}/#settings${textFooter('Sent because your subscription ended.')}`,
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

/**
 * Settings, Email reminders, Test: checks that mail reaches the account's address. It does not
 * say the reminders look like it: they keep the first shell (see the reminder mails above).
 */
export function renderTestBasic(opts: { assetOrigin?: string } = {}): RenderedEmail {
  return renderMail({
    subject: `Test mail from ${BRAND}`,
    preheader: `Mail from ${BRAND} reaches this address.`,
    art: 'banner',
    headline: 'It got through.',
    paragraphs: [
      `This is the test you sent from Email reminders in Settings. It arrived, so mail from ${BRAND} reaches this address.`,
      'Budget alerts, spending reports and bill reminders come here too, once you turn them on.',
    ],
    buttons: [{ label: 'Open Settings', href: `${APP_URL}/#settings` }],
    reason: 'You are getting this because you chose Test under Email reminders in Settings.',
    assetOrigin: opts.assetOrigin,
  });
}

/** Support-request acknowledgement. It repeats nothing the sender wrote: see support.ts. */
export function renderSupportAck(opts: { ticketId: string; assetOrigin?: string }): RenderedEmail {
  return renderMail({
    subject: `We got your message (${opts.ticketId})`,
    preheader: `Your reference is ${opts.ticketId}. We'll reply as soon as we can.`,
    art: 'banner',
    headline: 'We got your message.',
    paragraphs: [
      `Thanks for writing to ${BRAND}. We'll get back to you as soon as we can.`,
      ['Your reference is ', { strong: opts.ticketId }, '. Mention it if you write again.'],
    ],
    aside: "Didn't write to us? Ignore this mail.",
    reason: `You are getting this because this address was given with a message to ${BRAND} support.`,
    assetOrigin: opts.assetOrigin,
  });
}
