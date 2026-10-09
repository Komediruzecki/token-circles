/**
 * A profile as the profile dialog, Settings, the local-first router and the Worker accept it.
 *
 * One set of rules and one set of messages, so both runtimes refuse the same name for the same
 * reason, in the same words, and the forms can run the same check before they send anything. The
 * two used to disagree (docs/plans/2026-10-07-form-errors.md, slice 4b): local-first capped a name
 * at 100 characters and the Worker did not; the Worker refused a duplicate on a rename and
 * local-first stored it; both compared names exactly, so "Holiday" and "holiday" were two
 * profiles; and each said it in its own words ("Name is required", "Profile name is required").
 *
 * The rules:
 *
 * - A profile has a name: trimmed, at least one character, at most 100.
 * - A person's profiles have different names, compared without case or the space around them.
 *   Whether a name is taken needs the person's profiles, so the runtimes ask it with
 *   `clashingProfileName`, and refuse it in these words.
 * - A rename that sends the stored name back, give or take case and the space around it, is not
 *   checked against the length or the other names (decision 2): a profile saved under older rules,
 *   with a longer name or a twin that differs only in case, can still be tidied. Only a name that
 *   would break the database's own rule (exactly another profile's name) is refused then.
 * - A person keeps at least one profile: deleting the last one is refused.
 */
import type { Checked, FieldErrors } from './refusal';

export const PROFILE_NAME_MAX = 100;

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const PROFILE_MESSAGES = {
  name: 'Give the profile a name.',
  nameLength: `Keep the name to ${PROFILE_NAME_MAX} characters or fewer.`,
  onlyProfile: 'This is your only profile. Create another one before you delete this one.',
  notFound: 'Profile not found',
} as const;

/** The refusal for a name another of the person's profiles has, quoting that profile's name. */
export function profileNameTaken(existingName: string): FieldErrors {
  return {
    name: `You already have a profile called "${existingName.trim()}". Choose another name.`,
  };
}

/** The fields a profile body may carry. */
export interface ProfileInput {
  name: string;
}

function asRecord(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function readName(raw: unknown): { value: string } | { error: string } {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: PROFILE_MESSAGES.name };
  const name = raw.trim();
  if (name.length > PROFILE_NAME_MAX) return { error: PROFILE_MESSAGES.nameLength };
  return { value: name };
}

/** A new profile: its name, trimmed, or why not. Unknown keys are dropped. */
export function checkProfileCreate(body: unknown): Checked<ProfileInput> {
  const read = readName(asRecord(body).name);
  return 'error' in read
    ? { ok: false, fields: { name: read.error } }
    : { ok: true, value: { name: read.value } };
}

/**
 * A rename of a stored profile: the new name, or why not.
 *
 * A rename is its name, so a body without one is refused. One that sends the stored name back,
 * give or take case and the space around it, is not checked against the length: an older profile
 * with a longer name can still have its case tidied. The name it answers is the one to store.
 */
export function checkProfileRename(
  body: unknown,
  stored: { name?: unknown }
): Checked<ProfileInput> {
  const raw = asRecord(body).name;
  if (
    typeof raw === 'string' &&
    typeof stored.name === 'string' &&
    !renamesProfile(stored.name, raw)
  ) {
    return { ok: true, value: { name: raw.trim() } };
  }
  return checkProfileCreate({ name: raw });
}

/** Whether two names are the same profile name: case and surrounding space do not count. */
export function sameProfileName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Whether a rename to `name` changes the profile's name by more than case and surrounding space,
 * so it has to be checked against the person's other profiles.
 */
export function renamesProfile(storedName: unknown, name: string): boolean {
  return !(typeof storedName === 'string' && sameProfileName(storedName, name));
}

/**
 * The name of the profile in `existing` that `name` would duplicate, or null. `exceptId` leaves
 * out the profile being renamed. A rename that only changes case or surrounding space (`exact`)
 * clashes only with a profile of exactly that name, which the Worker's database refuses too; any
 * other name clashes with one that differs from it only in case.
 */
export function clashingProfileName(
  existing: readonly { id: unknown; name: unknown }[],
  name: string,
  exceptId?: number,
  exact = false
): string | null {
  for (const row of existing) {
    if (exceptId !== undefined && Number(row.id) === exceptId) continue;
    if (typeof row.name !== 'string') continue;
    if (exact ? row.name.trim() === name.trim() : sameProfileName(row.name, name)) return row.name;
  }
  return null;
}
