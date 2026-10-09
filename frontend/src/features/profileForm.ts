/**
 * A profile's name, written down once: the sidebar's Create Profile dialog (ProfileModal) and the
 * rename in Settings' household view.
 *
 * The check is the one both runtimes run (shared/profileSchema.ts): a name, at most 100
 * characters, that no other profile of the person's has, without regard to case. A name the
 * runtime refuses (taken, which only it knows for certain) is marked under the field, as a blank
 * one is. Both used to put the runtime's sentence in a toast or a box above the buttons, and the
 * dialog kept its button disabled for a blank name, with no word why.
 *
 * A rename that sends the stored name back, or only re-cases it, is checked as the runtimes check
 * it: a profile saved under older rules, with a longer name, can still be tidied.
 */
import { createSignal } from 'solid-js'
import { checkProfileCreate, checkProfileRename } from '../../../shared/profileSchema'
import { fieldErrorsOf } from '../../../shared/refusal'
import { createForm } from '../components/form'
import { apiPost, apiPut, showToast } from '../core/api'
import type { Form } from '../components/form'
import type { Profile } from '../types/models'

export interface ProfileFormValues {
  name: string
}

/** The sidebar's Create Profile dialog. `onCreated` closes it and switches to the new profile. */
export function createProfileCreateForm(options: {
  onCreated: (profile: Profile) => void
}): Form<ProfileFormValues> {
  return createForm<ProfileFormValues, Profile>({
    initial: { name: '' },
    check: (values) => fieldErrorsOf(checkProfileCreate(values)),
    send: async (values) => {
      const created = await apiPost<Profile>('/api/profiles', { name: values.name })
      showToast(`Added "${created.name}" to your profiles and switched to it.`, 'success')
      return created
    },
    saved: (created) => {
      options.onCreated(created)
    },
    failure: "Couldn't create the profile. Try again.",
  })
}

export interface StoredProfile {
  id: number
  name: string
}

export type ProfileRenameForm = Form<ProfileFormValues> & {
  /** The profile being renamed, or null when none is. */
  renaming: () => StoredProfile | null
  /** Start renaming `profile`, with its name in the field. */
  open: (profile: StoredProfile) => void
  /** Stop renaming, sending nothing. */
  close: () => void
  /** Whether the name in the field is the stored one, exactly: there is nothing to send. */
  unchanged: () => boolean
}

/** The rename in Settings' household view. `onRenamed` gets the profile under its new name. */
export function createProfileRenameForm(options: {
  onRenamed: (profile: StoredProfile) => void
}): ProfileRenameForm {
  const [renaming, setRenaming] = createSignal<StoredProfile | null>(null)
  const form = createForm<ProfileFormValues, StoredProfile>({
    initial: { name: '' },
    check: (values) => fieldErrorsOf(checkProfileRename(values, { name: renaming()?.name })),
    send: async (values) => {
      const before = renaming()!
      const renamed = await apiPut<StoredProfile>(`/api/profiles/${before.id}`, {
        name: values.name,
      })
      showToast(`Renamed "${before.name}" to "${renamed.name}".`, 'success')
      return renamed
    },
    saved: (renamed) => {
      options.onRenamed(renamed)
      close()
    },
    failure: "Couldn't rename the profile. Try again.",
  })

  const open = (profile: StoredProfile) => {
    form.reset({ name: profile.name })
    setRenaming({ id: profile.id, name: profile.name })
  }
  const close = () => {
    form.reset({ name: '' })
    setRenaming(null)
  }
  const unchanged = () => {
    const stored = renaming()
    return stored !== null && form.values.name === stored.name
  }

  return Object.assign(form, { renaming, open, close, unchanged })
}
