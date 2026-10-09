/**
 * A profile's name, written down once: the sidebar's Create Profile dialog (ProfileModal).
 *
 * The check is the one both runtimes run (shared/profileSchema.ts): a name, at most 100
 * characters, that no other profile of the person's has, without regard to case. A name the
 * runtime refuses (taken, which only it knows for certain) is marked under the field, as a blank
 * one is. The dialog used to put the runtime's sentence in a box above the buttons, and kept its
 * button disabled for a blank name, with no word why.
 */
import { checkProfileCreate } from '../../../shared/profileSchema'
import { fieldErrorsOf } from '../../../shared/refusal'
import { createForm } from '../components/form'
import { apiPost, showToast } from '../core/api'
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
