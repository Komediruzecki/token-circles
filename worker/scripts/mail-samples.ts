/**
 * Every mail Token Circles sends, rendered with sample data that is plainly not real: example.com
 * addresses, EXAMPLE-ONLY tokens, a TC-SAMPLE reference and round made-up amounts.
 *
 * worker/test/mail-catalogue.test.ts holds every mail to the same rules through this list, and
 * checks that every renderer in emailTemplates.ts is on it. send-sample-mails.ts mails the list to
 * a test inbox.
 *
 * It imports emailTemplates.ts by file name, with the extension, so plain Node (type stripping)
 * can load it as well as the Worker's tests.
 */
import {
  renderAccountExists,
  renderBillsReminder,
  renderBudgetAlert,
  renderConfirmEmail,
  renderEmailChange,
  renderEmailChangeNotice,
  renderEmailVerification,
  renderLoginCode,
  renderPasswordReset,
  renderPaymentActionRequired,
  renderPaymentFailed,
  renderSpendingReport,
  renderSubscriptionEnded,
  renderSupportAck,
  renderTestBasic,
  renderWeekOneDay2,
  renderWeekOneDay7,
  renderWelcome,
  type RenderedEmail,
} from '../src/emailTemplates.ts';

export interface MailSample {
  /** A name for the line and the file a sample gets: its template, and which case of it. */
  name: string;
  /** The renderer that makes it. */
  template: string;
  render: () => RenderedEmail;
}

export interface SampleOptions {
  /** The app the mails link into. */
  appUrl?: string;
  /** The about site the footers and the articles link to; production's when left out. */
  aboutUrl?: string;
  /** The API the sample links (confirm, unsubscribe) go through. */
  apiUrl?: string;
  /** Where the mails load the wordmark and the art from. */
  assetOrigin?: string;
}

/** The amount mails render nothing without data; the samples always have some. */
function rendered(mail: RenderedEmail | null, template: string): RenderedEmail {
  if (!mail) throw new Error(`${template} rendered nothing from its sample`);
  return mail;
}

