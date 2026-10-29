/**
 * Every mail declares "light only" (COLOR_SCHEME_META in emailTemplates.ts), which stops the Gmail
 * apps on the iPhone recolouring it in dark mode (MercuryPitch's probe mails, 2026-10-14). A client
 * that honours it paints text with no colour of its own black, and a link link blue, so nothing in
 * a mail may lean on those defaults: every line of text, every link and every picture carries its
 * own colour. Ported from MercuryPitch's email-color-scheme.test.ts.
 */
import { describe, expect, it } from 'vitest';
import * as templates from '../src/emailTemplates';
import { mailSamples } from '../scripts/mail-samples';
import { amountMailGrid } from './helpers/amount-mail-grid';

/** An inline colour of its own: not background-color or border-color, and not a keyword. */
const OWN_COLOR = /(?:^|;)\s*color\s*:\s*(?!inherit|transparent|currentcolor)[^;\s]/i;

/** Elements that never wrap text. */
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/** A start tag's own style attribute. */
const styleOf = (tag: string) => /\sstyle="([^"]*)"/i.exec(tag)?.[1] ?? '';

interface Open {
  name: string;
  colored: boolean;
  flagged: boolean;
}

/**
 * Every line of text with no inline colour on any element between it and <body>, every link with
 * words in it and no colour of its own, and every picture with none. The mails are generated,
 * well-formed HTML, so a tokenizer is enough: comments (Outlook's [if mso] blocks among them), the
 * doctype and the head's raw-text elements are skipped whole.
 */
function uncolored(html: string): string[] {
  const found: string[] = [];
  const stack: Open[] = [];
  let inBody = false;
  const tokens =
    /<!--[\s\S]*?-->|<!doctype[^>]*>|<(style|title|script)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?([a-z][a-z0-9]*)\b[^>]*>|[^<]+/gi;
  for (const [token, rawText, tagName] of html.matchAll(tokens)) {
    if (token.startsWith('<!') || rawText !== undefined) continue;
    if (tagName === undefined) {
      // Spacers and the preheader's padding characters draw nothing.
      const text = token.replace(/&(?:nbsp|zwnj|#160|#8199|#847|#8203);/gi, ' ').trim();
      if (!inBody || text === '') continue;
      if (!stack.some((open) => open.colored)) found.push(`text: ${text.slice(0, 40)}`);
      const link = stack.findLast((open) => open.name === 'a');
      if (link !== undefined && !link.colored && !link.flagged) {
        link.flagged = true;
        found.push(`link: ${text.slice(0, 40)}`);
      }
      continue;
    }
    const name = tagName.toLowerCase();
    if (token.startsWith('</')) {
      const at = stack.map((open) => open.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
      continue;
    }
    if (name === 'body') {
      inBody = true;
      continue;
    }
    const colored = OWN_COLOR.test(styleOf(token));
    if (name === 'img') {
      if (!colored) found.push(`picture: ${/\ssrc="([^"]*)"/i.exec(token)?.[1] ?? ''}`);
      continue;
    }
    if (VOID.has(name) || token.endsWith('/>')) continue;
    stack.push({ name, colored, flagged: false });
  }
  return found;
}

/** Every mail: the catalogue, and every mail the amount grid renders. */
function everyMail(): Array<{ label: string; html: string }> {
  const mails = mailSamples().map((sample) => ({ label: sample.name, html: sample.render().html }));
  for (const [name, inputs] of Object.entries(amountMailGrid())) {
    const render = (templates as unknown as Record<string, (input: unknown) => unknown>)[name]!;
    inputs.forEach((input, i) => {
      const mail = render(input) as { html: string } | null;
      if (mail) mails.push({ label: `${name} #${i}`, html: mail.html });
    });
  }
  return mails;
}

describe('the colour scheme every mail declares', () => {
  const mails = everyMail();

  it('is "light only", in both meta tags and on :root, never "dark"', () => {
    expect(mails.length).toBeGreaterThan(400);
    for (const { label, html } of mails) {
      expect(html, label).toContain('<meta name="color-scheme" content="light only">');
      expect(html, label).toContain('<meta name="supported-color-schemes" content="light only">');
      expect(html, label).toContain(
        ':root { color-scheme: light only; supported-color-schemes: light only; }'
      );
      expect(html, label).not.toMatch(/color-schemes?"? content="[^"]*dark/);
      expect(html, label).not.toMatch(/color-scheme:[^;}]*dark/);
    }
  });

  it('keeps the paper variant for a client that fires the light query', () => {
    // A media query reads the reader's setting, not the declaration, so it still comes.
    for (const { label, html } of mails) {
      expect(html, label).toContain('@media (prefers-color-scheme: light) {');
    }
  });

  it('gives a link a client makes from plain text the colour of the words around it', () => {
    for (const { label, html } of mails) {
      expect(html, label).toContain(
        '<style>a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important;}u + #body a{color:inherit;}</style>'
      );
      expect(html, label).toMatch(/<body id="body" /);
    }
  });

  it('colours every line of text, every link and every picture inline', () => {
    for (const { label, html } of mails) expect(uncolored(html), label).toEqual([]);
  });

  it('finds what it should: text, a link and a picture with no colour of their own', () => {
    expect(
      uncolored(
        '<html><head><style>p{}</style></head><body><p>Plain</p><p style="background-color:#000">Dark</p><a href="x">Go</a><img src="a.png" alt=""><p style="color:#fff">Fine <a href="y" style="color:inherit">kept</a></p></body></html>'
      )
    ).toEqual([
      'text: Plain',
      'text: Dark',
      'text: Go',
      'link: Go',
      'picture: a.png',
      'link: kept',
    ]);
  });
});
