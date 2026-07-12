import { createSignal } from 'solid-js'
import { api } from '../core/api'
import styles from './ProfileModal.module.css'

export interface ProfileModalProps {
  onClose: () => void
  onSuccess: () => void
}

export default function ProfileModal(props: ProfileModalProps) {
  const [name, setName] = createSignal('')
  const [error, setError] = createSignal('')
  const [loading, setLoading] = createSignal(false)

  const handleSubmit = async () => {
    const n = name().trim()
    if (!n) return

    setLoading(true)
    setError('')
    try {
      await api.createProfile(n)
      props.onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create profile')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit()
    if (e.key === 'Escape') props.onClose()
  }

  return (
    <div
      class={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div class={styles.modal} data-test-id="profile-modal" onKeyDown={handleKeyDown}>
        <h3 class={styles.title}>Create Profile</h3>
        <div class={styles.field}>
          <label class={styles.label}>Profile Name</label>
          <input
            type="text"
            class={styles.input}
            data-test-id="profile-name-input"
            placeholder="Enter profile name"
            value={name()}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            autofocus
          />
        </div>
        {error() && <div class={styles.error}>{error()}</div>}
        <div class={styles.actions}>
          <button class={styles.btnCancel} onClick={props.onClose} type="button">
            Cancel
          </button>
          <button
            class={styles.btnSubmit}
            data-test-id="profile-create-submit"
            onClick={handleSubmit}
            disabled={loading() || !name().trim()}
            type="button"
          >
            {loading() ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
