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
 */
import { checkCategoryCreate, checkCategoryEdit } from '../../../shared/categorySchema'
import { fieldErrorsOf } from '../../../shared/refusal'
import { createForm } from '../components/form'
import { apiPost, apiPut, showToast } from '../core/api'
import type { Form } from '../components/form'

export interface CategoryFormValues {
  name: string
  type: 'expense' | 'income'
  color: string
  icon: string
}

/** A category as a page holds one, to open it for editing. */
export interface EditableCategory {
  id: number
  name: string
  type: string
  color: string
  icon?: string | null
}

export interface CategoryFormOptions {
  /** The color a new category starts with: each page has its own. */
  color: string
  /** The category being edited, or null for a new one. Read when the form is sent. */
  editing?: () => EditableCategory | null
  /** After a save: close the dialog. The form itself is reset by `open`. */
  onSaved: () => void
}

export type CategoryForm = Form<CategoryFormValues> & {
  /** Fill the form for a new category, or with `category` to edit it. */
  open: (category?: EditableCategory | null) => void
}

export function createCategoryForm(options: CategoryFormOptions): CategoryForm {
  const blank: CategoryFormValues = { name: '', type: 'expense', color: options.color, icon: '' }
  /** What an edit opened with: a value still the same is not checked. Null for a new category. */
  let opened: CategoryFormValues | null = null

  const form = createForm<CategoryFormValues>({
    initial: blank,
    check: (values) =>
      fieldErrorsOf(opened ? checkCategoryEdit(values, opened) : checkCategoryCreate(values)),
    send: async (values) => {
      // A name the edit left alone goes back as it came, stray spaces and all. Trimmed, it is a
      // change, and checked as one: a long name with a trailing space would be refused for its
      // length on a color-only edit, the very edit the check against `opened` let through.
      const untouched = opened !== null && values.name === opened.name
      const name = untouched ? values.name : values.name.trim()
      const shown = name.trim()
      // Only the fields this form shows: an edit must not clear a parent or a tax flag it never
      // offered. A blank icon is sent as null and stored as the default.
      const body = {
        name,
        type: values.type,
        color: values.color,
        icon: values.icon.trim() || null,
      }
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

  const open = (category?: EditableCategory | null) => {
    opened = category
      ? {
          name: category.name,
          type: category.type as CategoryFormValues['type'],
          color: category.color,
          icon: category.icon ?? '',
        }
      : null
    form.reset(opened ?? blank)
  }

  return Object.assign(form, { open })
}
