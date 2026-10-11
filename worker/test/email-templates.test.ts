import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatMoney,
  renderAccountExists,
  renderBillsReminder,
  renderBudgetAlert,
  renderEmailChange,
  renderEmailChangeNotice,
  renderLoginCode,
  renderPasswordReset,
  renderPaymentActionRequired,
  renderSpendingReport,
  renderSubscriptionEnded,
  renderSupportAck,
  renderTestBasic,
  renderWelcome,
} from '../src/emailTemplates';

const FOOTER_LINKS = [
  'https://tokencircles.com',
  'https://about.tokencircles.com',
  'https://github.com/Komediruzecki/token-circles',
  'https://about.tokencircles.com/terms',
  'https://about.tokencircles.com/privacy',
  'mailto:hello@tokencircles.com',
];

/** Every mail must carry the branded shell: dark scheme, logo, footer links, text twin. */
function expectBrandedShell(mail: { subject: string; html: string; text: string }) {
  // The wordmark. A subject need not say Token Circles: the From name does.
  expect(mail.html).toContain('Token Circles');
  expect(mail.html).toContain('color-scheme');
  expect(mail.html).toContain('icon-192.png');
  for (const link of FOOTER_LINKS) expect(mail.html).toContain(link);
  expect(mail.text.length).toBeGreaterThan(80);
  expect(mail.text).toContain('https://tokencircles.com');
  // No unescaped template debris
  expect(mail.html).not.toContain('undefined');
  expect(mail.html).not.toContain('[object Object]');
}

