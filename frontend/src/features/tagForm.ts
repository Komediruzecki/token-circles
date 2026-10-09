/**
 * The Tags page's name and colour form, written down once: its values, the check it runs before
 * sending, the create or update call, and the toast that says it worked. It opens at the top of
 * the page for a new tag and in a tag's own card to edit it.
 *
 * The check is the one both runtimes run (shared/tagSchema.ts), so an empty or long name is said
 * under the field, in the same words, before anything is sent. The form used to return without a
 * word when the name was empty, and to toast whatever a refused save said. A name another tag has
 * is the runtime's to know, and its refusal is marked under the name too.
 *
 * An edit checks only what it changes, as the runtimes do: a tag an older version stored, with a
 * longer name or a colour no swatch offers, can still be renamed or recoloured.
 */
import { createSignal } from 'solid-js'
import { fieldErrorsOf } from '../../../shared/refusal'
import { checkTagCreate, checkTagEdit } from '../../../shared/tagSchema'
import { createForm } from '../components/form'
import { api, showToast } from '../core/api'
import type { Form } from '../components/form'

export interface TagFormValues {
  name: string
  color: string
}

/** A tag as the page holds one, to open it for editing. */
export interface EditableTag {
  id: number
  name: string
  color: string
}

/** What a save answers: the tag as it now is, and whether it is new. */
export interface SavedTag extends EditableTag {
  created: boolean
}

export type TagForm = Form<TagFormValues> & {
  /** The tag being edited, or null while the form is closed or creating one. */
  editing: () => EditableTag | null
  /** Whether the form is open, for a new tag or an edit. */
  isOpen: () => boolean
  /** Open the form for a new tag, with `color` picked. */
  openNew: (color: string) => void
  /** Open the form on `tag`, with its name and colour. */
  openEdit: (tag: EditableTag) => void
  /** Close it, sending nothing. */
  close: () => void
}

export interface TagFormOptions {
  /** After a save, once the form has closed: select the new tag, reload the list. */
  onSaved: (tag: SavedTag) => void
}

export function createTagForm(options: TagFormOptions): TagForm {
  const [editing, setEditing] = createSignal<EditableTag | null>(null)
  const [isOpen, setOpen] = createSignal(false)

  const form = createForm<TagFormValues, SavedTag>({
    initial: { name: '', color: '' },
    check: (values) => {
      const stored = editing()
      return fieldErrorsOf(
        stored ? checkTagEdit(values, stored) : checkTagCreate(values, values.color)
      )
    },
    send: async (values) => {
      const stored = editing()
      const name = values.name.trim()
      if (stored) {
        await api.updateTag(stored.id, name, values.color)
        showToast(`Saved your changes to "${name}".`, 'success')
        return { id: stored.id, name, color: values.color, created: false }
      }
      const created = await api.createTag(name, values.color)
      showToast(`Added "${created.name}" to your tags.`, 'success')
      return { ...created, created: true }
    },
    saved: (tag) => {
      close()
      options.onSaved(tag)
    },
    failure: "Couldn't save the tag. Try again.",
  })

  const openNew = (color: string) => {
    setEditing(null)
    form.reset({ name: '', color })
    setOpen(true)
  }
  const openEdit = (tag: EditableTag) => {
    setEditing({ id: tag.id, name: tag.name, color: tag.color })
    form.reset({ name: tag.name, color: tag.color })
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    setEditing(null)
    form.reset()
  }

  return Object.assign(form, { editing, isOpen, openNew, openEdit, close })
}
