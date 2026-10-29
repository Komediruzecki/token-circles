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
 * Every mail is on one layout, the mail layout of 2026-10-11 (renderMail): the engraved art, dark
 * by default and paper in light mode. The four mails that show an amount of money (the budget
 * alert, the spending report, upcoming bills and the failed payment) joined it last, by maff's
 * call of 2026-10-29, with every amount kept; they are the ones with tables. The first shell they
 * left, dark only and topped by the animated orbit GIF, is gone. frontend/public/email/orbit.gif
 * stays, because mails already sent still point at it. worker/test/mail-catalogue.test.ts pins
 * the four over a grid of inputs.
 */

// ── Brand constants ───────────────────────────────────────────────────────────

export const BRAND = 'Token Circles';

const APP_URL = 'https://tokencircles.com';
const ABOUT_URL = 'https://about.tokencircles.com';
const REPO_URL = 'https://github.com/Komediruzecki/token-circles';
const TERMS_URL = `${ABOUT_URL}/terms`;
const PRIVACY_URL = `${ABOUT_URL}/privacy`;
const CONTACT_EMAIL = 'hello@tokencircles.com';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /**
   * The unsubscribe URL the footer links to, on a mail that has one. sendMail sends it as the
   * List-Unsubscribe header, so the header and the footer can never name different links.
   */
  listUnsubscribe?: string;
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
  return /^#[0-9a-fA-F]{6}$/.test(String(color ?? '')) ? String(color) : INK.muted;
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
// wordmark above the card; the engraved art flush at the top of the card; then an eyebrow where it
// adds something, one headline, one or two short paragraphs, a button and at most one list of
// numbered steps; the footer outside the card. 600 px wide at most, 36 px side padding, and on
// phones 22 px with a full-width button.
//
// Dark by default, which is what Gmail and classic Outlook show; paper in light mode through
// prefers-color-scheme, which Apple Mail reads. Every dark colour of the page, the card and the
// button is also a bgcolor attribute, which classic Outlook reads where it ignores CSS. The
// system font stack, as the app uses: no web fonts, no serif. The head declares "light only"
// (COLOR_SCHEME_META), which stops the Gmail apps recolouring the mail, and every line of text
// carries its own colour.
//
// The art is a real <img> above live text, never a CSS background: Gmail's desktop webmail draws
// background images badly and classic Outlook needs VML for them. Its files sit in
// frontend/public/email/ under versioned names and are never overwritten, because a mail already
// sent points at its image for as long as it is kept: new art gets a new name.

/** The dark palette. Its light counterpart is in mailStyle. */
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

/**
 * The colours of a figure's status in a table, on the dark card: over a limit or overdue, close to
 * it, and money kept. Their light counterparts are in TABLE_STYLE.
 */
const TONE = { over: '#ff9d9d', warn: '#f0a860', good: '#7dffb0' } as const;

/** The engraved art: the hero tops the welcome, the banner every other mail. */
const ART = {
  hero: { path: '/email/hero-engraved-night-v1.jpg', width: 600, height: 280 },
  banner: { path: '/email/banner-engraved-night-v1.jpg', width: 600, height: 180 },
} as const;

/**
 * The color-scheme lines of every mail's head. The mail is drawn dark, with a paper variant for
 * clients that fire prefers-color-scheme: light, but it declares "light only". MercuryPitch's probe
 * mails of 2026-10-14 (its PR #1010) found that the Gmail app on the iPhone, in dark mode, recolours
 * a mail that declares "dark" (here "dark light" turned the page white) and shows one that declares
 * "light only" as drawn; it ignores "dark", and neither prefers-color-scheme query fires there.
 * Proton on the iPhone fires the query either way, and a media query reads the reader's setting,
 * not the declaration, so the paper variant still comes where it did. A client that honours "light
 * only" gives text with no colour of its own the light defaults, black and link blue, so every
 * line of text, link and picture carries its own: worker/test/mail-color-scheme.test.ts.
 */
const COLOR_SCHEME_META = `<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">`;

/**
 * Text a client turns into a link takes the colour of the words around it. Apple Mail's data
 * detectors, and possibly the Gmail apps, link dates and addresses; under "light only" such a link
 * would be link blue. The Gmail apps keep a head <style> and match `u + #body` (MercuryPitch's
 * probe), which is why <body> has id="body". The Gmail rule sets the colour alone and is not
 * !important, so the mail's own links keep their inline colours.
 */
const AUTO_LINK_STYLE = `<style>a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important;}u + #body a{color:inherit;}</style>`;

/**
 * The light scheme and the phone width: the only rules that cannot be inline. `tables` adds the
 * rules only a mail with a table needs, so a mail without one carries none of them.
 */
