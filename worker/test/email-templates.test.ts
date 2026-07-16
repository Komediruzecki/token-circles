import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatMoney,
  renderAccountExists,
  renderBillsReminder,
  renderBudgetAlert,
  renderPasswordReset,
  renderSpendingReport,
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
  expect(mail.subject).toContain('Token Circles');
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
  it('welcome mail is branded, links the app, and mentions the orbit GIF', () => {
    const mail = renderWelcome({ appUrl: 'https://tokencircles.com' });
    expectBrandedShell(mail);
    expect(mail.html).toContain('email/orbit.gif');
    expect(mail.html).toContain('Open Token Circles');
    expect(mail.text).toContain("If you didn't create this account");
  });

  it('mail assets load from the sending environment origin, defaulting to prod', () => {
    const dev = renderWelcome({ appUrl: 'https://dev.tokencircles.com' });
    expect(dev.html).toContain('https://dev.tokencircles.com/email/orbit.gif');
    expect(dev.html).toContain('https://dev.tokencircles.com/icon-192.png');
    const fallback = renderTestBasic();
    expect(fallback.html).toContain('https://tokencircles.com/icon-192.png');
  });

  it('account-exists notice never includes the animated ornament (security notice tone)', () => {
    const mail = renderAccountExists({});
    expectBrandedShell(mail);
    expect(mail.html).not.toContain('email/orbit.gif');
  });

  it('password reset carries the link in html AND text, with ttl wording', () => {
    const mail = renderPasswordReset({ link: 'https://t.co/x?token=abc123', ttlHours: 2 });
    expectBrandedShell(mail);
    expect(mail.html).toContain('https://t.co/x?token=abc123');
    expect(mail.text).toContain('https://t.co/x?token=abc123');
    expect(mail.html).toContain('2 hours');
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

  it('test-basic and support-ack render branded', () => {
    expectBrandedShell(renderTestBasic());
    const ack = renderSupportAck({ ticketId: 'TC-1A2B3C' });
    expectBrandedShell(ack);
    expect(ack.html).toContain('TC-1A2B3C');
    expect(ack.subject).toContain('TC-1A2B3C');
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