export function mailSamples(opts: SampleOptions = {}): MailSample[] {
  const appUrl = opts.appUrl ?? 'https://tokencircles.com';
  const assetOrigin = opts.assetOrigin ?? appUrl;
  const origins = { appUrl, aboutUrl: opts.aboutUrl, assetOrigin };
  const api = opts.apiUrl ?? 'https://api.tokencircles.com';
  /** A sample link, to an address that answers nothing. */
  const sampleLink = (path: string) => `${api}${path}?token=EXAMPLE-ONLY`;
  const unsubUrl = sampleLink('/api/notifications/unsubscribe');
  const weekOneUnsubUrl = `${unsubUrl}&list=week-one`;
  return [
    {
      name: 'confirm-email',
      template: 'renderConfirmEmail',
      render: () =>
        renderConfirmEmail({
          link: sampleLink('/api/auth/verify-email'),
          ttlHours: 24,
          ...origins,
        }),
    },
    {
      name: 'confirm-email-fresh-link',
      template: 'renderEmailVerification',
      render: () =>
        renderEmailVerification({
          link: sampleLink('/api/auth/verify-email'),
          ttlHours: 24,
          ...origins,
        }),
    },
    {
      name: 'welcome',
      template: 'renderWelcome',
      render: () => renderWelcome(origins),
    },
    {
      name: 'email-change',
      template: 'renderEmailChange',
      render: () =>
        renderEmailChange({
          link: sampleLink('/api/auth/verify-email'),
          ttlHours: 24,
          ...origins,
        }),
    },
    {
      name: 'email-change-notice',
      template: 'renderEmailChangeNotice',
      render: () => renderEmailChangeNotice({ newEmail: 'new.address@example.com', ...origins }),
    },
    {
      name: 'email-change-notice-unnamed',
      template: 'renderEmailChangeNotice',
      render: () => renderEmailChangeNotice({ newEmail: null, ...origins }),
    },
    {
      name: 'account-exists',
      template: 'renderAccountExists',
      render: () => renderAccountExists(origins),
    },
    {
      name: 'password-reset',
      template: 'renderPasswordReset',
      render: () =>
        renderPasswordReset({
          link: `${appUrl}/#reset-password?token=EXAMPLE-ONLY`,
          ttlHours: 2,
          ...origins,
        }),
    },
    {
      name: 'login-code',
      template: 'renderLoginCode',
      render: () => renderLoginCode({ code: '123456', ttlMinutes: 10, ...origins }),
    },
    {
      name: 'test-basic',
      template: 'renderTestBasic',
      render: () => renderTestBasic(origins),
    },
    {
      name: 'support-ack',
      template: 'renderSupportAck',
      render: () => renderSupportAck({ ticketId: 'TC-SAMPLE', ...origins }),
    },
    {
      name: 'payment-failed',
      template: 'renderPaymentFailed',
      render: () =>
        renderPaymentFailed({
          planName: 'Basic',
          amountDue: 4,
          currency: 'EUR',
          nextAttempt: new Date('2026-11-04T00:00:00Z'),
          ...origins,
        }),
    },
    {
      name: 'payment-action-required',
      template: 'renderPaymentActionRequired',
      render: () => renderPaymentActionRequired({ planName: 'Basic', ...origins }),
    },
    {
      name: 'subscription-ended',
      template: 'renderSubscriptionEnded',
      render: () => renderSubscriptionEnded({ planName: 'Basic', ...origins }),
    },
    {
      name: 'budget-alert',
      template: 'renderBudgetAlert',
      render: () =>
        rendered(
          renderBudgetAlert({
            alerts: [
              {
                categoryName: 'Sample groceries',
                categoryColor: '#22c55e',
                budgetAmount: 400,
                spent: 440,
                percentage: 110,
                status: 'over',
              },
              {
                categoryName: 'Sample dining out',
                categoryColor: '#f59e0b',
                budgetAmount: 100,
                spent: 90,
                percentage: 90,
                status: 'warning',
              },
            ],
            currency: 'EUR',
            unsubUrl,
            periodLabel: 'November 2026',
            ...origins,
          }),
          'renderBudgetAlert'
        ),
    },
    {
      name: 'spending-report',
      template: 'renderSpendingReport',
      render: () =>
        rendered(
          renderSpendingReport({
            report: {
              totalIncome: 2000,
              totalExpenses: 1500,
              netBalance: 500,
              categoryBreakdown: [
                { name: 'Sample rent', color: '#6e9bff', total: 900 },
                { name: 'Sample groceries', color: '#22c55e', total: 400 },
              ],
              transactionCount: 40,
              startDate: '2026-10-01',
              endDate: '2026-10-15',
            },
            currency: 'EUR',
            unsubUrl,
            periodLabel: 'October 2026, first half',
            ...origins,
          }),
          'renderSpendingReport'
        ),
    },
    {
      name: 'bills-reminder',
      template: 'renderBillsReminder',
      render: () =>
        rendered(
          renderBillsReminder({
            bills: [
              {
                name: 'Sample rent',
                amount: 900,
                due_date: '2026-11-01',
                daysUntilDue: 0,
                overdue: false,
              },
              {
                name: 'Sample streaming',
                amount: 10,
                due_date: '2026-11-04',
                daysUntilDue: 3,
                overdue: false,
              },
            ],
            currency: 'EUR',
            unsubUrl,
            ...origins,
          }),
          'renderBillsReminder'
        ),
    },
    {
      name: 'week-one-day-2',
      template: 'renderWeekOneDay2',
      render: () => renderWeekOneDay2({ ...origins, unsubUrl: weekOneUnsubUrl }),
    },
    {
      name: 'week-one-day-7',
      template: 'renderWeekOneDay7',
      render: () =>
        renderWeekOneDay7({
          counts: {
            entriesImported: 1284,
            firstImportNew: true,
            monthsTracked: 7,
            prints: 0,
            bills: 8,
            uncategorised: 38,
          },
          step: {
            title: 'Import the rest of your year',
            reason: '7 of 12 months tracked. A month counts once it holds 3 entries.',
            hash: '#import/bank',
            label: 'Import',
          },
          ...origins,
          unsubUrl: weekOneUnsubUrl,
        }),
    },
    {
      // A year that came in in setup, five days before: the badge and the print came with it.
      name: 'week-one-day-7-year',
      template: 'renderWeekOneDay7',
      render: () =>
        renderWeekOneDay7({
          counts: {
            entriesImported: 300,
            firstImportNew: false,
            monthsTracked: 12,
            prints: 1,
            bills: 0,
            uncategorised: 0,
          },
          step: null,
          ...origins,
          unsubUrl: weekOneUnsubUrl,
        }),
    },
  ];
}