const mailStyle = (tables: boolean) => `<style>
:root { color-scheme: light only; supported-color-schemes: light only; }
@media (prefers-color-scheme: light) {
  .tc-page { background:#eeeae1 !important; }
  .tc-card { background:#fbf9f4 !important; }
  .tc-text { color:#141b30 !important; }
  .tc-soft { color:#424d6b !important; }
  .tc-muted { color:#525c79 !important; }
  .tc-link { color:#2f5cc4 !important; }
  .tc-rule { border-color:#ddd8cc !important; }
  .tc-sep { color:#c4beb1 !important; }
  .tc-btn-td { background:#2f5cc4 !important; }
  .tc-btn { color:#ffffff !important; }
  .tc-btn2-td { border-color:#2f5cc4 !important; }
  .tc-btn2 { color:#2f5cc4 !important; }
  .tc-code { background:#eeeae1 !important; border-color:#ddd8cc !important; }
${tables ? TABLE_STYLE.light : ''}}
@media (max-width: 480px) {
  .tc-pad { padding-left:22px !important; padding-right:22px !important; }
  .tc-h1 { font-size:24px !important; }
  .tc-btn-table { width:100% !important; }
  .tc-btn-table td { display:block !important; width:auto !important; }
  .tc-btn-gap { height:10px !important; }
  .tc-btn, .tc-btn2 { display:block !important; text-align:center !important; }
${tables ? TABLE_STYLE.phone : ''}}
</style>`;

/** A table's rules: its status colours on paper, and a smaller figure and gap on a phone. */
const TABLE_STYLE = {
  light: `  .tc-over { color:#b42318 !important; }
  .tc-warn { color:#8a5300 !important; }
  .tc-good { color:#1d7a46 !important; }
`,
  phone: `  .tc-cell { font-size:14px !important; }
  .tc-cell-gap { padding-left:8px !important; }
`,
};

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
  /** The page the step opens. None where the reader cannot open a page yet. */
  link?: MailLink;
}

/** One cell of a table: its words, plain text, and how they read. */
export interface MailCell {
  text: string;
  /** A coloured dot before the words: a category's own colour. Anything but #rrggbb reads grey. */
  dot?: string | null;
  /** `soft` for a figure that matters less; `over`, `warn` and `good` colour a status. */
  tone?: 'soft' | 'over' | 'warn' | 'good';
  strong?: boolean;
  /** Its side, when the table has no column heads to take it from. */
  align?: 'left' | 'right';
}

/**
 * A table of figures, under the paragraphs. Each row also says itself as one line, for the text
 * twin, because columns do not survive plain text.
 */
export interface MailTable {
  /** A short label above the table. */
  title?: string;
  /** The column heads, which also set each column's side. None for a list of labelled figures. */
  columns?: { label: string; align?: 'left' | 'right' }[];
  rows: { cells: MailCell[]; text: string }[];
  /** What the table says when it has no rows. */
  empty?: string;
}

/**
 * What one mail says, in the order the layout shows it. The types hold the layout's limits: one
 * headline, one or two paragraphs, at most two tables, one button or a button and a quieter second
 * one, and at most one list of steps. Every string is plain text; renderMail escapes it.
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
  /** Tables of figures, under the paragraphs: the mails that show an amount of money. */
  tables?: [MailTable] | [MailTable, MailTable];
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
  /** The reminders' one-click unsubscribe link, in the footer after the reason. */
  unsubUrl?: string | null;
  /**
   * The mail goes to an address that is not confirmed yet, with the link that confirms it. It then
   * carries no link into the app, the wordmark's and the text twin's "Open the app" included: a
   * sign-in before the address is confirmed is refused, so such a link would end on a sign-in
   * that answers as a wrong password (routes/auth.ts).
   */
  unconfirmed?: boolean;
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

/** Holds a number and its unit on one line ("10 minutes"), so a phone never strands the unit. */
const keepTogether = (html: string) =>
  html.replace(/(\d) (minutes?|hours?|days?)\b/g, '$1&nbsp;$2');

/** The headline, with its last two words on one line, so none of them sits alone. */
const headlineHtml = (headline: string) => escapeHtml(headline).replace(/ (\S+)$/, '&nbsp;$1');

const mailParagraph = (html: string) =>
  `<p class="tc-soft" style="margin:14px 0 0;font:16px/1.6 ${FONT};color:${INK.soft}">${keepTogether(html)}</p>`;

const mailSmall = (html: string, top = 14) =>
  `<p class="tc-muted" style="margin:${top}px 0 0;font:14px/1.6 ${FONT};color:${INK.muted}">${keepTogether(html)}</p>`;

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
        `<tr><td class="tc-rule" style="border-top:1px solid ${INK.rule};padding:16px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="34" valign="top" class="tc-muted" style="font:600 14px/1.5 ${FONT};color:${INK.muted}">${i + 1}</td><td valign="top"><div class="tc-text" style="font:600 16px/1.4 ${FONT};color:${INK.text}">${escapeHtml(step.title)}</div><div class="tc-soft" style="margin:4px 0 0;font:14px/1.6 ${FONT};color:${INK.soft}">${escapeHtml(step.text)}</div>${step.link ? `<div style="margin:8px 0 0;font:14px/1.4 ${FONT}">${mailLink({ label: `${step.link.label} →`, href: step.link.href })}</div>` : ''}</td></tr></table></td></tr>`
    )
    .join('');
  return `<tr><td class="tc-pad" style="padding:26px 36px ${bottom}px"><div class="tc-muted" style="font:600 14px/1.4 ${FONT};letter-spacing:0.2px;color:${INK.muted};margin:0 0 6px">${escapeHtml(title)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>`;
}

