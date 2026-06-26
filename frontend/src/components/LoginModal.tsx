import { api } from '../core/api'
import styles from './LoginModal.module.css'

export interface LoginModalProps {
  onClose: () => void
  // Kept for existing call sites; the Google flow is a full-page redirect, so it never
  // fires (the app re-checks the session on reload instead).
  onSuccess: () => void
}

export default function LoginModal(props: LoginModalProps) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose()
  }

  return (
    <div
      class={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div class={styles.modal} onKeyDown={handleKeyDown}>
        <h3 class={styles.title}>Sign In</h3>
        <p style={{ 'margin-bottom': '16px', color: 'var(--text-secondary)', 'font-size': '14px' }}>
          Sign in with your Google account to sync your data across devices.
        </p>
        <div class={styles.actions}>
          <button class={styles.btnCancel} onClick={props.onClose} type="button">
            Cancel
          </button>
          <button
            class={styles.btnSubmit}
            onClick={() => {
              api.loginWithGoogle()
            }}
            type="button"
          >
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  )
}
