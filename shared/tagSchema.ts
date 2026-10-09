/**
 * A tag as the Tags page, the Transactions form, the local-first router and the Worker accept it.
 *
 * One set of rules and one set of messages, so both runtimes refuse the same tag for the same
 * reason, in the same words, and the Tags page runs the same check before it sends anything. The
 * two used to disagree (docs/plans/2026-10-07-form-errors.md, slice 5):
 *
 * - Local-first's API schema capped a name at 50 characters and took a colour only as #RRGGBB;
 *   the Worker took any name and any colour.
 * - A tag created without a colour took the next of a twelve-colour palette the app shows nowhere
 *   on the Worker, and always #6e9bff in local-first (the contract's `tag-default-colour`).
 * - An edit without a colour reset it to grey on the Worker and kept it in local-first
 *   (`tag-edit-without-colour`).
 * - Renaming a tag onto another tag's name was refused on the Worker and stored in local-first,
 *   which then listed two tags of one name (`tag-rename-duplicate`). Both compared names exactly,
 *   so "Trip" and "trip" were two tags.
 * - Tags put on a transaction that belong to another profile were refused with 403 on the Worker
 *   and 400 in local-first (`foreign-link-status`).
 * - Each said it in its own words, at no field, and the Tags page said nothing at all when the
 *   name was empty.
 *
 * The rules:
 *
 * - A tag has a name: trimmed, at least one character, at most 50.
 * - A profile's tags have different names, compared without case or the space around them.
 *   Whether a name is taken needs the profile's tags, so the runtimes ask it with
 *   `clashingTagName` and refuse it in these words. A rename that only re-cases the tag's own name
 *   is not checked against the length, and clashes only with a tag of exactly that name, which
 *   the Worker's database refuses too.
 * - The colour is #RRGGBB. A tag created without one takes the colour the Tags page offers a new
 *   tag: the next of the app's palette, by how many tags the profile has (`defaultTagColor`). An
 *   edit without a colour, or with a blank one, keeps the colour the tag has.
 * - A field an edit leaves out is left alone, and so is one it sends back unchanged (decision 2):
 *   a tag stored under older rules, with a longer name or a colour written another way, can still
 *   be renamed or recoloured.
 * - The tags put on a transaction are a list of the profile's own tags: anything else is refused
 *   at `tagIds`, another profile's tag too (which the runtimes check with the ids read here).
 */
import { asId, asRecord, holds, isBlank, type Read } from './fieldReaders';
import { CONSTELLATION } from './palette';
import type { Checked, FieldErrors } from './refusal';

export const TAG_NAME_MAX = 50;

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const TAG_MESSAGES = {
  name: 'Give the tag a name.',
  nameLength: `Keep the name to ${TAG_NAME_MAX} characters or fewer.`,
  color: "That color can't be used. Pick another one.",
  tagIds: "Choose tags from this profile's list.",
  notFound: 'Tag not found',
} as const;

const M = TAG_MESSAGES;

/** The refusal for a name another of the profile's tags has, quoting that tag's name. */
export function tagNameTaken(existingName: string): FieldErrors {
  return { name: `You already have a tag called "${existingName.trim()}". Choose another name.` };
}

/**
 * The colour of a tag created without one: the palette's next after as many as the profile has
 * tags, which is the one the Tags page has picked when it opens its form for a new tag.
 */
export function defaultTagColor(tagCount: number): string {
  const count = Number.isInteger(tagCount) && tagCount > 0 ? tagCount : 0;
  return CONSTELLATION[count % CONSTELLATION.length];
}

/** The fields a tag body may carry. */
export interface TagInput {
  name: string;
  color: string;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function readName(raw: unknown): Read<string> {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: M.name };
  const name = raw.trim();
  return name.length > TAG_NAME_MAX ? { error: M.nameLength } : { value: name };
}

/** A colour that is given: #RRGGBB, any case. */
function readColor(raw: unknown): Read<string> {
  const color = typeof raw === 'string' ? raw.trim() : '';
  return HEX_COLOR.test(color) ? { value: color } : { error: M.color };
}