const TONE_COLOUR = {
  soft: INK.soft,
  over: TONE.over,
  warn: TONE.warn,
  good: TONE.good,
} as const;

/**
 * A table: its title, a row of column heads, then a row per entry over a hairline. Figures sit
 * right and never break; a name sits left and wraps. Every cell after the first keeps a gap from
 * the one before it, which a phone narrows.
 */
function mailTable(table: MailTable): string {
  const title = table.title
    ? `<div class="tc-text" style="margin:26px 0 2px;font:600 14px/1.4 ${FONT};color:${INK.text}">${escapeHtml(table.title)}</div>`
    : '';
  const gap = (i: number) => (i === 0 ? '' : 'padding-left:12px;');
  const head = table.columns
    ? `<tr>${table.columns
        .map(
          (col, i) =>
            `<th class="tc-muted tc-rule${i ? ' tc-cell-gap' : ''}" align="${col.align ?? 'left'}" style="${gap(i)}padding-top:0;padding-bottom:8px;border-bottom:1px solid ${INK.rule};font:600 12px/1.4 ${FONT};letter-spacing:0.3px;color:${INK.muted};text-align:${col.align ?? 'left'}">${escapeHtml(col.label)}</th>`
        )
        .join('')}</tr>`
    : '';
  const cell = (c: MailCell, i: number) => {
    const align = c.align ?? table.columns?.[i]?.align ?? 'left';
    const tone = c.tone ? `tc-${c.tone}` : 'tc-text';
    const color = c.tone ? TONE_COLOUR[c.tone] : INK.text;
    const dot =
      c.dot !== undefined
        ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${sanitizeColor(c.dot)};margin-right:8px;vertical-align:middle"></span>`
        : '';
    const words = keepTogether(escapeHtml(c.text));
    return `<td class="${tone} tc-rule tc-cell${i ? ' tc-cell-gap' : ''}" align="${align}" style="${gap(i)}padding-top:11px;padding-bottom:11px;border-bottom:1px solid ${INK.rule};font:${c.strong ? '600 ' : ''}15px/1.45 ${FONT};color:${color};text-align:${align};${align === 'right' ? 'white-space:nowrap' : 'word-break:break-word'}">${dot}${words}</td>`;
  };
  const rows = table.rows.length
    ? table.rows.map((row) => `<tr>${row.cells.map(cell).join('')}</tr>`).join('')
    : `<tr>${cell({ text: table.empty ?? '', tone: 'soft' }, 0)}</tr>`;
  return `${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:${title ? 8 : 22}px 0 4px;border-collapse:collapse">${head}${rows}</table>`;
}

/** A table in the text twin: its title, then a line for each row. */
const mailTableText = (table: MailTable) =>
  [
    ...(table.title ? [table.title] : []),
    ...(table.rows.length ? table.rows.map((row) => row.text) : [table.empty ?? '']),
  ].join('\n');

/** The footer's first line. */
const TAGLINE = 'Your money, in clear orbit. Open source and local-first.';

/**
 * The footer's row of links. Four short words joined by no-break spaces, so the row never wraps
 * and no line starts or ends with a dot: about 200 px at 13 px, which fits the 264 px a 320 px
 * phone leaves it. The app is the wordmark's link; the contact address has a line of its own.
 */
const FOOTER_LINKS: MailLink[] = [
  { label: 'About', href: ABOUT_URL },
  { label: 'GitHub', href: REPO_URL },
  { label: 'Terms', href: TERMS_URL },
  { label: 'Privacy', href: PRIVACY_URL },
];

const footerLink = ({ label, href }: MailLink, color: string = INK.link, cls = 'tc-link') =>
  `<a class="${cls}" href="${escapeHtml(href)}" style="color:${color};text-decoration:none">${escapeHtml(label)}</a>`;

/**
 * The footer, centred under the card, one block a line: the tagline, the links, the copyright,
 * the contact address, and then, set apart, why this mail came with its unsubscribe link.
 */
