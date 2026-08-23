/**
 * VerifyEmailBanner — the confirm-your-email nudge for password accounts.
 *
 * A soft gate: the account works unverified, so this asks rather than blocks. It also reports
 * the outcome of the emailed confirm link, which arrives as a `#everified…` fragment consumed
 * at boot (see core/emailVerification.ts).
 *
 * Self-checking. It asks /api/auth/me itself and re-asks whenever the session changes, so it can
 * be dropped into the shell without threading account state through it — and it shows nothing at
 * all on a backend that does not report the field, which is how the legacy self-hosted server
 * answers.
 */
import { createEffect, createSignal, onMount, Show } from 'solid-js'
import { toast } from '../core/api'
import { useAppState } from '../core/appStore'
import { fetchVerificationStatus, takeEmailVerifyResult } from '../core/emailVerification'
import { ResendVerification } from './ResendVerification'
import styles from './VerifyEmailBanner.module.css'
import type { Component } from 'solid-js'

// Dismissal lasts the tab, not forever: an address that is still unconfirmed next time is worth
// mentioning again, and a permanent dismissal is a setting nobody knows they set.
const DISMISS_KEY = 'tc:verifyEmailDismissed'

function loadDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export const VerifyEmailBanner: Component = () => {
  const state = useAppState()
  const [email, setEmail] = createSignal<string | null>(null)
  const [dismissed, setDismissed] = createSignal(loadDismissed())

  const refresh = async (): Promise<void> => {
    if (!state.isAuthenticated) {
      setEmail(null)
      return
    }
    const status = await fetchVerificationStatus()
    // Google accounts arrive verified through Google, so an unverified one there means the
    // account has no confirmed address of its own and there is nothing to resend.
    setEmail(
      status !== null && !status.verified && status.provider === 'password' ? status.email : null
    )
  }

  // Re-ask on every session change, so the nudge appears straight after an in-session sign-up
  // rather than on the next reload.
  createEffect(() => {
    void state.isAuthenticated
    void refresh()
  })

  onMount(() => {
    const result = takeEmailVerifyResult()
    if (result === null) return
    if (result.ok) {
      toast('Email confirmed — your account is all set', 'success')
    } else if (result.error === 'expired') {
      toast('That confirmation link has expired — use Resend to get a fresh one', 'error')
    } else {
      toast('That confirmation link is no longer valid', 'error')
    }
  })

  const dismiss = (): void => {
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* sessionStorage unavailable (private mode, blocked site data) — dismiss for this view */
    }
  }

  return (
    <Show when={email() !== null && !dismissed()}>
      <div class={styles.banner} role="status" data-testid="verify-email-banner">
        <svg
          class={styles.icon}
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M22 7l-10 6L2 7" />
        </svg>
        <p class={styles.text}>
          Confirm your email — we sent a link to <span class={styles.address}>{email()}</span>
        </p>
        <ResendVerification data-testid="verify-email-resend" />
        <button
          class={styles.close}
          onClick={dismiss}
          aria-label="Dismiss"
          title="Dismiss for this session"
          data-testid="verify-email-dismiss"
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </Show>
  )
}
