import { createSignal } from 'solid-js'
import { api } from '../core/api'
import styles from './LoginModal.module.css'

export interface LoginModalProps {
  onClose: () => void
  onSuccess: () => void
}

export default function LoginModal(props: LoginModalProps) {
  const [username, setUsername] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [error, setError] = createSignal('')
  const [loading, setLoading] = createSignal(false)

  const handleSubmit = async () => {
    const u = username().trim()
    const p = password()
    if (!u || !p) return

    setLoading(true)
    setError('')
    try {
      await api.login(u, p)
      props.onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit()
    if (e.key === 'Escape') props.onClose()
  }

  return (
    <div class={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) props.onClose() }}>
      <div class={styles.modal} onKeyDown={handleKeyDown}>
        <h3 class={styles.title}>Sign In</h3>
        <div class={styles.field}>
          <label class={styles.label}>Username</label>
          <input
            type="text"
            class={styles.input}
            placeholder="Enter your username"
            value={username()}
            onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
            autofocus
          />
        </div>
        <div class={styles.field}>
          <label class={styles.label}>Password</label>
          <input
            type="password"
            class={styles.input}
            placeholder="Enter your password"
            value={password()}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          />
        </div>
        {error() && <div class={styles.error}>{error()}</div>}
        <div class={styles.actions}>
          <button class={styles.btnCancel} onClick={props.onClose} type="button">
            Cancel
          </button>
          <button
            class={styles.btnSubmit}
            onClick={handleSubmit}
            disabled={loading() || !username().trim() || !password()}
            type="button"
          >
            {loading() ? 'Signing in...' : 'Sign In'}
          </button>
        </div>
      </div>
    </div>
  )
}