function mailFooter(reason: string, unsubUrl?: string | null): string {
  // Each sentence of the tagline holds together, so a phone breaks it between them and never
  // after "local-", which left "first." alone on a line at 375 px.
  const taglineHtml = TAGLINE.split('. ')
    .map(
      (sentence, i, all) =>
        `<span style="white-space:nowrap">${escapeHtml(i < all.length - 1 ? `${sentence}.` : sentence)}</span>`
    )
    .join(' ');
  const dot = `<span class="tc-sep" style="color:${INK.rule}">&nbsp;&middot;&nbsp;</span>`;
  const p = (margin: string, size: number, html: string, extra = '') =>
    `<p class="tc-muted" style="margin:${margin};font:${size}px/1.6 ${FONT};color:${INK.muted};${extra}">${html}</p>`;
  return `<tr><td align="center" style="padding:24px 16px 8px;text-align:center">
${p('0 0 12px', 14, taglineHtml)}
${p('0 0 14px', 13, FOOTER_LINKS.map((link) => footerLink(link)).join(dot), 'white-space:nowrap')}
${p('0 0 4px', 12, `&copy; ${new Date().getUTCFullYear()} ${BRAND} &middot; AGPL-3.0`, 'white-space:nowrap')}
${p('0', 12, footerLink({ label: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` }, INK.muted, 'tc-muted'))}
${p('18px 0 0', 12, `${escapeHtml(reason)}${unsubUrl ? ` ${footerLink({ label: 'Unsubscribe', href: unsubUrl })}` : ''}`)}
</td></tr>`;
}

/** The text twin's last lines, the same for every mail on this layout, in the footer's order. */
const mailTextFooter = (reason: string, unsubUrl?: string | null, unconfirmed = false) =>
  [
    TAGLINE,
    ...(unconfirmed ? [] : [`Open the app: ${APP_URL}`]),
    ...FOOTER_LINKS.map(({ label, href }) => `${label}: ${href}`),
    `© ${new Date().getUTCFullYear()} ${BRAND} · AGPL-3.0`,
    CONTACT_EMAIL,
    '',
    reason,
    ...(unsubUrl ? [`Unsubscribe: ${unsubUrl}`] : []),
  ].join('\n');

/** One mail on the layout: its HTML and its plain-text twin, from the same words. */
export function renderMail(spec: MailSpec): RenderedEmail {
  // The wordmark and the art load from the SENDING environment's app origin, so a dev mail never
  // depends on a prod release shipping the file; the links stay canonical. The prod app when the
  // caller names none.
  const assets = spec.assetOrigin || APP_URL;
  const art = ART[spec.art];
  const wordmark = `<img src="${assets}/icon-192.png" width="26" height="26" alt="" class="tc-text" style="vertical-align:middle;border:0;border-radius:7px;color:${INK.text}"><span class="tc-text" style="font:600 16px/1 ${FONT};color:${INK.text};vertical-align:middle;letter-spacing:-0.1px">&nbsp;&nbsp;${BRAND}</span>`;
  const img = `<img src="${assets}${art.path}" width="${art.width}" height="${art.height}" alt="" class="tc-soft" style="display:block;width:100%;height:auto;border:0;border-radius:18px 18px 0 0;color:${INK.soft}">`;
  // The card's last row carries its bottom padding.
  const after = { steps: !!spec.steps, signOff: !!spec.signOff, aside: !!spec.aside };
  const rows = [
    `<tr><td style="padding:0;font-size:0;line-height:0">${spec.artHref ? `<a href="${escapeHtml(spec.artHref)}" style="display:block">${img}</a>` : img}</td></tr>`,
    `<tr><td class="tc-pad" style="padding:30px 36px ${after.steps || after.signOff || after.aside ? 6 : 30}px">` +
      (spec.eyebrow
        ? `<div class="tc-link" style="font:600 14px/1.4 ${FONT};letter-spacing:0.2px;color:${INK.link};margin:0 0 10px">${escapeHtml(spec.eyebrow)}</div>`
        : '') +
      `<h1 class="tc-text tc-h1" style="margin:0;font:600 32px/1.15 ${FONT};letter-spacing:-0.4px;color:${INK.text}">${headlineHtml(spec.headline)}</h1>` +
      (spec.code ? mailCode(spec.code) : '') +
      spec.paragraphs.map((paragraph) => mailParagraph(paragraphHtml(paragraph))).join('') +
      (spec.tables ?? []).map(mailTable).join('') +
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
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
${COLOR_SCHEME_META}
<title>${escapeHtml(spec.subject)}</title>
${AUTO_LINK_STYLE}
${mailStyle(!!spec.tables)}
</head>
<body id="body" class="tc-page" bgcolor="${INK.page}" style="margin:0;padding:0;background:${INK.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;color:${INK.page}">${escapeHtml(spec.preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" class="tc-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${INK.page}" style="background:${INK.page}"><tr><td align="center" style="padding:22px 12px 30px">
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td style="padding:2px 6px 14px">${spec.unconfirmed ? wordmark : `<a class="tc-text" href="${APP_URL}" style="text-decoration:none;color:${INK.text}">${wordmark}</a>`}</td></tr>
<tr><td class="tc-card" bgcolor="${INK.card}" style="background:${INK.card};border-radius:18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>
${mailFooter(spec.reason, spec.unsubUrl)}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>
`;
  const text = [
    ...(spec.eyebrow ? [spec.eyebrow] : []),
    spec.headline,
    ...(spec.code ? [spec.code] : []),
    ...spec.paragraphs.map(paragraphText),
    ...(spec.tables ?? []).map(mailTableText),
    ...(spec.buttons
      ? [spec.buttons.map(({ label, href }) => `${label}: ${href}`).join('\n')]
      : []),
    ...(spec.notes ?? []),
    ...(spec.steps
      ? [
          spec.steps.title,
          ...spec.steps.items.map(
            (step, i) =>
              `${i + 1}. ${step.title}\n${step.text}${step.link ? `\n${step.link.label}: ${step.link.href}` : ''}`
          ),
        ]
      : []),
    ...(spec.signOff ? [spec.signOff] : []),
    ...(spec.aside ? [spec.aside] : []),
    mailTextFooter(spec.reason, spec.unsubUrl, spec.unconfirmed),
  ].join('\n\n');
  // The footer's unsubscribe link is also the List-Unsubscribe header sendMail sends, so the two
  // can never name different links.
  return {
    subject: spec.subject,
    html,
    text,
    ...(spec.unsubUrl ? { listUnsubscribe: spec.unsubUrl } : {}),
  };
}

