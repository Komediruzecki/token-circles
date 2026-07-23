import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { composeReminderPreview } from '../src/reminders';

// The on-demand email previews (Settings -> "Preview spending report" / "Preview budget
// alert") must compose the REAL reminder HTML from the user's data without consuming the
// scheduled senders' per-period dedup slots or requiring notification prefs.

const today = new Date().toISOString().split('T')[0];

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

    const budget = await composeReminderPreview(env, 50, 'budget');
    expect(budget).not.toBeNull();
    expect(budget!.subject).toContain('March 2026');
    // The alert must reflect the anchored month's spending, not the empty current month.
    expect(budget!.html).not.toContain('>0%<');
  });
});
