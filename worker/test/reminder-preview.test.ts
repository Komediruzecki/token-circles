import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { composeReminderPreview } from '../src/reminders';

// The on-demand email previews (Settings -> "Preview spending report" / "Preview budget
// alert") must compose the REAL reminder HTML from the user's data without consuming the
// scheduled senders' per-period dedup slots or requiring notification prefs.

const today = new Date().toISOString().split('T')[0];

/** The person's wall clock on 8 October 2026, as local-date.ts localNow gives it. */
const OCTOBER_8 = new Date('2026-10-08T09:00:00Z');

/** The lines of a reminder's plain text that list a budget or a bill. */
const listed = (text: string) => text.split('\n').filter((line) => line.startsWith('- '));

beforeEach(async () => {
  for (const t of ['transactions', 'budgets', 'categories', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (50, 'preview@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (500, 50, 'Main')"),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (7, 500, 'Food', 'expense', '#F97316')"
    ),
    env.DB.prepare(
      `INSERT INTO transactions (profile_id, description, amount, type, date, category_id) VALUES (500, 'Groceries', 120, 'expense', '${today}', 7)`
    ),
    env.DB.prepare(
      `INSERT INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (500, 7, 400, 'monthly', '${today.slice(0, 8)}01')`
    ),
  ]);
});

describe('composeReminderPreview', () => {
  it('builds the real spending report from the user data', async () => {
    const preview = await composeReminderPreview(env, 50, 'spending');
    expect(preview).not.toBeNull();
    expect(preview!.subject).toContain('[Test]');
    expect(preview!.subject.toLowerCase()).toContain('spending report');
    expect(preview!.html).toContain('Food');
  });

  it('uses base-currency values in the spending report', async () => {
    await env.DB.prepare('UPDATE transactions SET amount = 120, amount_local = 12, currency = ?')
      .bind('HRK')
      .run();
    const preview = await composeReminderPreview(env, 50, 'spending');
    expect(preview).not.toBeNull();
    expect(preview!.html).toContain('12.00');
    expect(preview!.html).not.toContain('120.00');
  });

  it('builds a budget alert even below the normal 80% threshold', async () => {
    // 120 / 400 = 30% spent — the scheduled sender would skip this; the preview must not.
    const preview = await composeReminderPreview(env, 50, 'budget');
    expect(preview).not.toBeNull();
    expect(preview!.subject).toContain('[Test]');
    expect(preview!.html).toContain('Food');
  });

  it('does not consume the scheduled senders dedup slot', async () => {
    await composeReminderPreview(env, 50, 'spending');
    const slots = await env.DB.prepare('SELECT COUNT(*) AS n FROM reminder_sends').first<{
      n: number;
    }>();
    expect(slots?.n ?? 0).toBe(0);
  });

  it('returns null for an unknown user', async () => {
    expect(await composeReminderPreview(env, 9999, 'spending')).toBeNull();
  });

  it('anchors to the latest month WITH data when current month is empty', async () => {
    // Replace today's transaction with one from months ago — like previewing against
    // imported history. The old behavior computed the empty current month and returned
    // null ("no data") / an all-0% alert.
    await env.DB.prepare('DELETE FROM transactions').run();
    await env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, type, date, category_id) VALUES (500, 'Old groceries', 90, 'expense', '2026-03-14', 7)"
    ).run();

    const spending = await composeReminderPreview(env, 50, 'spending');
    expect(spending).not.toBeNull();
    expect(spending!.subject).toContain('March 2026');
    expect(spending!.html).toContain('Food');

    // March's budget: a month's budgets are the ones that start in it.
    await env.DB.prepare(
      "INSERT INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (500, 7, 300, 'monthly', '2026-03-01')"
    ).run();
    const budget = await composeReminderPreview(env, 50, 'budget');
    expect(budget).not.toBeNull();
    expect(budget!.subject).toContain('March 2026');
    // The alert must reflect the anchored month's spending, not the empty current month.
    expect(budget!.html).not.toContain('>0%<');
    expect(listed(budget!.text)).toEqual(['- Food: €90.00 of €300.00 (30%)']);
  });

  // A month's budgets are the ones that start in it, as the Budgets page reads them. The alert
  // read every budget the category ever had against this month's spending and kept the worst one:
  // here November's 50 against October's 90 spent, "OVER", where October's budget is 1,000.
  it("measures the month's spending against that month's budget", async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM transactions'),
      env.DB.prepare('DELETE FROM budgets'),
      env.DB.prepare(
        "INSERT INTO transactions (profile_id, description, amount, type, date, category_id) VALUES (500, 'Groceries', 90, 'expense', '2026-10-05', 7)"
      ),
      ...[
        [100, '2026-09-01'],
        [1000, '2026-10-01'],
        [50, '2026-11-01'],
      ].map(([amount, start]) =>
        env.DB.prepare(
          "INSERT INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (500, 7, ?, 'monthly', ?)"
        ).bind(amount, start)
      ),
    ]);

    const preview = await composeReminderPreview(env, 50, 'budget', OCTOBER_8);
    expect(listed(preview!.text)).toEqual(['- Food: €90.00 of €1,000.00 (9%)']);
  });
});

// The bills reminder lists what the Bills page calls unpaid and due soon, on the person's day. A
// bill's stored due date is its first, and paying never moves it, so the email listed every bill
// set up before today as overdue, paid or not, on the date it was set up with.
describe('the bills reminder', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM bills').run();
    const bills: [string, number, string, string | null, number][] = [
      // Paid for October: next due 5 November.
      ['Rent', 900, '2026-01-05', '2026-10-03', 1],
      // Paid for September: due on the 10th.
      ['Water', 40, '2026-01-10', '2026-09-10', 1],
      // Paid for September, and the 3rd has passed: overdue.
      ['Power', 60, '2026-01-03', '2026-09-03', 1],
      // Paused.
      ['Gym', 30, '2026-01-09', null, 0],
    ];
    await env.DB.batch(
      bills.map(([name, amount, due, paid, active]) =>
        env.DB.prepare(
          "INSERT INTO bills (profile_id, name, amount, frequency, due_date, last_paid_date, is_active, type) VALUES (500, ?, ?, 'monthly', ?, ?, ?, 'bill')"
        ).bind(name, amount, due, paid, active)
      )
    );
  });

  it('lists the unpaid bills due within a week, on the dates they fall due', async () => {
    const preview = await composeReminderPreview(env, 50, 'bills', OCTOBER_8);
    expect(preview).not.toBeNull();
    expect(listed(preview!.text)).toEqual([
      '- Power: €60.00 · 2026-10-03 · Overdue',
      '- Water: €40.00 · 2026-10-10 · In 2 days',
    ]);
  });
});