// ── Renderers ─────────────────────────────────────────────────────────────────
//
// The sign-up mails: the Welcome and a fresh confirm link, on the mail layout.
//
// A password sign-up gets one mail, the Welcome with its confirm link (routes/auth.ts): the link is
// the one thing to do, and the steps say where to start once the account is open. A Google sign-up
// gets the Welcome without a link, its address confirmed by Google. #620 splits these into Confirm
// and a Welcome sent once the address is confirmed; that needs a migration main does not have yet.

/** How long a link lasts, in words. */
const lasts = (hours: number) => (hours === 1 ? '1 hour' : `${hours} hours`);

/** What both confirm mails say to someone who never signed up. */
const NOT_YOU = `Didn't sign up for ${BRAND}? Ignore this mail. Nobody can use the account until this address is confirmed.`;

/** Why a mail with a confirm link came. */
const SIGNED_UP = `You are getting this because this address was used to sign up for ${BRAND}.`;

/**
 * A fresh confirm link: Send the link again, or a sign-up again for an address still waiting for
 * its link, which an inbox gets without having asked, so the mail says nothing of asking. Minting
 * it retires the links sent before it (createEmailVerification), and the mail says so.
 *
 * It says what the link does today. It spends itself at once where its own account is signed in
 * (a link asked for from the Confirm your email screen, in that session); anywhere else it asks
 * for a sign-in, in any browser, and that sign-in confirms the address (email-link.ts). So the
 * sign-in is conditional here. It promises nothing more until the same-browser sign-in ships,
 * which is when a mail can say "One click" again (maff's call of 2026-10-11).
 */
export function renderEmailVerification(opts: {
  link: string;
  ttlHours: number;
  assetOrigin?: string;
}): RenderedEmail {
  return renderMail({
    subject: `Your new confirm link for ${BRAND}`,
    preheader: `It replaces the links sent before. It works once, for ${lasts(opts.ttlHours)}.`,
    art: 'banner',
    headline: "Here's a fresh link.",
    paragraphs: [
      'Use this link to confirm your address. It replaces the ones sent before.',
      `If it asks you to sign in, sign in right there, in this browser or any other, and your ${BRAND} account opens.`,
    ],
    buttons: [{ label: 'Confirm my email', href: opts.link }],
    notes: [
      `The link works once, for ${lasts(opts.ttlHours)}. Run out? Open it anyway and choose Send the link again.`,
    ],
    paste: opts.link,
    aside: NOT_YOU,
    unconfirmed: true,
    reason: SIGNED_UP,
    assetOrigin: opts.assetOrigin,
  });
}

/** Where to start, in both welcomes: the three pages, and why each. */
const WELCOME_STEPS = [
  {
    title: 'Bring your history',
    text: 'Statements from Revolut, N26, Wise, Erste, PBZ, ING, DKB and Sparkasse import as they are, and so do YNAB exports. Any other CSV or Excel file works once you match its columns. Rows you already have are skipped.',
    label: 'Open Import',
    hash: '#import',
  },
  {
    title: 'Find your subscriptions',
    text: `${BRAND} spots the subscriptions in your statements, from streaming to cloud storage, with each one's price and how often it charges. Tick the ones you want tracked as bills.`,
    label: 'Open Bills',
    hash: '#bills',
  },
  {
    title: 'Watch your year fill in',
    text: "Progress counts every month that holds three or more entries. Twelve in a row earns the A year badge, and a full year's import can earn it on day one.",
    label: 'Open Progress',
    hash: '#progress',
  },
] as const;

/**
 * The Welcome. Step 3 is the version for before finance prints ship: what Progress counts, and the
 * badge a year earns (frontend/src/core/achievements/definitions.ts). `appUrl` is the app the links
 * open; the art loads from `assetOrigin`, or from the app.
 *
 * With `verifyUrl`, the welcome of a password sign-up: the confirm link is its button, and the steps
 * carry no links, because before the address is confirmed a sign-in is refused and a page link
 * would open on a sign-in that fails. It does not say how long the link lasts: the caller passes
 * only the link, and the link's own page offers Send the link again once it has run out.
 */
