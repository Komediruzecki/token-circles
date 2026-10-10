import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { api, waitsForConfirmLink } from '../core/api'
import { displayVersion } from '../core/appVersion'
import {
  clearLinkWaiting,
  finishEmailLink,
  linkWaiting,
  noteAddressConfirmed,
  takeEmailVerifyResult,
} from '../core/emailVerification'
import LegalLinks from './LegalLinks'
import styles from './LoginScreen.module.css'
import { LogoMark } from './Logo'
import { ResendVerification } from './ResendVerification'
import stepStyles from './SignInSteps.module.css'
import SupportContact from './SupportContact'
import { OTHER_ACCOUNT_NOTICE } from './VerifyEmailBanner'

/** Why the confirm link the person opened did not confirm the address. */
function linkProblem(error: string): string {
  return error === 'expired'
    ? 'That link has expired. Send the link again for a fresh one.'
    : "That link doesn't work anymore. Send the link again for a fresh one."
}

/**
 * Confirm your email: what a signed-in password account sees instead of the app until its address
 * is confirmed. The Worker refuses that session everything but a few account routes
 * (EMAIL_UNCONFIRMED), so there is nothing else to show it. It names the address, sends the link
 * again (POST /api/auth/resend-verification), and signs out.
 *
 * It lets the account in once the address is confirmed. A link this browser opened before signing
 * in is finished here (finishEmailLink), and coming back to the tab asks the Worker again, for a
 * link opened in another tab or on another device. Either way the app reloads, signed in.
 */
export default function ConfirmEmailScreen(props: { email: string; onSignOut: () => void }) {
  // About a link the person opened: why it did not confirm, or that it is another account's.
  const [said, setSaid] = createSignal('')

  const letIn = () => {
    noteAddressConfirmed()
    window.location.reload()
  }

  let asking = false
  const askAgain = async () => {
    if (asking) return
    asking = true
    try {
      const account = await api.signedInAccount()
      if (account !== null && !waitsForConfirmLink(account)) letIn()
    } finally {
      asking = false
    }
  }

  onMount(() => {
    const result = takeEmailVerifyResult()
    if (result !== null && !result.ok && !result.change) setSaid(linkProblem(result.error))
    if (linkWaiting() === null) return
    void finishEmailLink().then((finished) => {
      // No answer: the note stays, and the next load asks again.
      if (finished === null) return
      if (finished.outcome === 'confirmed') {
        letIn()
        return
      }
      if (finished.outcome === 'other_account') {
        // The note stays, so signing in to that account finishes the link.
        setSaid(OTHER_ACCOUNT_NOTICE[finished.change ? 'change' : 'confirm'])
        return
      }
      clearLinkWaiting()
      void askAgain()
    })
  })

  const onBack = () => {
    if (document.visibilityState === 'visible') void askAgain()
  }
  onMount(() => {
    document.addEventListener('visibilitychange', onBack)
    window.addEventListener('focus', onBack)
  })
  onCleanup(() => {
    document.removeEventListener('visibilitychange', onBack)
    window.removeEventListener('focus', onBack)
  })

  return (
    <div class={styles.screen}>
      <div class={styles.card} data-test-id="confirm-email-screen">
        <div class={styles.header}>
          <div class={styles.brand}>
            <LogoMark size={44} />
          </div>
          <h1 class={styles.title}>Confirm your email</h1>
        </div>
        <p class={stepStyles.lead}>
          We sent a link to <strong data-test-id="confirm-email-address">{props.email}</strong>.
          Open it to start using Token Circles.
        </p>
        <Show when={said()}>
          <p class={stepStyles.lead} role="status" data-test-id="confirm-email-said">
            {said()}
          </p>
        </Show>
        <ResendVerification
          variant="button"
          label="Send the link again"
          sentLabel="Sent. Check your inbox."
          data-testid="confirm-email-resend"
        />
        <p class={stepStyles.links}>
          <button
            type="button"
            data-test-id="confirm-email-sign-out"
            class={`${stepStyles.link} ${stepStyles.linkQuiet}`}
            onClick={() => {
              props.onSignOut()
            }}
          >
            Sign out
          </button>
        </p>
        <div class={styles.footer}>
          <SupportContact />
          <LegalLinks />
          <span class={styles.version}>v{displayVersion()}</span>
        </div>
      </div>
    </div>
  )
}
