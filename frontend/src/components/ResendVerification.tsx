/**
 * ResendVerification — the "send me that link again" button, wherever it is needed.
 *
 * It exists as its own component because the confirm-your-email ask now appears in two places
 * (the banner, and the billing panel that refuses to sell to an unconfirmed address) and the
 * interesting part is the same in both: one in-flight request at a time, a terminal "sent" state
 * so the user is not left wondering, and a failure that returns to idle rather than stranding
 * them on a disabled button.
 */
import { Show } from 'solid-js'
import { createSignal } from 'solid-js'
import { toast } from '../core/api'
import { resendVerificationEmail } from '../core/emailVerification'
import styles from './ResendVerification.module.css'
import type { Component } from 'solid-js'

export interface ResendVerificationProps {
  /** `inline` sits in a sentence of running text; `button` is a control in its own right. */
  variant?: 'inline' | 'button'
  'data-testid'?: string
}

export const ResendVerification: Component<ResendVerificationProps> = (props) => {
  const [state, setState] = createSignal<'idle' | 'sending' | 'sent'>('idle')

  const send = async (): Promise<void> => {
    if (state() !== 'idle') return
    setState('sending')
    try {
      await resendVerificationEmail()
      setState('sent')
    } catch (err) {
      // Back to idle: a failed send that leaves its own button disabled has no way forward.
      setState('idle')
      toast(err instanceof Error ? err.message : 'Could not resend the email', 'error')
    }
  }

  return (
    <Show
      when={state() !== 'sent'}
      fallback={<span class={styles.sent}>Sent — check your inbox</span>}
    >
      <button
        type="button"
        class={props.variant === 'inline' ? styles.inline : styles.button}
        onClick={() => void send()}
        disabled={state() === 'sending'}
        data-testid={props['data-testid'] ?? 'resend-verification'}
      >
        {state() === 'sending' ? 'Sending...' : 'Resend'}
      </button>
    </Show>
  )
}