export function renderWelcome(
  opts: { appUrl?: string; assetOrigin?: string; verifyUrl?: string } = {}
): RenderedEmail {
  const app = opts.appUrl || APP_URL;
  const assetOrigin = opts.assetOrigin || opts.appUrl;
  const confirm = opts.verifyUrl;
  if (confirm) {
    return renderMail({
      subject: `Welcome to ${BRAND}: confirm your email`,
      preheader: 'Open the link, then sign in where it opens. Your account opens with it.',
      art: 'hero',
      eyebrow: `Welcome to ${BRAND}`,
      headline: "One link, one sign-in, and you're in.",
      paragraphs: [
        `Open the link in any browser and sign in there. That confirms this address and opens your ${BRAND} account.`,
        `${BRAND} shows where your money goes, month by month, for you alone or for a whole household. The more history it can read, the more it can tell you, so begin with a year of statements from your bank.`,
      ],
      buttons: [{ label: 'Confirm my email', href: confirm }],
      notes: ['The link works once. Run out? Open it anyway and choose Send the link again.'],
      paste: confirm,
      steps: {
        title: 'Once you are in',
        items: WELCOME_STEPS.map(({ title, text }) => ({ title, text })),
      },
      aside: NOT_YOU,
      unconfirmed: true,
      reason: SIGNED_UP,
      assetOrigin,
    });
  }
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
      items: WELCOME_STEPS.map(({ title, text, label, hash }) => ({
        title,
        text,
        link: { label, href: `${app}/${hash}` },
      })),
    },
    signOff: "Questions, or a bank file that won't import? Reply to this mail.",
    reason: `You are getting this because a ${BRAND} account was created with this address.`,
    assetOrigin,
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

