/**
 * Every mail Token Circles sends, held to the same rules through the sample catalogue
 * (worker/scripts/mail-samples.ts), which has a sample of every renderer in emailTemplates.ts.
 *
 * Every one is on the mail layout of 2026-10-11. The four mails that show an amount of money (the
 * budget alert, the spending report, upcoming bills and the failed payment) kept the first shell
 * until maff's call of 2026-10-29 moved them too, with every amount kept.
 */
import { describe, expect, it } from 'vitest';
import * as templates from '../src/emailTemplates';
import { mailSamples } from '../scripts/mail-samples';
import { amountMailDigests, amountMailGrid } from './helpers/amount-mail-grid';

const samples = mailSamples();

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
        "bills-reminder": "2 bills due within a week",
        "budget-alert": "Budget alert for November 2026: Sample groceries went over",
        "confirm-email-fresh-link": "Your new confirm link for Token Circles",
        "email-change": "Confirm your new email for Token Circles",
        "email-change-notice": "Someone asked to change your Token Circles email",
        "email-change-notice-unnamed": "Someone asked to change your Token Circles email",
        "login-code": "123456 is your Token Circles sign-in code",
        "password-reset": "Reset your Token Circles password",
        "payment-action-required": "Your bank needs you to confirm a Token Circles payment",
        "payment-failed": "Your Token Circles payment didn't go through",
        "spending-report": "Your spending report for October 2026, first half",
        "subscription-ended": "Your Token Circles Basic plan has ended",
        "support-ack": "We got your message (TC-SAMPLE)",
        "test-basic": "Test mail from Token Circles",
        "welcome": "Token Circles is ready for your first statement",
        "welcome-confirm": "Welcome to Token Circles: confirm your email",
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
    for (const sample of samples) {
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

  it('keeps the last two words of every headline on the layout on one line', () => {
    // On a phone, "One link, one sign-in, and you're in." left "in." alone on the last line.
    for (const sample of samples) {
      const headline = sample.render().html.match(/<h1 [^>]*>(.*?)<\/h1>/)![1]!;
      expect(headline, sample.name).toMatch(/&nbsp;\S+$/);
    }
  });

  it('never puts a number on one line and its unit on the next, in a mail on the layout', () => {
    // At 600 px the sign-in code mail read "It works once, for 10" with "minutes." below.
    for (const sample of samples) {
      const card = cardOf(sample.render().html);
      expect(card, sample.name).not.toMatch(/\d (?:minutes?|hours?|days?)\b/);
    }
  });

  it('keeps the contact address on the line of the dot before it, in every footer on the layout', () => {
    // On a phone the copyright line ended in a stray dot, with the address alone below it.
    for (const sample of samples) {
      expect(sample.render().html, sample.name).toContain(
        'AGPL-3.0 &middot;&nbsp;<a class="tc-muted" href="mailto:hello@tokencircles.com"'
      );
    }
  });

  it('gives the text twin every fact of the footer: its line, its links and the address', () => {
    const line = 'Your money, in clear orbit. Open source and local-first.';
    for (const sample of samples) {
      const { html, text } = sample.render();
      expect(text, sample.name).toContain(line);
      const footer = html.slice(html.indexOf(line));
      // An href holds & as &amp;, should a link carry two query parameters.
      const links = [...footer.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) =>
        m[1]!.replace(/^mailto:/, '').replaceAll('&amp;', '&')
      );
      expect(links.length, sample.name).toBeGreaterThan(5);
      for (const link of links) expect(text, `${sample.name}: ${link}`).toContain(link);
    }
  });

  it('starts the text twin with the eyebrow, where a mail on the layout has one', () => {
    const eyebrowOf = (html: string) =>
      html
        .match(/<div class="tc-link"[^>]*>([^<]+)<\/div>/)?.[1]
        ?.replaceAll('&#39;', "'")
        .replaceAll('&amp;', '&');
    const withOne = samples.filter((sample) => eyebrowOf(sample.render().html));
    expect(withOne.length).toBeGreaterThan(0);
    for (const sample of withOne) {
      const { html, text } = sample.render();
      expect(text.startsWith(`${eyebrowOf(html)}\n`), sample.name).toBe(true);
    }
  });

  it('words no subject or body of any mail with an em dash', () => {
    for (const sample of samples) {
      const { subject, html, text } = sample.render();
      for (const part of [subject, html, text]) expect(part, sample.name).not.toContain('—');
    }
  });

  it('puts every mail on the layout, with its art, and no mail on it carries the orbit GIF', () => {
    for (const sample of samples) {
      const { html } = sample.render();
      expect(html, sample.name).toContain('<td class="tc-card"');
      expect(html, sample.name).toMatch(/\/email\/(?:hero|banner)-engraved-night-v1\.jpg/);
      expect(html, sample.name).not.toContain('orbit.gif');
    }
  });

  it('puts every branch of the four mails that show an amount on the layout, every amount in both parts', () => {
    // The grid of test/helpers/amount-mail-grid.ts, input by input: each mail it renders is on the
    // layout with its art, carries no orbit GIF and no em dash in its subject, HTML or text, and
    // shows every amount its input holds, formatted for its currency, in the HTML and in the text.
    const amountsOf: Record<string, (input: any) => Array<[number, string | null | undefined]>> = {
      renderBudgetAlert: (i) =>
        i.alerts.flatMap((a: any) => [
          [a.budgetAmount, i.currency],
          [a.spent, i.currency],
        ]),
      renderBillsReminder: (i) => i.bills.map((b: any) => [b.amount, i.currency]),
      renderSpendingReport: (i) => [
        [i.report.totalIncome, i.currency],
        [i.report.totalExpenses, i.currency],
        [i.report.netBalance, i.currency],
        ...i.report.categoryBreakdown.map((c: any) => [c.total, i.currency]),
      ],
      renderPaymentFailed: (i) =>
        typeof i.amountDue === 'number' && i.amountDue > 0 ? [[i.amountDue, i.currency]] : [],
    };
    let mails = 0;
    for (const [name, inputs] of Object.entries(amountMailGrid())) {
      const render = (templates as unknown as Record<string, (input: unknown) => unknown>)[name]!;
      for (const input of inputs) {
        const mail = render(input) as { subject: string; html: string; text: string } | null;
        if (!mail) continue;
        mails += 1;
        const label = `${name} ${JSON.stringify(input)}`;
        expect(mail.html, label).toContain('<td class="tc-card"');
        expect(mail.html, label).toContain('/email/banner-engraved-night-v1.jpg');
        for (const part of [mail.subject, mail.html, mail.text]) {
          expect(part, label).not.toContain('—');
          expect(part, label).not.toContain('orbit.gif');
        }
        for (const [amount, currency] of amountsOf[name]!(input)) {
          const money = templates.formatMoney(amount, currency);
          expect(mail.html, `${label}: ${money}`).toContain(money);
          expect(mail.text, `${label}: ${money}`).toContain(money);
        }
      }
    }
    // Every input but the ones that render no mail (no alerts, no bills, no transactions).
    expect(mails).toBe(144 + 96 + 96 + 128);
  });

  it('pins every branch of the four mails that show an amount to the output maff reviewed', async () => {
    // A grid of inputs over each renderer's branches (test/helpers/amount-mail-grid.ts): the
    // budget alert over budget, approaching it and both; bills due today, tomorrow, in a few days,
    // overdue alone and with others, with and without a due date; the spending report with and
    // without categories, a negative net, and no transactions; the failed payment with and without
    // an amount and a retry date; each with and without its optional fields. Until 2026-10-29 these
    // digests held the four on the first shell, word for word. maff's call of 2026-10-29 moved them
    // to the layout with their amounts kept, so the digests were taken again on purpose from the
    // renderers of that change, over the same 584 inputs, under plain Node (Node strips the types):
    //   const templates = await import('<worktree>/worker/src/emailTemplates.ts');
    //   const { amountMailDigests } = await import('<worktree>/worker/test/helpers/amount-mail-grid.ts');
    //   console.log(await amountMailDigests(templates));
    // The same lines against `git show c010b74c:worker/src/emailTemplates.ts` give the digests the
    // first shell was pinned to, so the method is the one those were taken with. A change to any of
    // the four shows here, and is taken again only on purpose. The input counts guard the grid.
    expect(await amountMailDigests(templates)).toEqual({
      renderBudgetAlert: {
        inputs: 192,
        digest: '19a9c71789cd92459985cd9f4c50f39bf4972e339056394ab9bec2810fb4d3fd',
      },
      renderBillsReminder: {
        inputs: 120,
        digest: '0701d570920a07fd2f3a5867b503567110dd3f64d7ec398a26a27c065196a5a8',
      },
      renderSpendingReport: {
        inputs: 144,
        digest: '12df033e32a0cb08018e1bd050ac0d4d687ec124a9860f59a91ca52b5b691571',
      },
      renderPaymentFailed: {
        inputs: 128,
        digest: 'cd34d4bf087425b3ee3727023c63152224ff2450a9a21f702cc447fd9180cd98',
      },
    });
  });
});
