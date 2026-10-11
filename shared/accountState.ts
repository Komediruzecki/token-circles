/**
 * What `PUT /api/account/state/:key` stores, and how `GET /api/account/state` reads it back.
 *
 * The routes (worker/src/routes/account-state.ts) keep a small value per account and key in
 * `user_state`. The value is JSON the server builds from the fields checked here, never the body
 * as sent, so a stored value always has its key's shape and stays under USER_STATE_MAX_BYTES.
 *
 * Each key has a rule for how a write meets what is stored:
 *
 * - `onboarding`: the step only moves forward (the furthest step reached is where the wizard
 *   reopens), the first write stamps `started_at`, and `completed` or `skipped` stamps
 *   `finished_at`. A finished record never changes again, so relaunching the wizard from the tour
 *   menu, or a stale tab, cannot rewrite what the first-week measurement reads. A client cannot
 *   send `existing`: only migration 0035 writes it.
 * - `tours`: the list sent replaces the stored one (Reset All Tours sends an empty list). Each id
 *   is a short lowercase slug, kept once, in the order sent.
 * - `getting_started`: `hidden` sent replaces the stored one.
 *
 * The names are in shared/accountStateKeys.ts, which has no imports.
 */
import {
  ONBOARDING_DECISIONS,
  ONBOARDING_STEPS,
  USER_STATE_MAX_BYTES,
  type OnboardingDecision,
  type OnboardingOutcome,
  type OnboardingRecord,
  type OnboardingStep,
  type GettingStartedRecord,
  type ToursRecord,
  type UserStateKey,
} from './accountStateKeys';
import type { Checked } from './refusal';

/** The words for each refusal. The app never sends a refused value; these are for an API client. */
export const USER_STATE_MESSAGES = {
  body: 'Send the fields as an object, like {"step": "import"}.',
  onboarding: 'Send a step, an outcome, or both.',
  step: `Use one of the setup steps: ${ONBOARDING_STEPS.join(', ')}.`,
  outcome: `Use ${ONBOARDING_DECISIONS.join(' or ')}.`,
  seen: 'Send the tours seen as a list of tour ids, like ["dashboard", "import"].',
  hidden: 'Send hidden as true or false.',
  value: `Keep the value under ${USER_STATE_MAX_BYTES} bytes.`,
} as const;

/** The value stored under each key. */
export interface UserStateValues {
  onboarding: OnboardingRecord;
  tours: ToursRecord;
  getting_started: GettingStartedRecord;
}

/** What GET /api/account/state answers: every key, null where nothing is stored. */
export type UserState = { [K in UserStateKey]: UserStateValues[K] | null };

/** `date` as SQLite's `datetime('now')` writes it: UTC, `YYYY-MM-DD HH:MM:SS`. */
export function sqliteDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

const isObject = (raw: unknown): raw is Record<string, unknown> =>
  raw !== null && typeof raw === 'object' && !Array.isArray(raw);

const isStep = (raw: unknown): raw is OnboardingStep =>
  typeof raw === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(raw);

const isDecision = (raw: unknown): raw is OnboardingDecision =>
  typeof raw === 'string' && (ONBOARDING_DECISIONS as readonly string[]).includes(raw);

const isOutcome = (raw: unknown): raw is OnboardingOutcome => isDecision(raw) || raw === 'existing';

/** A tour id: the `id` of a tour in frontend/src/core/spotlightStore.ts. */
const TOUR_ID = /^[a-z][a-z0-9-]{0,39}$/;

const isTourId = (raw: unknown): raw is string => typeof raw === 'string' && TOUR_ID.test(raw);

const isTime = (raw: unknown): raw is string =>
  typeof raw === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw);

/** The later of two steps in the wizard's order; null only when both are. */
export function furthestStep(
  a: OnboardingStep | null,
  b: OnboardingStep | null
): OnboardingStep | null {
  if (a === null) return b;
  if (b === null) return a;
  return ONBOARDING_STEPS.indexOf(b) > ONBOARDING_STEPS.indexOf(a) ? b : a;
}

/** Whether a record says the wizard is behind the account: completed, skipped or migrated. */
export function onboardingFinished(record: OnboardingRecord | null): boolean {
  return record !== null && record.outcome !== null;
}

