import { api } from '../core/api'
import layoutStyles from './Layout.module.css'

/**
 * Full-page sign-in gate, shown in server (self-hosted) mode when there's no valid session.
 * Client-only (serverless/demo) mode never renders this — it has no login.
 */
export default function LoginScreen() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        padding: '24px',
        background: 'var(--bg, #0b0e14)',
      }}
    >
      <div
        style={{
          width: '100%',
          'max-width': '360px',
          padding: '32px',
          'border-radius': '16px',
          background: 'var(--surface, #151a23)',
          border: '1px solid var(--border, rgba(255,255,255,0.08))',
          'text-align': 'center',
        }}
      >
        <h1 style={{ 'font-size': '28px', 'font-weight': 700, margin: '0 0 4px' }}>
          Finance<span style={{ color: 'var(--primary)' }}>.</span>
        </h1>
        <p style={{ margin: '0 0 24px', color: 'var(--text-secondary)', 'font-size': '14px' }}>
          Sign in to access your finances.
        </p>
        <button
          class={`${layoutStyles.btn} ${layoutStyles.btnPrimary}`}
          style={{ width: '100%', 'justify-content': 'center' }}
          onClick={() => {
            api.loginWithGoogle()
          }}
          type="button"
        >
          Continue with Google
        </button>
      </div>
    </div>
  )
}