/** Anti-enumeration notice: someone tried to sign up with an address that has an account. */
export function renderAccountExists(opts: { appUrl?: string }): RenderedEmail {
  const app = opts.appUrl || APP_URL;
  return renderMail({
    subject: `You already have a ${BRAND} account`,
    preheader: 'Someone tried to sign up with your address. Your account is unchanged.',
    art: 'banner',
    headline: 'This address already has an account.',
    paragraphs: [
      `Someone just tried to create a ${BRAND} account with this email address, but one already exists.`,
      "If that was you, sign in, or reset your password from the sign-in screen if you've forgotten it. If it wasn't, there's nothing to do: your account is unchanged.",
    ],
    buttons: [{ label: 'Sign in', href: app }],
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

/**
 * A card was declined and Stripe is retrying. The subscription is still live meanwhile. It shows
 * the amount due, when Stripe gave one.
 */
export function renderPaymentFailed(opts: {
  planName: string;
  amountDue?: number | null;
  currency?: string | null;
  nextAttempt?: Date | null;
  payUrl?: string | null;
  appUrl?: string;
}): RenderedEmail {
  const app = opts.appUrl || APP_URL;
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
  return renderMail({
    subject: `Your ${BRAND} payment didn't go through`,
    preheader: `Your card was declined. Your plan is still active${retry ? `, and we try the card again on ${retry}` : ''}.`,
    art: 'banner',
    headline: "Your payment didn't go through.",
    paragraphs: [
      `Your bank declined the ${amount ? `${amount} ` : ''}payment for ${BRAND} ${opts.planName}. An expired card, a new card number or a bank with questions are the usual reasons.`,
      [
        { strong: 'Nothing has changed yet.' },
        ` Your plan is still active and we'll try the card again${retry ? ` on ${retry}` : ''}. Updating it now is the quickest way to settle this.`,
      ],
    ],
    buttons: [{ label: 'Update your card', href: opts.payUrl || `${app}/#settings` }],
    notes: [
      'If the retries run out, the account moves to Free. Nothing is deleted: your data stays where it is, and you can pick the plan back up whenever you like.',
    ],
    reason: `You are getting this because a payment for your ${BRAND} subscription could not be collected.`,
    assetOrigin: opts.appUrl,
  });
}

/**
 * The bank wants the cardholder to confirm (3-D Secure / SCA). Deliberately not the same mail as a
 * decline: nothing is wrong, and the only thing that fixes it is the user opening a page, which a
 * "your payment failed" subject line makes them less likely to do, not more. It shows no amount.
 */
export function renderPaymentActionRequired(opts: {
  planName: string;
  payUrl?: string | null;
  appUrl?: string;
}): RenderedEmail {
  const app = opts.appUrl || APP_URL;
  return renderMail({
    subject: `Your bank needs you to confirm a ${BRAND} payment`,
    preheader: 'A quick confirmation with your bank, then the payment goes through.',
    art: 'banner',
    headline: 'Your bank wants one more step.',
    paragraphs: [
      `Your bank wants you to confirm the payment for ${BRAND} ${opts.planName} before it goes through. It's the usual card verification, not a problem with your card.`,
    ],
    buttons: [{ label: 'Confirm the payment', href: opts.payUrl || `${app}/#settings` }],
    notes: [
      "Your plan stays active while this is outstanding. If it isn't confirmed, the payment is treated as failed and we retry it.",
    ],
    reason: `You are getting this because your bank asked you to confirm a ${BRAND} subscription payment.`,
    assetOrigin: opts.appUrl,
  });
}

/**
 * The subscription is over: cancelled, or dunning ran out. Says what happens to the data.
 */
export function renderSubscriptionEnded(opts: {
  planName: string;
  appUrl?: string;
}): RenderedEmail {
  const app = opts.appUrl || APP_URL;
  return renderMail({
    subject: `Your ${BRAND} ${opts.planName} plan has ended`,
    preheader: 'Your account is on Free now. Nothing has been deleted.',
    art: 'banner',
    headline: 'Your plan has ended.',
    paragraphs: [
      `Your ${BRAND} ${opts.planName} plan has ended, and your account is on Free now. Nothing has been deleted: you can open everything, and export all of it from Settings at any time.`,
      'Choosing a plan again brings the paid features back straight away, with nothing to restore or re-import.',
    ],
    buttons: [{ label: 'Open Settings', href: `${app}/#settings` }],
    notes: [
      "If you didn't mean to end it (a card that expired, say), choosing the plan again is all it takes.",
    ],
    reason: `You are getting this because your ${BRAND} subscription ended.`,
    assetOrigin: opts.appUrl,
  });
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

/** Why a reminder came: the toggle that sends it, or the preview the reader sent themselves. */
const reminderReason = (what: string, test?: boolean) =>
  test
    ? 'You are getting this because you sent yourself a preview from Email reminders in Settings.'
    : `You are getting this because ${what} are on under Email reminders in Settings.`;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The budgets over their limit or close to it this month, each with its budget, what was spent
 * and where it stands. The scheduled send lists those at 80% or more; the preview from Settings
 * lists every budget, so its headline claims "close" only when every one is.
 */
export function renderBudgetAlert(opts: {
  alerts: BudgetAlertRow[];
  currency?: string | null;
  unsubUrl?: string | null;
  periodLabel?: string;
  test?: boolean;
  assetOrigin?: string;
}): RenderedEmail | null {
  if (opts.alerts.length === 0) return null;
  const money = (amount: number) => formatMoney(amount, opts.currency);
  const over = opts.alerts.filter((a) => a.status === 'over').length;
  const close = opts.alerts.length - over;
  const headline = over
    ? over === 1
      ? 'A budget went over its limit.'
      : `${over} budgets went over their limit.`
    : opts.alerts.every((a) => a.percentage >= 80)
      ? close === 1
        ? 'A budget is close to its limit.'
        : `${close} budgets are close to their limit.`
      : 'Where your budgets stand.';
  const status = (a: BudgetAlertRow) => (a.status === 'over' ? 'Over' : `${a.percentage}%`);
  // The subject names the budget furthest along; the table lists them all.
  const top = opts.alerts.reduce((a, b) => (b.percentage > a.percentage ? b : a));
  const more = opts.alerts.length - 1;
  return renderMail({
    subject: `${opts.test ? '[Test] ' : ''}Budget alert${opts.periodLabel ? ` for ${opts.periodLabel}` : ''}: ${top.categoryName} ${top.status === 'over' ? 'went over' : `is at ${top.percentage}%`}`,
    preheader: `${top.categoryName}: ${money(top.spent)} of ${money(top.budgetAmount)}${more ? `, and ${more} more` : ''}.`,
    art: 'banner',
    headline,
    paragraphs: [
      `Here's what you've spent ${opts.periodLabel ? `in ${opts.periodLabel}` : 'so far this month'}, against the budget you set for each category.`,
    ],
    tables: [
      {
        columns: [
          { label: 'Category' },
          { label: 'Budget', align: 'right' },
          { label: 'Spent', align: 'right' },
          { label: 'Status', align: 'right' },
        ],
        rows: opts.alerts.map((a) => ({
          cells: [
            { text: a.categoryName, dot: a.categoryColor },
            { text: money(a.budgetAmount), tone: 'soft' },
            { text: money(a.spent) },
            { text: status(a), tone: a.status === 'over' ? 'over' : 'warn', strong: true },
          ],
          text: `- ${a.categoryName}: ${money(a.spent)} of ${money(a.budgetAmount)} (${status(a).toLowerCase()})`,
        })),
      },
    ],
    buttons: [{ label: 'Review budgets', href: `${APP_URL}/#budgets` }],
    reason: reminderReason('budget alerts', opts.test),
    unsubUrl: opts.unsubUrl,
    assetOrigin: opts.assetOrigin,
  });
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

/** A period's income, spending and what was left, then the categories it went to. */
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
  const money = (amount: number) => formatMoney(amount, opts.currency);
  const net = r.netBalance;
  const headline =
    net > 0
      ? `You kept ${money(net)}.`
      : net < 0
        ? `You spent ${money(-net)} more than came in.`
        : 'Income and spending came out even.';
  const figure = (label: string, amount: number, tone: MailCell['tone']) => ({
    cells: [
      { text: label, tone: 'soft' as const },
      { text: money(amount), tone, strong: true, align: 'right' as const },
    ],
    text: `${label}: ${money(amount)}`,
  });
  return renderMail({
    subject: `${opts.test ? '[Test] ' : ''}Your spending report${opts.periodLabel ? ` for ${opts.periodLabel}` : `, ${r.startDate} to ${r.endDate}`}`,
    preheader: `Income ${money(r.totalIncome)}, expenses ${money(r.totalExpenses)}, net ${money(net)}.`,
    art: 'banner',
    headline,
    paragraphs: [
      `From ${r.startDate} to ${r.endDate}, across ${r.transactionCount} ${plural(r.transactionCount, 'transaction', 'transactions')}.`,
    ],
    tables: [
      {
        rows: [
          figure('Income', r.totalIncome, 'good'),
          figure('Expenses', r.totalExpenses, 'over'),
          figure('Net', net, net >= 0 ? 'good' : 'over'),
        ],
      },
      {
        title: 'Top spending categories',
        rows: r.categoryBreakdown.map((cat) => ({
          cells: [
            { text: cat.name || 'Uncategorized', dot: cat.color },
            { text: money(cat.total), align: 'right' },
          ],
          text: `- ${cat.name || 'Uncategorized'}: ${money(cat.total)}`,
        })),
        empty: 'No spending in this period.',
      },
    ],
    buttons: [{ label: 'Open analytics', href: `${APP_URL}/#analytics` }],
    reason: reminderReason('spending reports', opts.test),
    unsubUrl: opts.unsubUrl,
    assetOrigin: opts.assetOrigin,
  });
}

export interface UpcomingBillRow {
  name: string;
  amount: number;
  due_date: string | null;
  daysUntilDue: number;
  overdue: boolean;
}

/** The bills overdue or due within a week, each with its amount, due date and how soon. */
export function renderBillsReminder(opts: {
  bills: UpcomingBillRow[];
  currency?: string | null;
  unsubUrl?: string | null;
  test?: boolean;
  assetOrigin?: string;
}): RenderedEmail | null {
  if (opts.bills.length === 0) return null;
  const money = (amount: number) => formatMoney(amount, opts.currency);
  const when = (b: UpcomingBillRow) =>
    b.overdue
      ? 'Overdue'
      : b.daysUntilDue === 0
        ? 'Due today'
        : b.daysUntilDue === 1
          ? 'Tomorrow'
          : `In ${b.daysUntilDue} days`;
  const tone = (b: UpcomingBillRow): MailCell['tone'] =>
    b.overdue || b.daysUntilDue === 0 ? 'over' : b.daysUntilDue <= 2 ? 'warn' : 'soft';
  const overdue = opts.bills.filter((b) => b.overdue).length;
  const soon = opts.bills.length - overdue;
  const bills = (n: number) => `${n} ${plural(n, 'bill', 'bills')}`;
  const summary =
    overdue && soon
      ? `${bills(overdue)} overdue, ${soon} due within a week`
      : overdue
        ? `${bills(overdue)} overdue`
        : `${bills(soon)} due within a week`;
  const headline =
    overdue && soon
      ? `${bills(overdue)} ${plural(overdue, 'is', 'are')} overdue, and ${soon} more ${plural(soon, 'is', 'are')} due within a week.`
      : overdue
        ? `${overdue === 1 ? 'A bill is' : `${overdue} bills are`} overdue.`
        : `${soon === 1 ? 'A bill is' : `${soon} bills are`} due within a week.`;
  const [first] = opts.bills;
  const firstWhen = first!.overdue
    ? 'overdue'
    : first!.daysUntilDue === 0
      ? 'due today'
      : first!.daysUntilDue === 1
        ? 'due tomorrow'
        : `due in ${first!.daysUntilDue} days`;
  const more = opts.bills.length - 1;
  return renderMail({
    subject: `${opts.test ? '[Test] ' : ''}${summary}`,
    preheader: `${first!.name}: ${money(first!.amount)}, ${firstWhen}.${more ? ` And ${more} more.` : ''}`,
    art: 'banner',
    headline,
    paragraphs: [
      "Here's what each one costs and when it falls due. Paid one already? Mark it paid in Bills.",
    ],
    tables: [
      {
        columns: [
          { label: 'Bill' },
          { label: 'Amount', align: 'right' },
          { label: 'Due', align: 'right' },
          { label: 'When', align: 'right' },
        ],
        rows: opts.bills.map((b) => ({
          cells: [
            { text: b.name },
            { text: money(b.amount) },
            { text: b.due_date || 'No date', tone: 'soft' },
            { text: when(b), tone: tone(b), strong: true },
          ],
          text: `- ${b.name}: ${money(b.amount)}. ${when(b)}${b.due_date ? ` (${b.due_date})` : ''}.`,
        })),
      },
    ],
    buttons: [{ label: 'Open bills', href: `${APP_URL}/#bills` }],
    reason: reminderReason('reminders for upcoming bills', opts.test),
    unsubUrl: opts.unsubUrl,
    assetOrigin: opts.assetOrigin,
  });
}

// ── Small utility mails ───────────────────────────────────────────────────────

/**
 * Settings, Email reminders, Test: checks that mail reaches the account's address. It says nothing
 * of how the reminders look: the previews beside it send the real ones.
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
