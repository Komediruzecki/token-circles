/**
 * A category as the forms, the local-first router and the Worker accept it.
 *
 * One set of rules and one set of messages, so both runtimes refuse the same body for the same
 * reason, in the same words, and a form can run the same check before it sends anything. The two
 * used to disagree: local-first refused a body with no type or color and any type but income and
 * expense, so an imported category could not be edited there; the Worker stored any type, any
 * color and a blank name on an edit, and cleared `tax_deductible` and the parent on every edit
 * that left them out (docs/plans/2026-10-07-form-errors.md).
 *
 * - A blank optional field takes its default, on a create and on an edit. A blank icon is `tag`,
 *   which the app reads as "pick one from the name".
 * - A field an edit leaves out is left alone.
 * - Valid means what storage holds and the read schema accepts (`CategorySchema` in
 *   frontend/src/schemas/models.ts): four types, not the two the forms offer.
 * - Checks that need the database (a name already in use, a parent in another profile) stay in
 *   the local handler and the Worker route, with their wording from here.
 */
import type { Checked, FieldErrors } from './refusal';

export const CATEGORY_TYPES = ['expense', 'income', 'transfer', 'account'] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const CATEGORY_NAME_MAX = 100;
export const DEFAULT_CATEGORY_TYPE: CategoryType = 'expense';
export const DEFAULT_CATEGORY_COLOR = '#6b7280';
export const DEFAULT_CATEGORY_ICON = 'tag';

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const CATEGORY_MESSAGES = {
  name: 'Give the category a name.',
  nameLength: `Keep the name to ${CATEGORY_NAME_MAX} characters or fewer.`,
  type: 'Choose Expense or Income.',
  color: "That color can't be used. Pick another one.",
  icon: 'Type an icon name, like utensils, or leave it blank.',
  parent: 'Choose a parent category from the list, or leave it empty.',
  taxDeductible: 'Set tax deductible to true or false.',
} as const;

/** The refusal for a name the profile already has, quoting the category that holds it. */
export function categoryNameTaken(existingName: string): FieldErrors {
  return {
    name: `You already have a category called “${existingName}”. Choose another name.`,
  };
}

/** The fields a category body may carry, in the order the forms show them. */
export interface CategoryInput {
  name: string;
  type: CategoryType;
  icon: string;
  color: string;
  parent_id: number | null;
  tax_deductible: boolean;
}

type Read<T> = { value: T } | { error: string };

const isBlank = (raw: unknown): boolean =>
  raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const READERS: { [K in keyof CategoryInput]: (raw: unknown) => Read<CategoryInput[K]> } = {
  name: (raw) => {
    if (typeof raw !== 'string' || raw.trim() === '') return { error: CATEGORY_MESSAGES.name };
    const name = raw.trim();
    if (name.length > CATEGORY_NAME_MAX) return { error: CATEGORY_MESSAGES.nameLength };
    return { value: name };
  },
  type: (raw) => {
    if (isBlank(raw)) return { value: DEFAULT_CATEGORY_TYPE };
    const type = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
    return (CATEGORY_TYPES as readonly unknown[]).includes(type)
      ? { value: type as CategoryType }
      : { error: CATEGORY_MESSAGES.type };
  },
  icon: (raw) => {
    if (isBlank(raw)) return { value: DEFAULT_CATEGORY_ICON };
    return typeof raw === 'string' ? { value: raw.trim() } : { error: CATEGORY_MESSAGES.icon };
  },
  color: (raw) => {
    if (isBlank(raw)) return { value: DEFAULT_CATEGORY_COLOR };
    const color = typeof raw === 'string' ? raw.trim() : '';
    return HEX_COLOR.test(color) ? { value: color } : { error: CATEGORY_MESSAGES.color };
  },
  parent_id: (raw) => {
    if (isBlank(raw)) return { value: null };
    const id = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
    return Number.isInteger(id) && id > 0 ? { value: id } : { error: CATEGORY_MESSAGES.parent };
  },
  tax_deductible: (raw) => {
    if (isBlank(raw)) return { value: false };
    if (raw === true || raw === 1 || raw === 'true' || raw === '1') return { value: true };
    if (raw === false || raw === 0 || raw === 'false' || raw === '0') return { value: false };
    return { error: CATEGORY_MESSAGES.taxDeductible };
  },
};

const FIELDS = Object.keys(READERS) as (keyof CategoryInput)[];

function asRecord(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/** The raw value a body gives a field. The parent may also come as `parentId`. */
function rawField(body: Record<string, unknown>, field: keyof CategoryInput): unknown {
  if (field === 'parent_id' && body.parent_id === undefined) return body.parentId;
  return body[field];
}

function check(body: unknown, partial: boolean): Checked<Partial<CategoryInput>> {
  const record = asRecord(body);
  const value: Partial<Record<keyof CategoryInput, unknown>> = {};
  const fields: FieldErrors = {};
  for (const field of FIELDS) {
    const raw = rawField(record, field);
    // On an edit, a field the body leaves out is not touched, so it is not checked either.
    if (partial && raw === undefined) continue;
    const read = READERS[field](raw);
    if ('error' in read) fields[field] = read.error;
    else value[field] = read.value;
  }
  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, value: value as Partial<CategoryInput> };
}

/** A new category: every field, defaults filled in, or why not. Unknown keys are dropped. */
export function checkCategoryCreate(body: unknown): Checked<CategoryInput> {
  return check(body, false) as Checked<CategoryInput>;
}

/** An edit: only the fields the body names, defaults for the blank ones, or why not. */
export function checkCategoryUpdate(body: unknown): Checked<Partial<CategoryInput>> {
  return check(body, true);
}

/** Whether two names are the same category name: case and surrounding space do not count. */
export function sameCategoryName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The name of the category in `existing` that `name` would duplicate, or null. `exceptId` leaves
 * out the category being renamed. Both runtimes call this with the profile's categories, so they
 * agree on what a duplicate is.
 */
export function clashingCategoryName(
  existing: readonly { id: unknown; name: unknown }[],
  name: string,
  exceptId?: number
): string | null {
  for (const row of existing) {
    if (exceptId !== undefined && Number(row.id) === exceptId) continue;
    if (typeof row.name === 'string' && sameCategoryName(row.name, name)) return row.name;
  }
  return null;
}