/** A stored onboarding record, or null when `raw` is not one. */
export function readOnboardingRecord(raw: unknown): OnboardingRecord | null {
  if (!isObject(raw)) return null;
  const { step, started_at, finished_at, outcome } = raw;
  if (step !== null && !isStep(step)) return null;
  if (started_at !== null && !isTime(started_at)) return null;
  if (finished_at !== null && !isTime(finished_at)) return null;
  if (outcome !== null && !isOutcome(outcome)) return null;
  // Finished means both, or neither.
  if ((outcome === null) !== (finished_at === null)) return null;
  return { step, started_at, finished_at, outcome };
}

/** A stored tours record, or null when `raw` is not one. */
export function readToursRecord(raw: unknown): ToursRecord | null {
  if (!isObject(raw) || !Array.isArray(raw.seen) || !raw.seen.every(isTourId)) return null;
  return { seen: [...new Set(raw.seen)] };
}

/** A stored Getting started record, or null when `raw` is not one. */
export function readGettingStartedRecord(raw: unknown): GettingStartedRecord | null {
  if (!isObject(raw) || typeof raw.hidden !== 'boolean') return null;
  return { hidden: raw.hidden };
}

/** The value stored under `key`, or null when there is none or it cannot be read. */
export function readUserStateValue<K extends UserStateKey>(
  key: K,
  raw: string | null
): UserStateValues[K] | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  switch (key) {
    case 'onboarding':
      return readOnboardingRecord(parsed) as UserStateValues[K] | null;
    case 'tours':
      return readToursRecord(parsed) as UserStateValues[K] | null;
    case 'getting_started':
      return readGettingStartedRecord(parsed) as UserStateValues[K] | null;
    default:
      return null;
  }
}

/**
 * What `GET /api/account/state` answered, or null when the answer is not an object of keys. A
 * missing or unreadable key reads as null, so a newer Worker's extra key is ignored.
 */
export function readUserState(raw: unknown): UserState | null {
  if (!isObject(raw)) return null;
  return {
    onboarding: readOnboardingRecord(raw.onboarding),
    tours: readToursRecord(raw.tours),
    getting_started: readGettingStartedRecord(raw.getting_started),
  };
}

function mergeOnboarding(
  body: Record<string, unknown>,
  current: OnboardingRecord | null,
  now: string
): Checked<OnboardingRecord> {
  const hasStep = body.step !== undefined;
  const hasOutcome = body.outcome !== undefined;
  if (!hasStep && !hasOutcome)
    return { ok: false, fields: { onboarding: USER_STATE_MESSAGES.onboarding } };
  const fields: Record<string, string> = {};
  if (hasStep && !isStep(body.step)) fields.step = USER_STATE_MESSAGES.step;
  if (hasOutcome && !isDecision(body.outcome)) fields.outcome = USER_STATE_MESSAGES.outcome;
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  // Finished stays finished: the first finish is the one the measurement counts.
  if (current !== null && onboardingFinished(current)) return { ok: true, value: current };
  const step = hasStep ? (body.step as OnboardingStep) : null;
  const outcome = hasOutcome ? (body.outcome as OnboardingDecision) : null;
  return {
    ok: true,
    value: {
      step: furthestStep(current?.step ?? null, step),
      started_at: current === null ? now : current.started_at,
      finished_at: outcome === null ? null : now,
      outcome,
    },
  };
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/**
 * The value to store when `body` is written to `key` over `current`, or why not. `now` is the
 * server's time, in sqliteDateTime's format.
 */
export function checkUserStateWrite<K extends UserStateKey>(
  key: K,
  body: unknown,
  current: UserStateValues[K] | null,
  now: string
): Checked<UserStateValues[K]> {
  if (!isObject(body)) return { ok: false, fields: { body: USER_STATE_MESSAGES.body } };
  let checked: Checked<UserStateValues[UserStateKey]>;
  switch (key) {
    case 'onboarding':
      checked = mergeOnboarding(body, current as OnboardingRecord | null, now);
      break;
    case 'tours': {
      const tours = readToursRecord(body);
      checked = tours
        ? { ok: true, value: tours }
        : { ok: false, fields: { seen: USER_STATE_MESSAGES.seen } };
      break;
    }
    case 'getting_started': {
      const card = readGettingStartedRecord(body);
      checked = card
        ? { ok: true, value: card }
        : { ok: false, fields: { hidden: USER_STATE_MESSAGES.hidden } };
      break;
    }
    default:
      return { ok: false, fields: { body: USER_STATE_MESSAGES.body } };
  }
  if (!checked.ok) return checked;
  if (byteLength(JSON.stringify(checked.value)) > USER_STATE_MAX_BYTES) {
    return { ok: false, fields: { value: USER_STATE_MESSAGES.value } };
  }
  return checked as Checked<UserStateValues[K]>;
}
