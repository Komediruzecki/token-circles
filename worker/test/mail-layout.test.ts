/**
 * The mail layout of 2026-10-11 (renderMail in emailTemplates.ts), on its own: the shape every mail
 * in it shares, whatever it says. The mails themselves are tested in email-templates.test.ts.
 *
 * The shape is the one the design settled: the wordmark above the card, the engraved art flush at
 * the top of the card, then an eyebrow, one headline, one or two short paragraphs, a button and at
 * most one list of numbered steps, and the footer outside the card. Dark by default, paper in light
 * mode through prefers-color-scheme, and every dark colour also an attribute, which classic Outlook
 * reads where it ignores CSS.
 */
import { describe, expect, it } from 'vitest';
import { renderMail, type MailSpec } from '../src/emailTemplates';

const LINK = 'https://app.example/#thing?a=1&b=2';

const SPEC: MailSpec = {
  subject: 'A subject for the layout test',
  preheader: 'The line beside the subject.',
  art: 'banner',
  headline: 'One headline.',
  paragraphs: ['The first paragraph.', 'The second paragraph.'],
  buttons: [{ label: 'Do the thing', href: LINK }],
  notes: ['A note under the button.'],
  paste: LINK,
  aside: 'Below the rule.',
  reason: 'You are getting this because a test asked for it.',
  assetOrigin: 'https://dev.example',
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * The markup of the card: from its <td class="tc-card"> to the </td> that closes it, found by
 * counting the cells opened and closed inside it.
 */
function cardOf(html: string): { start: number; end: number; inner: string } {
  const start = html.indexOf('<td class="tc-card"');
  expect(start, 'the card').toBeGreaterThan(-1);
  const tags = /<td\b|<\/td>/g;
  tags.lastIndex = start + 1;
  let depth = 1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[0] === '</td>' ? -1 : 1;
    if (depth === 0) {
      const end = tag.index + tag[0].length;
      return { start, end, inner: html.slice(html.indexOf('>', start) + 1, tag.index) };
    }
  }
  throw new Error('the card is never closed');
}

