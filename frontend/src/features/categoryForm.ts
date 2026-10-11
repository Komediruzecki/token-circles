/**
 * The category form, written once: its values, the check it runs before sending, the create or
 * update call, and the toast that says it worked.
 *
 * Four places create categories: the Categories page, Budgets, and the inline "+ Add Category"
 * dialogs in Bills and Goals. Each keeps its own markup and look and builds it from `Field` and
 * `FormNotice`; what happens on submit is this file, so the four cannot drift apart again. They
 * had: two sent an icon and two did not, and each said something different when a save failed,
 * none of it the reason.
 *
 * The check is the one the local-first router and the Worker run (shared/categorySchema.ts), so a
 * blank name is caught here, in the same words, before anything is sent. A name that is already
 * taken needs the list, so the server answers it, and the kit puts its words under the name.
 *
 * An edit checks only what it changes, as the server does: a category saved under older rules (a
 * 3-digit color, a name over 100 characters) can still have its icon changed without its name
 * being refused.
 *
 * The Categories page also shows what an expense category holds: its kind, and whether it is
 * needed every month (`kinds`, shared/guidance/kinds.ts). The form shows what is stored, and what
 * the app makes of it. The Kind field's empty choice is "no kind stored", which the app reads as
 * the kind the name (or the parent) suggests: the page labels it with that guess (`guessed`), and
 * the guess follows the name as it is typed. "Needed every month" shows what the kind shown, or
 * the guess, makes of it until the person changes the box; from then on it is their choice, and is
 * sent as one, even with no kind.
 *
 * An edit sends a kind or a choice only when the person changed it. What it leaves out the server
 * keeps, so a kind only a later build knows (which this build shows as the guess) survives a change
 * of colour.
 */
import { checkCategoryCreate, checkCategoryEdit } from '../../../shared/categorySchema'
import {
  kindForName,
  kindIsEssential,
  readEssential,
  readKind,
} from '../../../shared/guidance/kinds'
import { fieldErrorsOf } from '../../../shared/refusal'
import { createForm } from '../components/form'
import { apiPost, apiPut, showToast } from '../core/api'
import type { Kind } from '../../../shared/guidance/kinds'
import type { Form } from '../components/form'

export interface CategoryFormValues {
  name: string
  type: 'expense' | 'income'
  color: string
  icon: string
  /** The kind the Kind field shows, or '' for none. Sent only by a form that shows it. */
  kind: string
  /** What "Needed every month" shows. Sent only by a form that shows it. */
  essential: boolean
}

/** A category as a page holds one, to open it for editing. */
export interface EditableCategory {
  id: number
  name: string
  type: string
  color: string
  icon?: string | null
  kind?: string | null
  essential?: boolean | number | null
  parent_id?: number | null
}

export interface CategoryFormOptions {
  /** The color a new category starts with: each page has its own. */
  color: string
  /** The category being edited, or null for a new one. Read when the form is sent. */
  editing?: () => EditableCategory | null
  /** After a save: close the dialog. The form itself is reset by `open`. */
  onSaved: () => void
  /** The dialog shows Kind and "Needed every month", so it sends them. */
  kinds?: boolean
  /**
   * The kind a category with none stored goes by: its parent's, or the one a name suggests
   * (`effectiveKind`). Without it, the one its name suggests.
   */
  guessKind?: (category: { name: string; parent_id: number | null }) => Kind | null
}

export type CategoryForm = Form<CategoryFormValues> & {
  /** Fill the form for a new category, or with `category` to edit it. */
  open: (category?: EditableCategory | null) => void
  /** Sets the name, and the kind and "Needed every month" with it while they are guesses. */
  setName: (name: string) => void
  /** Picks a kind; "Needed every month" follows it until it is chosen too. */
  chooseKind: (kind: string) => void
  /** Ticks or clears "Needed every month". */
  chooseEssential: (essential: boolean) => void
  /** The kind the app goes by while none is stored: the empty choice of the Kind field. */
  guessed: () => Kind | null
}

/** The kind and the choice stored for the category being edited: null where nothing is chosen. */
interface Stored {
  kind: Kind | null
  essential: boolean | null
}

