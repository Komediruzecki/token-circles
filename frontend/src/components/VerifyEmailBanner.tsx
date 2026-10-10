/**
 * VerifyEmailBanner — what the app says about the account's address, above every page.
 *
 * It reports the outcome of the emailed confirm link, which arrives as a `#everified…` fragment
 * consumed at boot (see core/emailVerification.ts), and of the link that moves the account to a
 * new address, which comes back the same way. An account whose address is not confirmed never
 * sees it: the app shows Confirm your email instead of itself (ConfirmEmailScreen).
 *
 * After a sign-in that confirmed the address and cleared what the account had set up before it,
 * it also shows that, once, in the same strip (core/accessCleared.ts).
 *
 * And it finishes a link this browser opened before signing in (core/emailVerification.ts): once
 * someone is signed in, it asks the worker, which spends the link for its own account and says
 * so for any other, and it shows the answer.
 */
import { createEffect, createSignal, on, onMount, Show } from 'solid-js'
import { ACCESS_CLEARED_NOTICE, takeAccessCleared } from '../core/accessCleared'
import { toast } from '../core/api'
import { useAppState } from '../core/appStore'
import {
  clearLinkWaiting,
  finishEmailLink,
  linkWaiting,
  takeEmailVerifyResult,
} from '../core/emailVerification'
import styles from './VerifyEmailBanner.module.css'
import type { Component } from 'solid-js'
import type { EmailVerifyResult, LinkFinish } from '../core/emailVerification'

/** A link this browser opened is for another account than the one signed in. */
export const OTHER_ACCOUNT_NOTICE = {
  confirm:
    'That link is for another account. Sign out, then sign in to that account, and its address is confirmed as soon as you do.',
  change:
    'That link is for another account. Sign out, then sign in to that account, and the change is made as soon as you do.',
} as const

/** Say what an emailed link did: the same words whether it finished on opening or after a sign-in. */
function announce(result: EmailVerifyResult): void {
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
      toast("That link doesn't work anymore.", 'error')
    }
    return
  }
  if (result.ok) {
    toast('Email confirmed. Your account is all set.', 'success')
  } else if (result.error === 'expired') {
    toast('That link has expired.', 'error')
  } else {
    toast("That link doesn't work anymore.", 'error')
  }
}

/** The finish route's answer as the outcome announce() takes, or null when there is none to say. */
function finishedAs(finished: LinkFinish): EmailVerifyResult | null {
  const change = finished.change ? ({ change: true } as const) : {}
  switch (finished.outcome) {
    case 'confirmed':
      return { ok: true }
    case 'changed':
      return { ok: true, change: true }
    case 'email_taken':
      return { ok: false, error: 'email_taken', change: true }
    case 'server_error':
      return { ok: false, error: 'server_error', ...change }
    default:
      return null
  }
}

export const VerifyEmailBanner: Component = () => {
  const state = useAppState()
  const [cleared, setCleared] = createSignal(false)
  const [otherAccount, setOtherAccount] = createSignal<'confirm' | 'change' | null>(null)

  // A link opened in this browser before signing in. The worker decides: the link's own account
  // finishes it, any other is told whose it is. With no answer the note stays for the next try.
  const finishWaitingLink = async (): Promise<void> => {
    const finished = await finishEmailLink()
    if (finished === null) return
    if (finished.outcome === 'other_account') {
      setOtherAccount(finished.change ? 'change' : 'confirm')
      return
    }
    clearLinkWaiting()
    setOtherAccount(null)
    const result = finishedAs(finished)
    if (result !== null) announce(result)
  }

  // On every session change: a sign-in finishes a waiting link, a sign-out forgets whose it was.
  createEffect(
    on(
      () => state.isAuthenticated,
      () => {
        if (!state.isAuthenticated) setOtherAccount(null)
        else if (linkWaiting() !== null) void finishWaitingLink()
      }
    )
  )

  onMount(() => {
    setCleared(takeAccessCleared('sign-in'))
    const result = takeEmailVerifyResult()
    if (result !== null) announce(result)
  })

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
      <Show when={otherAccount() !== null}>
        <div class={styles.banner} role="status" data-testid="email-link-other-account">
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
          <p class={styles.text}>{OTHER_ACCOUNT_NOTICE[otherAccount() ?? 'confirm']}</p>
          <button
            class={styles.close}
            onClick={() => setOtherAccount(null)}
            aria-label="Dismiss"
            title="Dismiss"
            data-testid="email-link-other-account-dismiss"
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