/**
 * A new tag: its name and colour, or why not. `defaultColor` is the colour of a tag sent without
 * one, `defaultTagColor` of the profile's tag count. Unknown keys are dropped.
 */
export function checkTagCreate(body: unknown, defaultColor: string): Checked<TagInput> {
  const record = asRecord(body);
  const name = readName(record.name);
  const color = isBlank(record.color) ? { value: defaultColor } : readColor(record.color);
  const fields: FieldErrors = {};
  if ('error' in name) fields.name = name.error;
  if ('error' in color) fields.color = color.error;
  if ('error' in name || 'error' in color) return { ok: false, fields };
  return { ok: true, value: { name: name.value, color: color.value } };
}

/**
 * An edit of a stored tag: only the fields whose value the body changes, or why not.
 *
 * A name or a colour sent back as stored is neither checked nor written, so a tag an older version
 * stored with a long name or a colour like "red" can still be recoloured or renamed. A rename that
 * only changes the case of the name is not checked against its length either. A colour left out
 * or blank keeps the one the tag has.
 *
 * `stored` is the row as either runtime holds it, or the values a form opened with.
 */
export function checkTagEdit(
  body: unknown,
  stored: { name?: unknown; color?: unknown }
): Checked<Partial<TagInput>> {
  const record = asRecord(body);
  const value: Partial<TagInput> = {};
  const fields: FieldErrors = {};
  const name = record.name;
  if (name !== undefined && !holds(readName, name, stored.name)) {
    if (typeof name === 'string' && !renamesTag(stored.name, name)) value.name = name.trim();
    else {
      const read = readName(name);
      if ('error' in read) fields.name = read.error;
      else value.name = read.value;
    }
  }
  const color = record.color;
  if (!isBlank(color) && !sameColor(color, stored.color)) {
    const read = readColor(color);
    if ('error' in read) fields.color = read.error;
    else value.color = read.value;
  }
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

/** Whether a colour sent is the one stored: #AABBCC is #aabbcc. */
function sameColor(raw: unknown, stored: unknown): boolean {
  return (
    typeof raw === 'string' &&
    typeof stored === 'string' &&
    raw.trim().toLowerCase() === stored.trim().toLowerCase()
  );
}

/** Whether two names are the same tag name: case and surrounding space do not count. */
export function sameTagName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Whether a rename to `name` changes the tag's name by more than case and surrounding space, so
 * it has to be checked against the profile's other tags.
 */
export function renamesTag(storedName: unknown, name: string): boolean {
  return !(typeof storedName === 'string' && sameTagName(storedName, name));
}

/**
 * The name of the tag in `existing` that `name` would duplicate, or null. `exceptId` leaves out
 * the tag being renamed. A rename that only changes case or surrounding space (`exact`) clashes
 * only with a tag of exactly that name, which the Worker's database refuses too; any other name
 * clashes with one that differs from it only in case.
 */
export function clashingTagName(
  existing: readonly { id: unknown; name: unknown }[],
  name: string,
  exceptId?: number,
  exact = false
): string | null {
  for (const row of existing) {
    if (exceptId !== undefined && Number(row.id) === exceptId) continue;
    if (typeof row.name !== 'string') continue;
    if (exact ? row.name.trim() === name.trim() : sameTagName(row.name, name)) return row.name;
  }
  return null;
}

/**
 * The tags a transaction is given: a list of tag ids, each a positive whole number, read once
 * each, in the order sent. Anything else is refused at `tagIds`. Whether each is a tag of the
 * profile is the runtime's question, refused in the same words.
 */
export function readTagIds(raw: unknown): Checked<number[]> {
  if (!Array.isArray(raw)) return { ok: false, fields: { tagIds: M.tagIds } };
  const ids: number[] = [];
  for (const item of raw) {
    const id = asId(item);
    if (id === null) return { ok: false, fields: { tagIds: M.tagIds } };
    if (!ids.includes(id)) ids.push(id);
  }
  return { ok: true, value: ids };
}