describe('email templates', () => {
  it('welcome mail is branded, tops the card with the engraved art, and links the pages its steps name', () => {
    const mail = renderWelcome({ appUrl: 'https://tokencircles.com' });
    expectBrandedShell(mail);
    expect(mail.html).toContain('email/hero-engraved-night-v1.jpg');
    expect(mail.html).not.toContain('email/orbit.gif');
    for (const page of ['import', 'bills', 'progress']) {
      expect(mail.html).toContain(`href="https://tokencircles.com/#${page}"`);
    }
    expect(mail.text).toContain("Questions, or a bank file that won't import? Reply to this mail.");
  });

  it('mail assets load from the sending environment origin, defaulting to prod', () => {
    const dev = renderWelcome({ appUrl: 'https://dev.tokencircles.com' });
    expect(dev.html).toContain('https://dev.tokencircles.com/email/hero-engraved-night-v1.jpg');
    expect(dev.html).toContain('https://dev.tokencircles.com/icon-192.png');
    const fallback = renderTestBasic();
    expect(fallback.html).toContain('https://tokencircles.com/icon-192.png');
  });

  it('account-exists notice never includes the animated ornament (security notice tone)', () => {
    const mail = renderAccountExists({});
    expectBrandedShell(mail);
    expect(mail.html).not.toContain('email/orbit.gif');
  });

  it('account-exists notice offers Sign in, and Reset password as the quieter second button', () => {
    const mail = renderAccountExists({ appUrl: 'https://tokencircles.com' });
    expect(mail.html).toMatch(
      /<a class="tc-btn" href="https:\/\/tokencircles\.com"[^>]*>Sign in<\/a>/
    );
    // Reset password opens the sign-in screen on the form that sends a reset link
    // (#forgot-password in frontend/src/components/LoginScreen.tsx).
    expect(mail.html).toMatch(
      /<a class="tc-btn2" href="https:\/\/tokencircles\.com\/#forgot-password"[^>]*>Reset password<\/a>/
    );
    expect(mail.text).toContain(
      'Sign in: https://tokencircles.com\nReset password: https://tokencircles.com/#forgot-password'
    );
  });

  it('password reset carries the link in html AND text, with ttl wording', () => {
    const mail = renderPasswordReset({ link: 'https://t.co/x?token=abc123', ttlHours: 2 });
    expectBrandedShell(mail);
    expect(mail.html).toContain('https://t.co/x?token=abc123');
    expect(mail.text).toContain('Reset password: https://t.co/x?token=abc123');
    expect(mail.html).toContain('The link works once, for 2&nbsp;hours.');
    expect(mail.text).toContain(
      "Didn't ask for a reset? Ignore this mail. Your password stays as it is."
    );
  });

  it('sign-in code puts the code first in the subject, and large and monospaced in the mail', () => {
    const mail = renderLoginCode({ code: '482913', ttlMinutes: 10 });
    expectBrandedShell(mail);
    expect(mail.subject).toBe('482913 is your Token Circles sign-in code');
    expect(mail.html).toMatch(
      /<td class="tc-code"[^>]*><span class="tc-text" style="font:700 36px\/1\.2 ui-monospace,[^"]*">482913<\/span>/
    );
    expect(mail.text).toContain('482913');
    expect(mail.text).toContain('It works once, for 10 minutes.');
  });

  it('email change carries its link in html AND text, says when it expires and that nothing changes until then', () => {
    const link = 'https://api.x/api/auth/verify-email?token=abc123&returnTo=https%3A%2F%2Fapp.x';
    const mail = renderEmailChange({ link, ttlHours: 24 });
    expectBrandedShell(mail);
    expect(mail.subject).toMatch(/confirm your new/i);
    expect(mail.html).toContain(`href="${link.replaceAll('&', '&amp;')}"`);
    expect(mail.text).toContain(link);
    expect(mail.html).toContain('The link works once, for 24&nbsp;hours.');
    expect(mail.text).toContain('nothing changes');
    expect(mail.html).not.toContain('email/orbit.gif');
  });

  it('email change says a sign-in finishes it, with the address the account signs in with now', () => {
    const link = 'https://api.example.com/verify';
    const mail = renderEmailChange({ link, ttlHours: 24 });
    const signIn =
      "If you're asked to sign in first, use the address you sign in with now. The change is made as soon as you do. Until then, nothing changes.";
    expect(mail.html).toContain(signIn.replaceAll("'", '&#39;'));
    expect(mail.text).toContain(`${signIn}\n\nConfirm my new email: ${link}`);
  });

  it('email change link says only what is true for every account, Google ones included', () => {
    const mail = renderEmailChange({ link: 'https://api.example.com/verify', ttlHours: 24 });
    expect(mail.html).not.toMatch(/sign in with it/i);
    expect(mail.text).not.toMatch(/sign in with it/i);
    expect(mail.html).toContain('From then on, mail about your account comes here.');
    expect(mail.text).toContain('From then on, mail about your account comes here.');
  });

  it('email change notice names the new address, points at Settings, and carries no confirm link', () => {
    const mail = renderEmailChangeNotice({
      newEmail: 'new@example.com',
      appUrl: 'https://tokencircles.com',
    });
    expectBrandedShell(mail);
    expect(mail.html).toContain('new@example.com');
    expect(mail.text).toContain('new@example.com');
    expect(mail.html).toContain('https://tokencircles.com/#settings');
    expect(mail.html).not.toContain('verify-email');
    expect(mail.html).not.toContain('email/orbit.gif');
  });

  it('email change notice can leave the new address out', () => {
    const mail = renderEmailChangeNotice({ newEmail: null, appUrl: 'https://tokencircles.com' });
    expectBrandedShell(mail);
    expect(mail.text).toContain(
      'asked to change its email address, and nothing changes unless the new address confirms it'
    );
    expect(mail.html).not.toContain('@example.com');
    expect(mail.text).not.toContain('@example.com');
    expect(mail.html).not.toContain('null');
    expect(mail.text).not.toContain('null');
    expect(mail.html).toContain('https://tokencircles.com/#settings');
  });

  it('budget alert renders rows with the profile currency and escapes names', () => {
    const mail = renderBudgetAlert({
      alerts: [
        {
          categoryName: 'Groceries <script>',
          categoryColor: '#22c55e',
          budgetAmount: 400,
          spent: 431.5,
          percentage: 108,
          status: 'over',
        },
      ],
      currency: 'EUR',
      unsubUrl: 'https://api.x/unsub?token=t1',
    });
    expect(mail).not.toBeNull();
    expectBrandedShell(mail!);
    expect(mail!.html).toContain('€431.50');
    expect(mail!.html).toContain('Groceries &lt;script&gt;');
    expect(mail!.html).not.toContain('<script>');
    expect(mail!.html).toContain('https://api.x/unsub?token=t1');
    expect(mail!.text).toContain('Unsubscribe: https://api.x/unsub?token=t1');
  });

  it('budget alert returns null with no alerts', () => {
    expect(renderBudgetAlert({ alerts: [] })).toBeNull();
  });

  it('spending report shows income/expenses/net in currency and returns null when empty', () => {
    const report = {
      totalIncome: 2000,
      totalExpenses: 1500.25,
      netBalance: 499.75,
      categoryBreakdown: [{ name: 'Rent', color: '#f59e0b', total: 950 }],
      transactionCount: 42,
      startDate: '2026-06-16',
      endDate: '2026-07-16',
    };
    const mail = renderSpendingReport({ report, currency: 'USD' });
    expect(mail).not.toBeNull();
    expectBrandedShell(mail!);
    expect(mail!.html).toContain('$2,000.00');
    expect(mail!.html).toContain('$1,500.25');
    expect(mail!.html).toContain('42 transactions');
    expect(renderSpendingReport({ report: { ...report, transactionCount: 0 } })).toBeNull();
  });

  it('bills reminder labels due timing and returns null with no bills', () => {
    const mail = renderBillsReminder({
      bills: [
        { name: 'Rent', amount: 950, due_date: '2026-07-16', daysUntilDue: 0, overdue: false },
        { name: 'Netflix', amount: 13.99, due_date: '2026-07-14', daysUntilDue: -2, overdue: true },
        { name: 'Gym', amount: 29.99, due_date: '2026-07-20', daysUntilDue: 4, overdue: false },
      ],
      currency: 'EUR',
    });
    expect(mail).not.toBeNull();
    expectBrandedShell(mail!);
    expect(mail!.html).toContain('Due today');
    expect(mail!.html).toContain('Overdue');
    expect(mail!.html).toContain('In 4 days');
    expect(mail!.html).toContain('€13.99');
    expect(renderBillsReminder({ bills: [] })).toBeNull();
  });

  it('email change notice says what was asked in one sentence, and the one thing to do', () => {
    const mail = renderEmailChangeNotice({
      newEmail: 'new@example.com',
      appUrl: 'https://tokencircles.com',
    });
    const paragraphs = [...mail.html.matchAll(/<p class="tc-soft"[^>]*>(.*?)<\/p>/g)].map(
      (m) => m[1]
    );
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toContain('asked to change its email to');
    expect(paragraphs[0]).toContain('new@example.com</strong>');
    expect(paragraphs[0]!.match(/\. |\.$/g)).toHaveLength(1);
    expect(paragraphs[1]).toContain('open Settings, cancel the change');
    expect([...mail.html.matchAll(/class="tc-btn2?"/g)]).toHaveLength(1);
  });

  it('test-basic and support-ack render branded', () => {
    expectBrandedShell(renderTestBasic());
    const ack = renderSupportAck({ ticketId: 'TC-1A2B3C' });
    expectBrandedShell(ack);
    expect(ack.html).toContain('TC-1A2B3C');
    expect(ack.subject).toBe('We got your message (TC-1A2B3C)');
  });

  it('test mail says delivery works, and never that the reminders look like it', () => {
    // The reminders keep the first shell (maff's call of 2026-10-11), so they do not.
    const mail = renderTestBasic();
    expect(mail.subject).toBe('Test mail from Token Circles');
    for (const part of [mail.html, mail.text]) expect(part).not.toMatch(/look like this/i);
    expect(mail.text).toContain('mail from Token Circles reaches this address');
  });

  it('subjects mark test previews', () => {
    const mail = renderBudgetAlert({
      alerts: [
        {
          categoryName: 'Dining',
          categoryColor: '#f59e0b',
          budgetAmount: 100,
          spent: 90,
          percentage: 90,
          status: 'warning',
        },
      ],
      test: true,
      periodLabel: 'July 2026',
    });
    expect(mail!.subject).toContain('[Test]');
    expect(mail!.subject).toContain('July 2026');
  });

  it('formatMoney tolerates junk currencies and escapeHtml covers quotes', () => {
    expect(formatMoney(10, 'EUR')).toBe('€10.00');
    expect(formatMoney(10, 'NOPE!')).toContain('10.00');
    expect(escapeHtml(`<a "b" 'c'>`)).toBe('&lt;a &quot;b&quot; &#39;c&#39;&gt;');
  });
});