export function createCategoryForm(options: CategoryFormOptions): CategoryForm {
  const blank: CategoryFormValues = {
    name: '',
    type: 'expense',
    color: options.color,
    icon: '',
    kind: '',
    essential: kindIsEssential(null),
  }
  /** What an edit opened with: a value still the same is not checked. Null for a new category. */
  let opened: CategoryFormValues | null = null
  /** What the category being edited has stored. Nothing, for a new one. */
  let stored: Stored = { kind: null, essential: null }
  /** The parent of the category being edited, which the kind's guess can go by. */
  let parentId: number | null = null
  /** Whether the person changed "Needed every month" in this dialog. */
  let essentialPicked = false

  const guess = (name: string): Kind | null =>
    options.guessKind ? options.guessKind({ name, parent_id: parentId }) : kindForName(name)

  /** Whether "Needed every month" counts the category as essential with no choice stored. */
  const essentialByKind = (values: CategoryFormValues): boolean =>
    kindIsEssential(readKind(values.kind) ?? guess(values.name))

  /**
   * The body a save sends. Only the fields this form shows: an edit must not clear a parent or a
   * tax flag it never offered. A blank icon is sent as null and stored as the default.
   */
  const bodyOf = (values: CategoryFormValues, name: string): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      name,
      type: values.type,
      color: values.color,
      icon: values.icon.trim() || null,
    }
    if (!options.kinds) return body
    // Another type takes neither, and an edit that changes the type clears both on the server.
    if (values.type !== 'expense') return opened ? body : { ...body, kind: null, essential: null }
    const kind = readKind(values.kind)
    const essential = values.essential ? 1 : 0
    if (!opened) {
      // A new category stores the kind shown (none: the app goes by the guess), and the box only
      // once the person changed it.
      return { ...body, kind, essential: essentialPicked ? essential : null }
    }
    const edit: Record<string, unknown> = { ...body }
    if (values.kind !== opened.kind) edit.kind = kind
    // The box is sent when the person changed it, unless leaving it out keeps it as shown: when
    // it differs from what the dialog opened with, or from what the stored choice or the kind
    // makes of it after this save.
    const afterSave = stored.essential ?? essentialByKind(values)
    if (
      essentialPicked &&
      (values.essential !== opened.essential || values.essential !== afterSave)
    ) {
      edit.essential = essential
    }
    return edit
  }

  /** The category being edited as stored, for the check: a field still the same is not checked. */
  const storedRow = (values: CategoryFormValues): Record<string, unknown> => ({
    name: values.name,
    type: values.type,
    color: values.color,
    icon: values.icon.trim() || null,
    kind: stored.kind,
    essential: stored.essential === null ? null : stored.essential ? 1 : 0,
  })

  const form = createForm<CategoryFormValues>({
    initial: blank,
    check: (values) => {
      const body = bodyOf(values, values.name)
      return fieldErrorsOf(
        opened ? checkCategoryEdit(body, storedRow(opened)) : checkCategoryCreate(body)
      )
    },
    send: async (values) => {
      // A name the edit left alone goes back as it came, stray spaces and all. Trimmed, it is a
      // change, and checked as one: a long name with a trailing space would be refused for its
      // length on a color-only edit, the very edit the check against `opened` let through.
      const untouched = opened !== null && values.name === opened.name
      const name = untouched ? values.name : values.name.trim()
      const shown = name.trim()
      const body = bodyOf(values, name)
      const editing = options.editing?.()
      if (editing) {
        await apiPut(`/api/categories/${editing.id}`, body)
        showToast(shown ? `Saved your changes to "${shown}".` : 'Saved your changes.', 'success')
        return
      }
      await apiPost('/api/categories', body)
      showToast(`Added "${shown}" to your categories.`, 'success')
    },
    // The toast above says the save happened even when it lands after the dialog was cancelled and
    // opened again: cancelling did not undo it. Closing waits for `saved`, which runs only while
    // this is still the dialog that sent: closing another category's dialog would throw away what
    // is typed in it.
    saved: () => {
      options.onSaved()
    },
    failure: "Couldn't save the category. Try again.",
  })

  /** The box, while neither the person nor a stored choice says: what the kind or guess makes. */
  const follow = () => {
    if (!essentialPicked && stored.essential === null) {
      form.set('essential', essentialByKind(form.values))
    }
  }

  const open = (category?: EditableCategory | null) => {
    essentialPicked = false
    parentId = category?.parent_id ?? null
    stored = {
      kind: category && category.type === 'expense' ? readKind(category.kind) : null,
      essential: category && category.type === 'expense' ? readEssential(category.essential) : null,
    }
    opened = category
      ? {
          name: category.name,
          type: category.type as CategoryFormValues['type'],
          color: category.color,
          icon: category.icon ?? '',
          kind: stored.kind ?? '',
          essential: stored.essential ?? kindIsEssential(stored.kind ?? guess(category.name)),
        }
      : null
    form.reset(opened ?? blank)
  }

  const setName = (name: string) => {
    form.set('name', name)
    follow()
  }

  const chooseKind = (kind: string) => {
    form.set('kind', kind)
    follow()
  }

  const chooseEssential = (essential: boolean) => {
    essentialPicked = true
    form.set('essential', essential)
  }

  const guessed = () => guess(form.values.name)

  return Object.assign(form, { open, setName, chooseKind, chooseEssential, guessed })
}
