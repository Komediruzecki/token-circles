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
  renderWelcome,
  type RenderedEmail,
} from '../src/emailTemplates.ts';

export interface MailSample {
  /** A name for the line and the file a sample gets: its template, and which case of it. */
  name: string;
  /** The renderer that makes it. */
  template: string;
  /**
   * `mail` is the layout of 2026-10-11. `first` is the first shell, which the mails that show an
   * amount of money keep (maff's call of 2026-10-11), and the two billing mails with them.
   */
  layout: 'mail' | 'first';
  render: () => RenderedEmail;
}

export interface SampleOptions {
  /** The app the mails link into. */
  appUrl?: string;
  /** Where the mails load the wordmark and the art from. */
  assetOrigin?: string;
}

/** A sample link, to an address that answers nothing. */
const sampleLink = (path: string) => `https://api.tokencircles.com${path}?token=EXAMPLE-ONLY`;

/** The amount mails render nothing without data; the samples always have some. */
function rendered(mail: RenderedEmail | null, template: string): RenderedEmail {
  if (!mail) throw new Error(`${template} rendered nothing from its sample`);
  return mail;
}

export function mailSamples(opts: SampleOptions = {}): MailSample[] {
  const appUrl = opts.appUrl ?? 'https://tokencircles.com';
  const assetOrigin = opts.assetOrigin ?? appUrl;
  const unsubUrl = sampleLink('/api/notifications/unsubscribe');
  return [
    {
      name: 'confirm-email',
      template: 'renderConfirmEmail',
      layout: 'mail',
      render: () =>
        renderConfirmEmail({
          link: sampleLink('/api/auth/verify-email'),
          ttlHours: 24,
          assetOrigin,
        }),
    },
    {
      name: 'confirm-email-fresh-link',
      template: 'renderEmailVerification',
      layout: 'mail',
      render: () =>
        renderEmailVerification({
          link: sampleLink('/api/auth/verify-email'),
          ttlHours: 24,
          assetOrigin,
        }),
    },
    {
      name: 'welcome',
      template: 'renderWelcome',
      layout: 'mail',
      render: () => renderWelcome({ appUrl, assetOrigin }),
    },
    {
      name: 'email-change',
      template: 'renderEmailChange',
      layout: 'mail',
      render: () =>
        renderEmailChange({
          link: sampleLink('/api/auth/verify-email'),
          ttlHours: 24,
          assetOrigin,
        }),
    },
    {
      name: 'email-change-notice',
      template: 'renderEmailChangeNotice',
      layout: 'mail',
      render: () => renderEmailChangeNotice({ newEmail: 'new.address@example.com', appUrl }),
    },
    {
      name: 'email-change-notice-unnamed',
      template: 'renderEmailChangeNotice',
      layout: 'mail',
      render: () => renderEmailChangeNotice({ newEmail: null, appUrl }),
    },
    {
      name: 'account-exists',
      template: 'renderAccountExists',
      layout: 'mail',
      render: () => renderAccountExists({ appUrl }),
    },
    {
      name: 'password-reset',
      template: 'renderPasswordReset',
      layout: 'mail',
      render: () =>
        renderPasswordReset({
          link: `${appUrl}/#reset-password?token=EXAMPLE-ONLY`,
          ttlHours: 2,
          assetOrigin,
        }),
    },
    {
      name: 'login-code',
      template: 'renderLoginCode',
      layout: 'mail',
      render: () => renderLoginCode({ code: '123456', ttlMinutes: 10, assetOrigin }),
    },
    {
      name: 'test-basic',
      template: 'renderTestBasic',
      layout: 'mail',
      render: () => renderTestBasic({ assetOrigin }),
    },
    {
      name: 'support-ack',
      template: 'renderSupportAck',
      layout: 'mail',
      render: () => renderSupportAck({ ticketId: 'TC-SAMPLE', assetOrigin }),
    },
    {
      name: 'payment-failed',
      template: 'renderPaymentFailed',
      layout: 'first',
      render: () =>
        renderPaymentFailed({
          planName: 'Basic',
          amountDue: 4,
          currency: 'EUR',
          nextAttempt: new Date('2026-11-04T00:00:00Z'),
          appUrl,
        }),
    },
    {
      name: 'payment-action-required',
      template: 'renderPaymentActionRequired',
      layout: 'first',
      render: () => renderPaymentActionRequired({ planName: 'Basic', appUrl }),
    },
    {
      name: 'subscription-ended',
      template: 'renderSubscriptionEnded',
      layout: 'first',
      render: () => renderSubscriptionEnded({ planName: 'Basic', appUrl }),
    },
    {
      name: 'budget-alert',
      template: 'renderBudgetAlert',
      layout: 'first',
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
            assetOrigin,
          }),
          'renderBudgetAlert'
        ),
    },
    {
      name: 'spending-report',
      template: 'renderSpendingReport',
      layout: 'first',
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
            assetOrigin,
          }),
          'renderSpendingReport'
        ),
    },
    {
      name: 'bills-reminder',
      template: 'renderBillsReminder',
      layout: 'first',
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
            assetOrigin,
          }),
          'renderBillsReminder'
        ),
    },
  ];
}
