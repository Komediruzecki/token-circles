/**
 * VerifyEmailBanner — the confirm-your-email nudge for password accounts.
 *
 * A soft gate: the account works unverified, so this asks rather than blocks. It also reports
 * the outcome of the emailed confirm link, which arrives as a `#everified…` fragment consumed
 * at boot (see core/emailVerification.ts), and of the link that moves the account to a new
 * address, which comes back the same way.
 *
 * After a sign-in that confirmed the address and cleared what the account had set up before it,
 * it also shows that, once, in the same strip (core/accessCleared.ts).
 *
 * Self-checking. It asks /api/auth/me itself and re-asks whenever the session changes, so it can
 * be dropped into the shell without threading account state through it — and it shows nothing at
 * all on a backend that does not report the field, which is how the legacy self-hosted server
 * answers.
 */
import { createEffect, createSignal, on, onMount, Show } from 'solid-js'
import { ACCESS_CLEARED_NOTICE, takeAccessCleared } from '../core/accessCleared'
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
  const [cleared, setCleared] = createSignal(false)

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
  createEffect(
    on(
      () => state.isAuthenticated,
      () => {
        void refresh()
      }
    )
  )

  onMount(() => {
    setCleared(takeAccessCleared('sign-in'))
    const result = takeEmailVerifyResult()
    if (result === null) return
    if (result.change) {
      if (result.ok) {
        toast('Email changed. Your account uses the new address from now on.', 'success')
      } else if (result.error === 'expired') {
        // A change that expired no longer waits in Settings, so there is nothing to resend.
        toast(
          'That email change link has expired. Save the new address in Settings to get a fresh one.',
          'error'
        )
      } else if (result.error === 'email_taken') {
        toast('Another account uses that address now, so your email stays as it was.', 'error')
      } else {
        toast('That confirmation link is no longer valid', 'error')
      }
      return
    }
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
    <>
      <Show when={cleared()}>
        <div class={styles.banner} role="status" data-testid="access-cleared-notice">
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
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          <p class={styles.text}>{ACCESS_CLEARED_NOTICE['sign-in']}</p>
          <button
            class={styles.close}
            onClick={() => setCleared(false)}
            aria-label="Dismiss"
            title="Dismiss"
            data-testid="access-cleared-dismiss"
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
    </>
  )
}
