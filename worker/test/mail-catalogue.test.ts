/**
 * Every mail Token Circles sends, held to the same rules through the sample catalogue
 * (worker/scripts/mail-samples.ts), which has a sample of every renderer in emailTemplates.ts.
 *
 * Two layouts: the mail layout of 2026-10-11, which the sign-up, account and billing mails are on,
 * and the first shell, which the four mails that show an amount of money keep word for word
 * (maff's call of 2026-10-11). The rules for wording are for the first kind; the second kind is
 * pinned as it is.
 */
import { describe, expect, it } from 'vitest';
import * as templates from '../src/emailTemplates';
import { mailSamples } from '../scripts/mail-samples';

const samples = mailSamples();
const onTheLayout = samples.filter((sample) => sample.layout === 'mail');
const onTheFirstShell = samples.filter((sample) => sample.layout === 'first');

/** Gmail clips a mail whose HTML is past 102 KB, and hides the rest behind a link. */
const GMAIL_CLIPS_AT = 102 * 1024;

/** Every renderer emailTemplates.ts exports: every render* but the layout itself. */
const RENDERERS = Object.keys(templates).filter(
  (name) => name.startsWith('render') && name !== 'renderMail'
);

/** The card of a mail on the layout: from the card to the footer that follows it. */
const cardOf = (html: string) =>
  html.slice(
    html.indexOf('class="tc-card"'),
    html.indexOf('Your money, in clear orbit. Open source and local-first.')
  );

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('the mail catalogue', () => {
  it('has a sample of every mail the Worker can send, each under its own name', () => {
    expect(new Set(samples.map((sample) => sample.template))).toEqual(new Set(RENDERERS));
    const names = samples.map((sample) => sample.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every mail the subject this snapshot holds', () => {
    expect(Object.fromEntries(samples.map((sample) => [sample.name, sample.render().subject])))
      .toMatchInlineSnapshot(`
      {
        "account-exists": "You already have a Token Circles account",
        "bills-reminder": "Upcoming bills — Token Circles",
        "budget-alert": "Budget alert (November 2026) — Token Circles",
        "confirm-email": "Confirm your email for Token Circles",
        "confirm-email-fresh-link": "Your new confirm link for Token Circles",
        "email-change": "Confirm your new email for Token Circles",
        "email-change-notice": "Someone asked to change your Token Circles email",
        "email-change-notice-unnamed": "Someone asked to change your Token Circles email",
        "login-code": "123456 is your Token Circles sign-in code",
        "password-reset": "Reset your Token Circles password",
        "payment-action-required": "Your bank needs you to confirm a Token Circles payment",
        "payment-failed": "Your Token Circles payment didn't go through",
        "spending-report": "Your spending report (October 2026, first half) — Token Circles",
        "subscription-ended": "Your Token Circles Basic plan has ended",
        "support-ack": "We got your message (TC-SAMPLE)",
        "test-basic": "Test mail from Token Circles",
        "welcome": "Token Circles is ready for your first statement",
      }
    `);
  });

  it('keeps every mail under the 102 KB at which Gmail clips one', () => {
    for (const sample of samples) {
      const bytes = new TextEncoder().encode(sample.render().html).length;
      expect(bytes, sample.name).toBeLessThan(GMAIL_CLIPS_AT);
    }
  });

  it('gives every HTML mail a plain-text twin, with no markup in it', () => {
    for (const sample of samples) {
      const { html, text } = sample.render();
      expect(html, sample.name).toMatch(/^<!doctype html>/i);
      expect(text.trim().length, sample.name).toBeGreaterThan(100);
      expect(text, sample.name).not.toMatch(/<\/?[a-z][^>]*>/i);
      expect(text, sample.name).not.toMatch(/&(?:#\d+|amp|lt|gt|quot|nbsp);/);
    }
  });

  it('puts every link in the card of a mail on the layout in its text twin as well', () => {
    for (const sample of onTheLayout) {
      const { html, text } = sample.render();
      const card = cardOf(html);
      const art = new Set(
        [...card.matchAll(/<a href="([^"]+)" style="display:block"><img /g)].map((m) => m[1])
      );
      const links = [...card.matchAll(/<a [^>]*href="([^"]+)"/g)]
        .map((m) => m[1]!)
        .filter((href) => !art.has(href))
        .map((href) => href.replaceAll('&amp;', '&'));
      for (const link of links) expect(text, `${sample.name}: ${link}`).toContain(link);
    }
  });

  it('words no subject or body of the mails on the layout with an em dash', () => {
    // The mails on the first shell are left out on purpose: they show an amount of money and stay
    // exactly as they are, em dashes included. maff's call of 2026-10-11.
    expect(onTheLayout.length).toBeGreaterThan(0);
    for (const sample of onTheLayout) {
      const { subject, html, text } = sample.render();
      for (const part of [subject, html, text]) expect(part, sample.name).not.toContain('—');
    }
  });

  it('puts every mail on the layout, with its art, and no mail on it carries the orbit GIF', () => {
    for (const sample of onTheLayout) {
      const { html } = sample.render();
      expect(html, sample.name).toContain('<td class="tc-card"');
      expect(html, sample.name).toMatch(/\/email\/(?:hero|banner)-engraved-night-v1\.jpg/);
      expect(html, sample.name).not.toContain('orbit.gif');
    }
  });

  it('leaves the mails on the first shell exactly as they were, word for word', async () => {
    // maff's call of 2026-10-11: the mails that show an amount of money do not move to the new
    // layout and keep their subjects and words. Each digest is of the subject, HTML and text the
    // sample renders, taken from the templates before this change (the year in the footer read
    // as YYYY, so the pin does not expire with the calendar).
    const digests: Record<string, string> = {};
    for (const sample of onTheFirstShell) {
      const { subject, html, text } = sample.render();
      const year = String(new Date().getUTCFullYear());
      digests[sample.name] = await sha256(
        [subject, html, text].join('\n').replaceAll(`&copy; ${year}`, '&copy; YYYY')
      );
    }
    expect(digests).toEqual({
      'payment-failed': '64cc883dff74be0f7fedbe8bde3cddf908612d2c190a0319be218d4d4606fa06',
      'budget-alert': '69888cd8d58f671db940b542e0e0991b276b9e654e02f6b25c1212b0a4a85aaf',
      'spending-report': '1426e75dc8b8cfc4ab22e27acf0c8777aa68c9a0db232c015d798d580c6a8ba6',
      'bills-reminder': '560c2df9b752fd8249f31246b7ef2bb20550dfeb2e85147ce46a4474bfe1fd90',
    });
  });
});
