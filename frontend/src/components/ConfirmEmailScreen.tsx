import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { api, toast, waitsForConfirmLink } from '../core/api'
import { plainMessage } from '../core/apiError'
import { apiFetch } from '../core/apiFetch'
import { displayVersion } from '../core/appVersion'
import {
  clearLinkWaiting,
  confirmLinkProblem,
  finishEmailLink,
  linkWaiting,
  noteAddressConfirmed,
  resendVerificationEmail,
  takeEmailVerifyResult,
} from '../core/emailVerification'
import LegalLinks from './LegalLinks'
import styles from './LoginScreen.module.css'
import { LogoMark } from './Logo'
import stepStyles from './SignInSteps.module.css'
import SupportContact from './SupportContact'
import { OTHER_ACCOUNT_NOTICE } from './VerifyEmailBanner'

/** Said when the billing portal did not open and the Worker gave no words of its own. */
const PORTAL_FAILED = "Couldn't open the billing page. Try again in a moment."

/** Said when the link could not be sent again and the failure brought no words of its own. */
const RESEND_FAILED = "Couldn't send the link. Try again in a moment."

/** How long the note that the link went stays. Sending it again clears the note at once. */
export const SENT_SHOWN_MS = 30_000

/**
 * Confirm your email: what a signed-in password account sees instead of the app until its address
 * is confirmed. The Worker refuses that session everything but a few account routes
 * (EMAIL_UNCONFIRMED), so there is nothing else to show it. It names the address, offers to send
 * the link again in the same sentence (POST /api/auth/resend-verification), and signs out. The
 * note that the link went clears after SENT_SHOWN_MS, or at the next press, so a second press is
 * seen to do something. An account with a billing account
 * (`billingAccount`) also gets the billing portal, where its subscription is managed or cancelled:
 * the Worker lets that request through for such an account, so the gate never keeps a subscriber
 * from cancelling.
 *
 * It lets the account in once the address is confirmed. A link this browser opened before signing
 * in is finished here (finishEmailLink). A link opened in another tab of this browser confirms at
 * once, with this session. A link opened on another device confirms only once the account signs
 * in there with its password: the link leaves its marker in that browser alone. Coming back to the
 * tab asks the Worker again, and once the address is confirmed the app reloads, signed in.
 */
export default function ConfirmEmailScreen(props: {
  email: string
  billingAccount?: boolean
  onSignOut: () => void
}) {
  // About a link the person opened: why it did not confirm, or that it is another account's.
  const [said, setSaid] = createSignal('')
  const [openingPortal, setOpeningPortal] = createSignal(false)
  const [portalProblem, setPortalProblem] = createSignal('')
  const [sending, setSending] = createSignal(false)
  const [sentNote, setSentNote] = createSignal(false)
  let sentTimer: ReturnType<typeof setTimeout> | undefined

  const sendAgain = async () => {
    if (sending()) return
    clearTimeout(sentTimer)
    setSentNote(false)
    setSending(true)
    try {
      await resendVerificationEmail()
      setSentNote(true)
      sentTimer = setTimeout(() => setSentNote(false), SENT_SHOWN_MS)
    } catch (err) {
      toast(plainMessage(err, RESEND_FAILED), 'error')
    } finally {
      setSending(false)
    }
  }
  onCleanup(() => {
    clearTimeout(sentTimer)
  })

  // The Stripe-hosted portal, as Settings opens it. The page leaves for it, so the button stays
  // busy on the way out; anything else is said here, and the button comes back.
  const openPortal = async () => {
    if (openingPortal()) return
    setOpeningPortal(true)
    setPortalProblem('')
    try {
      const res = await apiFetch('/api/billing/portal', { method: 'POST', credentials: 'include' })
      const body = (await res.json().catch(() => ({}))) as { url?: unknown; error?: unknown }
      if (res.ok && typeof body.url === 'string') {
        window.location.href = body.url
        return
      }
      setPortalProblem(typeof body.error === 'string' ? body.error : PORTAL_FAILED)
    } catch {
      setPortalProblem(PORTAL_FAILED)
    }
    setOpeningPortal(false)
  }

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
    if (result !== null && !result.ok && !result.change) setSaid(confirmLinkProblem(result.error))
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
        <p class={stepStyles.lead} data-test-id="confirm-email-lead">
          Open the link we sent to{' '}
          <strong data-test-id="confirm-email-address">{props.email}</strong> in this browser and
          you're in, or{' '}
          <button
            type="button"
            data-test-id="confirm-email-resend"
            class={stepStyles.link}
            disabled={sending()}
            onClick={() => {
              void sendAgain()
            }}
          >
            send it again
          </button>
          . Opening it on another device? Sign in there with your password, then come back to this
          tab.
        </p>
        <Show when={sentNote()}>
          <p class={stepStyles.lead} role="status" data-test-id="confirm-email-sent">
            Sent. Open the newest email: the links before it no longer work.
          </p>
        </Show>
        <Show when={said()}>
          <p class={stepStyles.lead} role="status" data-test-id="confirm-email-said">
            {said()}
          </p>
        </Show>
        <Show when={props.billingAccount}>
          <p class={stepStyles.links}>
            <button
              type="button"
              data-test-id="confirm-email-billing"
              class={stepStyles.link}
              disabled={openingPortal()}
              onClick={() => {
                void openPortal()
              }}
            >
              {openingPortal() ? 'Opening the billing page…' : 'Manage or cancel your subscription'}
            </button>
          </p>
          <Show when={portalProblem()}>
            <p class={stepStyles.lead} role="alert" data-test-id="confirm-email-billing-problem">
              {portalProblem()}
            </p>
          </Show>
        </Show>
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
