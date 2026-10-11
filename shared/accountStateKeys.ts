/**
 * The names of the state that belongs to a person's account rather than to the browser it is used
 * in: the `user_state` table (worker/migrations/0034_user_state.sql), served by
 * `GET /api/account/state` and `PUT /api/account/state/:key` (worker/src/routes/account-state.ts).
 *
 * No imports, so the E2E helpers and the marketing-shots script, which runs under plain Node,
 * load this file by path. The checks a write goes through are in shared/accountState.ts.
 */

/**
 * The keys the routes serve. A key that is not here answers 404 and is never stored.
 *
 * - `onboarding`: the setup wizard's record (OnboardingRecord).
 * - `tours`: the guided tours this account has finished, `{ seen: [tour ids] }`.
 * - `getting_started`: the Dashboard's Getting started card, `{ hidden }`. Written when the wizard
 *   finishes, so an account that never met the wizard has no row and no card.
 */
export const USER_STATE_KEYS = ['onboarding', 'tours', 'getting_started'] as const;

export type UserStateKey = (typeof USER_STATE_KEYS)[number];

export function isUserStateKey(key: string): key is UserStateKey {
  return (USER_STATE_KEYS as readonly string[]).includes(key);
}

/** Where the app reads every key at once, and writes one at `${USER_STATE_PATH}/<key>`. */
export const USER_STATE_PATH = '/api/account/state';

/**
 * True for a request to these routes. A write here records where the person is in the app, not
 * their data: the app's data invalidation (frontend/src/core/dataVersions.ts) and the badge check
 * it announces writes to (dataChangedEvent.ts) both skip it, so a wizard step or a finished tour
 * reloads no page.
 */
export function isUserStatePath(path: string): boolean {
  return /^\/api\/account\/state(?:[/?]|$)/.test(path);
}

/**
 * The setup wizard's steps, in the order it shows them. Stored by name and counted by the
 * first-week measurement (completion, and the last step reached by those who stop), so a step is
 * never renamed: a new one gets a new name.
 */
export const ONBOARDING_STEPS = [
  'welcome',
  'space',
  'account',
  'import',
  'subscriptions',
  'done',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** How the wizard was left, as a client sends it. */
export const ONBOARDING_DECISIONS = ['completed', 'skipped'] as const;

export type OnboardingDecision = (typeof ONBOARDING_DECISIONS)[number];

/**
 * How a record finished. `existing` is written only by migration 0035, for an account that was
 * already in use when the record began, so the measurement can leave those accounts out.
 */
export type OnboardingOutcome = OnboardingDecision | 'existing';

/**
 * An account's setup wizard, as stored under `onboarding`.
 *
 * - `step`: the furthest step reached, where the wizard reopens. Null when no step was ever
 *   recorded: a migrated account, or a decision this browser kept from before the record existed.
 * - `started_at`: server time of the write that created the record. Null on migrated rows.
 * - `finished_at`, `outcome`: set together, once. A finished record never changes again.
 *
 * Times are UTC `YYYY-MM-DD HH:MM:SS`, the format of every `datetime('now')` column.
 */
export interface OnboardingRecord {
  step: OnboardingStep | null;
  started_at: string | null;
  finished_at: string | null;
  outcome: OnboardingOutcome | null;
}

/** The tours an account has finished, as stored under `tours`. */
export interface ToursRecord {
  seen: string[];
}

/** The Getting started card, as stored under `getting_started`. */
export interface GettingStartedRecord {
  hidden: boolean;
}

/** The most a stored value may take, in bytes of its JSON. */
export const USER_STATE_MAX_BYTES = 1024;
