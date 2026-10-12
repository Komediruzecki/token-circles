/**
 * The answers a person gives the guidance, one record per profile.
 *
 * The record is JSON text in the profile's settings under `guidance`; local-first names the profile
 * in the key, `guidance:<profile id>` (shared/profileSettings.ts). It has no route of its own and
 * no column per question: `PUT /api/settings` stores it, and refuses one that is not well formed
 * (readSetting in shared/settingsSchema.ts), in both runtimes.
 *
 * This build asks two questions, at "Name your space" in setup:
 *
 * - `region`: where the person lives, for the official figures their numbers are compared with.
 *   DE, HR, EU27 ("another EU country"), UK or US; `elsewhere` for somewhere else, compared with
 *   the EU average; or `skipped` when they chose not to say.
 * - `adults` and `children`: who the space covers. 3 stands for three or more.
 *
 * Later questions add fields of their own, so the record keeps what it cannot read:
 *
 * - **A field this build does not know is kept as it is**, by the reader and by every write. A
 *   newer build's answers survive a write from this one.
 * - **A value this build cannot read is kept, and reads as unanswered.** A write checks that each
 *   field this build knows is well formed (a region is a short id, a count a whole number), not that
 *   this build knows the value: a newer build may add a region, and a record holding it must not
 *   stop an older build, in an old tab or after a rollback, from saving another answer.
 * - **Every write merges into the freshest read** (`mergeAnswers`): the app re-reads the record and
 *   changes only the fields being answered, so two tabs answering different questions keep both.
 * - **The stored text is at most 4 KB** (`ANSWERS_MAX_BYTES`).
 *
 * Pure and hand-written, as the Worker imports it and `shared/` has no zod.
 */

/** The answers to "Where do you live?": the places compared with, and the two that name none. */
export const REGION_ANSWERS = ['DE', 'HR', 'EU27', 'UK', 'US', 'elsewhere', 'skipped'] as const;
export type RegionAnswer = (typeof REGION_ANSWERS)[number];

/** The most adults or children the household question offers: 3 stands for three or more. */
export const HOUSEHOLD_MOST = 3;

/** The largest stored record, in bytes of its JSON text. */
export const ANSWERS_MAX_BYTES = 4096;

/** The answers this build reads. A field it does not know, or a value it cannot read, is absent. */
export interface Answers {
  region?: RegionAnswer;
  /** At least 1. */
  adults?: number;
  /** At least 0. */
  children?: number;
}

/** The fields this build knows. */
export const ANSWER_FIELDS = [
  'region',
  'adults',
  'children',
] as const satisfies readonly (keyof Answers)[];

/** The stored record: every field, the ones this build reads and the ones it does not. */
export type AnswersRecord = Record<string, unknown>;

/** A change to the answers: a field set to its new answer, or to null to clear it ("Remove answer"). */
export type AnswerChanges = { [K in keyof Answers]?: Answers[K] | null };

/** The words for each refusal. */
export const ANSWERS_MESSAGES = {
  record: 'Send the answers as the JSON text of one object, like {"region": "DE"}.',
  size: 'Keep the answers to 4 KB or less.',
  region: 'Use a short id for the region, like DE or EU27.',
  adults: 'Use a whole number from 1 to 99 for the adults.',
  children: 'Use a whole number from 0 to 99 for the children.',
} as const;

/** A count a write accepts: a whole number in range. 99 bounds it; the questions offer 3. */
const COUNT_MOST = 99;
const REGION_ID = /^[A-Za-z0-9_-]{1,32}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown, least: number): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= least && value <= COUNT_MOST
  );
}

/**
 * The stored record, from the setting's JSON text. Anything that is not one object, including no
 * record at all, reads as an empty one.
 */
export function answersRecord(stored: unknown): AnswersRecord {
  let value: unknown = stored;
  if (typeof stored === 'string') {
    try {
      value = JSON.parse(stored);
    } catch {
      return {};
    }
  }
  return isPlainObject(value) ? { ...value } : {};
}

/** The answers this build reads in a stored record, or in no record at all. */
export function readAnswers(stored: unknown): Answers {
  const record = answersRecord(stored);
  const answers: Answers = {};
  if ((REGION_ANSWERS as readonly unknown[]).includes(record.region)) {
    answers.region = record.region as RegionAnswer;
  }
  if (isCount(record.adults, 1)) answers.adults = record.adults;
  if (isCount(record.children, 0)) answers.children = record.children;
  return answers;
}

/**
 * The stored record with `changes` made: a field in `changes` is set, or removed when it is null.
 * Every other field stays as stored, the ones this build reads and the ones it does not.
 */
export function mergeAnswers(stored: unknown, changes: AnswerChanges): AnswersRecord {
  const record = answersRecord(stored);
  for (const field of ANSWER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(changes, field)) continue;
    const value = changes[field];
    if (value === undefined) continue;
    if (value === null) delete record[field];
    else record[field] = value;
  }
  return record;
}

/**
 * The text `PUT /api/settings` stores for a record, as it was sent, or why it is refused: it is
 * not the JSON text of one object, it is over 4 KB, or a field this build knows is not well formed.
 * A field it does not know is not checked.
 */
export function checkAnswers(
  raw: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  const refuse = (error: string) => ({ ok: false as const, error });
  if (typeof raw !== 'string') return refuse(ANSWERS_MESSAGES.record);
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes > ANSWERS_MAX_BYTES) return refuse(ANSWERS_MESSAGES.size);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse(ANSWERS_MESSAGES.record);
  }
  if (!isPlainObject(parsed)) return refuse(ANSWERS_MESSAGES.record);
  const record = parsed;
  const given = (field: string) => record[field] !== undefined && record[field] !== null;
  if (given('region') && !(typeof record.region === 'string' && REGION_ID.test(record.region))) {
    return refuse(ANSWERS_MESSAGES.region);
  }
  if (given('adults') && !isCount(record.adults, 1)) return refuse(ANSWERS_MESSAGES.adults);
  if (given('children') && !isCount(record.children, 0)) return refuse(ANSWERS_MESSAGES.children);
  return { ok: true, value: raw };
}