describe('the billing mails that show no amount', () => {
  // On the mail layout since 2026-10-11, with every fact of their first-shell version kept. The
  // failed payment shows the amount due, so it stays on the first shell word for word, with the
  // reminders (mail-catalogue.test.ts).
  const APP = 'https://tokencircles.com';

  it("asks for the bank's confirmation on the layout, as a step to take and not a failure", () => {
    const mail = renderPaymentActionRequired({
      planName: 'Basic',
      payUrl: 'https://invoice.stripe.com/i/EXAMPLE',
      appUrl: APP,
    });
    expectBrandedShell(mail);
    expect(mail.html).toContain('<td class="tc-card"');
    expect(mail.subject).toBe('Your bank needs you to confirm a Token Circles payment');
    for (const words of [
      'Your bank wants you to confirm the payment for Token Circles Basic before it goes through.',
      "It's the usual card verification, not a problem with your card.",
      'Confirm the payment: https://invoice.stripe.com/i/EXAMPLE',
      "Your plan stays active while this is outstanding. If it isn't confirmed, the payment is treated as failed and we retry it.",
    ]) {
      expect(mail.text).toContain(words);
    }
    expect(mail.html).toMatch(
      /<a class="tc-btn" href="https:\/\/invoice\.stripe\.com\/i\/EXAMPLE"[^>]*>Confirm the payment<\/a>/
    );
    // Without Stripe's page, the button opens Settings.
    expect(renderPaymentActionRequired({ planName: 'Basic', appUrl: APP }).text).toContain(
      `Confirm the payment: ${APP}/#settings`
    );
  });

  it('says on the layout that a plan ended: on Free, nothing deleted, and how to pick it back up', () => {
    const mail = renderSubscriptionEnded({ planName: 'Basic', appUrl: APP });
    expectBrandedShell(mail);
    expect(mail.html).toContain('<td class="tc-card"');
    expect(mail.subject).toBe('Your Token Circles Basic plan has ended');
    for (const words of [
      'Your Token Circles Basic plan has ended, and your account is on Free now.',
      'Nothing has been deleted: you can open everything, and export all of it from Settings at any time.',
      'Choosing a plan again brings the paid features back straight away, with nothing to restore or re-import.',
      "If you didn't mean to end it (a card that expired, say), choosing the plan again is all it takes.",
      `Open Settings: ${APP}/#settings`,
    ]) {
      expect(mail.text).toContain(words);
    }
  });
});
