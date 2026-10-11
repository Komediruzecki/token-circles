/**
 * The Welcome mail goes to an account once: when its address is first confirmed, by its confirm
 * link, Google sign-in, an emailed sign-in code or a reset link; or at once for a Google sign-up,
 * whose address Google has confirmed. A password sign-up gets Confirm instead, which carries only
 * the link (emailTemplates.ts).
 *
 * "Once" is a row in reminder_dedup, (user_id, 'welcome'): the table that already makes each
 * scheduled mail go once (migration 0007), so the record needs no table or column of its own. The
 * write that confirms an address claims the row in the same D1 batch, and only while the address
 * is still unconfirmed as that batch runs. Of two ways of confirming that race, one confirms and
 * claims; the other finds the address confirmed and claims nothing. The primary key holds the
 * rest.
 *
 * Migration 0033 claimed the row for every account that existed before it: those accounts had the
 * welcome of their day at sign-up, and an account still waiting for its link gets no second one
 * when it confirms. Account deletion deletes the row with the account (routes/account.ts).
 *
 * The mail goes after the answer, best effort. A send that fails is logged and not retried, and
 * the claim stays: a welcome that never arrived is better than two.
 */
import type { Context } from 'hono';
import type { AppEnv, Env } from './index';
import { sendMail } from './email';
import { renderWelcome } from './emailTemplates';

/** The reminder_dedup key that records an account's welcome. */
export const WELCOME_KEY = 'welcome';

/**
 * Claims `userId`'s welcome while its address is unconfirmed. It goes into the batch that
 * confirms the address, before the write that confirms it, after which it claims nothing.
 */
export function claimWelcomeOnConfirm(db: D1Database, userId: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO reminder_dedup (user_id, dedup_key)
       SELECT ?, '${WELCOME_KEY}' WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND email_verified = 0)`
    )
    .bind(userId, userId);
}

/** Claims the welcome of an account made with its address confirmed: a Google sign-up. */
export function claimWelcome(db: D1Database, userId: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO reminder_dedup (user_id, dedup_key) VALUES (?, '${WELCOME_KEY}')`
    )
    .bind(userId);
}

/** Whether a claim's statement claimed the welcome. */
export const welcomeClaimed = (result: D1Result | undefined): boolean =>
  (result?.meta.changes ?? 0) > 0;

/** Mail the Welcome to account `userId`, with links into `appUrl`. Never throws. */
export async function mailWelcome(env: Env, userId: number, appUrl: string): Promise<void> {
  try {
    const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
      .bind(userId)
      .first<{ email: string | null }>();
    if (!user?.email) return;
    const mail = renderWelcome({ appUrl });
    await sendMail(env, user.email, mail.subject, mail.html, { text: mail.text });
  } catch (e) {
    console.error('Welcome email failed:', e);
  }
}

/** Sends a claimed welcome: what a route that confirms an address hands to the code that does. */
export type Welcomer = (userId: number) => void;

/** The welcomer for a request: the mail goes after the answer, with links into the app. */
export function welcomeAfterAnswer(c: Context<AppEnv>): Welcomer {
  const appUrl = c.env.CORS_ORIGIN || c.env.APP_ORIGINS?.split(',')[0] || new URL(c.req.url).origin;
  return (userId) => c.executionCtx.waitUntil(mailWelcome(c.env, userId, appUrl));
}