describe('the mail layout', () => {
  it('puts the wordmark above the card, the art flush at its top, and the footer outside it', () => {
    const { html } = renderMail(SPEC);
    const card = cardOf(html);

    const wordmark = html.indexOf('https://dev.example/icon-192.png');
    expect(wordmark).toBeGreaterThan(-1);
    expect(wordmark).toBeLessThan(card.start);
    expect(html.slice(wordmark, card.start)).toContain('Token Circles');

    // The first row of the card is the art, in a cell with no padding, its top corners rounded
    // like the card's.
    const firstRow =
      /^<table[^>]*><tr><td style="padding:0;font-size:0;line-height:0"><img [^>]*>/.exec(
        card.inner
      );
    expect(firstRow, card.inner.slice(0, 300)).not.toBeNull();
    expect(firstRow![0]).toContain('banner-engraved-night-v1.jpg');
    expect(firstRow![0]).toContain('border-radius:18px 18px 0 0');

    const footer = html.indexOf('Your money, in clear orbit. Open source and local-first.');
    expect(footer).toBeGreaterThan(card.end);
    expect(html.indexOf(SPEC.reason)).toBeGreaterThan(card.end);
    expect(card.inner).not.toContain('Your money, in clear orbit.');
  });

  it('holds the headline, the paragraphs, the button, its notes and the aside inside the card, in that order', () => {
    const { inner } = cardOf(renderMail(SPEC).html);
    const order = [
      '<h1',
      'One headline.',
      'The first paragraph.',
      'The second paragraph.',
      '>Do the thing</a>',
      'A note under the button.',
      'If the button doesn&#39;t open, paste this into your browser:',
      'Below the rule.',
    ].map((part) => inner.indexOf(part));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // One headline.
    expect(inner.match(/<h1\b/g)).toHaveLength(1);
  });

  it('is dark by default, with every colour of the page, the card and the button also set as an attribute', () => {
    const { html } = renderMail(SPEC);
    expect(html).toContain('<meta name="color-scheme" content="dark light">');
    expect(html).toMatch(/<body class="tc-page" bgcolor="#0b1020" style="[^"]*background:#0b1020/);
    expect(html).toMatch(/<table [^>]*class="tc-page"[^>]*bgcolor="#0b1020"/);
    expect(html).toMatch(/<td class="tc-card" bgcolor="#151d31" style="background:#151d31/);
    expect(html).toMatch(/<td class="tc-btn-td" bgcolor="#6e9bff" style="background:#6e9bff/);
    expect(html).toContain('color:#eef2ff');
  });

  it('turns to paper in light mode through prefers-color-scheme', () => {
    const { html } = renderMail(SPEC);
    const light = /@media \(prefers-color-scheme: light\) \{([\s\S]*?)\n\}/.exec(html);
    expect(light).not.toBeNull();
    for (const rule of [
      '.tc-page { background:#eeeae1 !important; }',
      '.tc-card { background:#fbf9f4 !important; }',
      '.tc-text { color:#141b30 !important; }',
      '.tc-link { color:#2f5cc4 !important; }',
      '.tc-btn-td { background:#2f5cc4 !important; }',
      '.tc-btn { color:#ffffff !important; }',
    ]) {
      expect(light![1]).toContain(rule);
    }
  });

  it('sets every word in the system font stack, never a serif', () => {
    const { html } = renderMail(SPEC);
    expect(html).toContain(FONT);
    expect(html).not.toMatch(/Georgia|Times New Roman|[^-]serif/);
  });

  it('loads its art and the wordmark from the sending app, under names that never change', () => {
    const banner = renderMail(SPEC).html;
    expect(banner).toContain(
      '<img src="https://dev.example/email/banner-engraved-night-v1.jpg" width="600" height="180" alt=""'
    );
    const hero = renderMail({
      ...SPEC,
      art: 'hero',
      artHref: 'https://app.example/#dashboard',
    }).html;
    expect(hero).toContain(
      '<a href="https://app.example/#dashboard" style="display:block"><img src="https://dev.example/email/hero-engraved-night-v1.jpg" width="600" height="280" alt=""'
    );
    // The production app when the caller names no origin.
    expect(renderMail({ ...SPEC, assetOrigin: undefined }).html).toContain(
      'src="https://tokencircles.com/email/banner-engraved-night-v1.jpg"'
    );
  });

  it('escapes every word and link it is given', () => {
    const { html } = renderMail({
      ...SPEC,
      headline: 'A <script>headline</script>',
      paragraphs: [['To ', { strong: '<b>new</b>@example.com' }, '.']],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('A &lt;script&gt;headline&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;new&lt;/b&gt;@example.com</strong>');
    expect(html).toContain('href="https://app.example/#thing?a=1&amp;b=2"');
  });

  it('writes a text twin with the same words and links, and no markup', () => {
    const { text } = renderMail({
      ...SPEC,
      paragraphs: [['To ', { strong: 'new@example.com' }, ', today.'], 'The second paragraph.'],
    });
    for (const part of [
      'One headline.',
      'To new@example.com, today.',
      'The second paragraph.',
      `Do the thing: ${LINK}`,
      'A note under the button.',
      'Below the rule.',
      SPEC.reason,
      'https://tokencircles.com',
    ]) {
      expect(text).toContain(part);
    }
    expect(text).not.toMatch(/<[a-z/][^>]*>/i);
    expect(text).not.toContain('&#39;');
  });

  it('shows a code large and monospaced, right under the headline', () => {
    const { html, text } = renderMail({ ...SPEC, code: '123456' });
    const code = /<td class="tc-code"[^>]*>([\s\S]*?)<\/td>/.exec(html);
    expect(code).not.toBeNull();
    expect(code![1]).toContain('>123456<');
    expect(code![1]).toMatch(/font:700 3\dpx\/1(\.\d+)? ui-monospace,/);
    expect(html.indexOf('123456')).toBeGreaterThan(html.indexOf('One headline.'));
    expect(html.indexOf('123456')).toBeLessThan(html.indexOf('The first paragraph.'));
    expect(text).toContain('One headline.\n\n123456\n');
  });

  it('takes a second button, set apart from the first as the quieter one', () => {
    const { html, text } = renderMail({
      ...SPEC,
      buttons: [
        { label: 'Sign in', href: 'https://app.example/' },
        { label: 'Reset password', href: 'https://app.example/#reset' },
      ],
    });
    expect(html).toMatch(
      /<td class="tc-btn-td" bgcolor="#6e9bff"[^>]*><a class="tc-btn"[^>]*>Sign in<\/a>/
    );
    expect(html).toMatch(/<td class="tc-btn2-td"[^>]*><a class="tc-btn2"[^>]*>Reset password<\/a>/);
    expect(html).not.toMatch(/<td class="tc-btn2-td"[^>]*bgcolor/);
    expect(text).toContain(
      'Sign in: https://app.example/\nReset password: https://app.example/#reset'
    );
  });

  it('makes its button full width on a phone, and stacks a second one under the first', () => {
    const phone = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}/.exec(renderMail(SPEC).html);
    expect(phone).not.toBeNull();
    for (const rule of [
      '.tc-btn-table { width:100% !important; }',
      '.tc-btn-table td { display:block !important; width:auto !important; }',
      '.tc-btn-gap { height:10px !important; }',
      '.tc-btn, .tc-btn2 { display:block !important; text-align:center !important; }',
    ]) {
      expect(phone![1]).toContain(rule);
    }
    const two = renderMail({
      ...SPEC,
      buttons: [
        { label: 'Sign in', href: 'https://app.example/' },
        { label: 'Reset password', href: 'https://app.example/' },
      ],
    }).html;
    expect(two).toMatch(/<\/td><td class="tc-btn-gap"[^>]*>&nbsp;<\/td><td class="tc-btn2-td"/);
  });

  it('numbers its steps, each with its link', () => {
    const { html, text } = renderMail({
      ...SPEC,
      steps: {
        title: 'Where to go first',
        items: [
          { title: 'First', text: 'Do this first.', link: { label: 'Open A', href: 'https://a/' } },
          { title: 'Second', text: 'Then this.', link: { label: 'Open B', href: 'https://b/' } },
        ],
      },
    });
    expect(html).toMatch(/>1<\/td><td valign="top"><div class="tc-text"[^>]*>First<\/div>/);
    expect(html).toMatch(/>2<\/td><td valign="top"><div class="tc-text"[^>]*>Second<\/div>/);
    expect(html).toContain('>Open A →</a>');
    expect(text).toContain(
      'Where to go first\n\n1. First\nDo this first.\nOpen A: https://a/\n\n2. Second'
    );
  });

  it('weighs a few kilobytes, far under the 102 KB at which Gmail clips a mail', () => {
    const { html } = renderMail(SPEC);
    expect(new TextEncoder().encode(html).length).toBeLessThan(12 * 1024);
  });
});
