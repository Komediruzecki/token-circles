import { Show } from 'solid-js'
import { setSettingsTab } from '../core/settingsStore'
import { createProfileCreateForm } from '../features/profileForm'
import { Field, FormNotice, SubmitButton } from './form'
import styles from './ProfileModal.module.css'
import type { Profile } from '../types/models'

export interface ProfileModalProps {
  onClose: () => void
  /** Called with the new profile, so the caller can select it and show it by name. */
  onSuccess: (profile: Profile) => void
}

/**
 * The sidebar's Create Profile dialog. The name is checked with the rules both runtimes run, and a
 * refused one is marked under the field (features/profileForm.ts).
 */
export default function ProfileModal(props: ProfileModalProps) {
  const form = createProfileCreateForm({
    onCreated: (created) => {
      props.onSuccess(created)
    },
  })

  // The Worker refuses a create past the plan's profile cap with "...Upgrade for more.", which is
  // no field's fault: it stays in the notice, with a way to Settings > Billing beside it.
  const isPlanCapError = (): boolean => /Upgrade for more/i.test(form.notice() ?? '')
  const goToBilling = () => {
    setSettingsTab('billing')
    props.onClose()
    window.location.hash = '#settings'
  }

  return (
    <div
      class={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div
        class={styles.modal}
        data-test-id="profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onClose()
        }}
      >
        <h3 class={styles.title} id="profile-modal-title">
          Create Profile
        </h3>
        <form {...form.attrs}>
          <FormNotice form={form} />
          <Show when={isPlanCapError()}>
            <button class={styles.upgradeBtn} onClick={goToBilling} type="button">
              Upgrade
            </button>
          </Show>
          <Field
            form={form}
            name="name"
            label="Profile Name"
            class={styles.field}
            labelClass={styles.label}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                class={styles.input}
                data-test-id="profile-name-input"
                placeholder="Holiday house, Side business..."
                value={form.values.name}
                onInput={(e) => form.set('name', e.currentTarget.value)}
                autofocus
              />
            )}
          </Field>
          <div class={styles.actions}>
            <button
              class={styles.btnCancel}
              onClick={() => {
                props.onClose()
              }}
              type="button"
            >
              Cancel
            </button>
            <SubmitButton
              class={styles.btnSubmit}
              data-test-id="profile-create-submit"
              busy={form.submitting()}
              busyLabel="Creating…"
            >
              Create
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  )
}
