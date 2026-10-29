import { onCleanup, onMount, Show } from 'solid-js'
import Turnstile, { captchaStatusMessage } from './Turnstile'
import type { CaptchaGate } from './captchaGate'

/**
 * The captcha in a kit form: Cloudflare's widget, drawn only when it wants a click, and while it
 * waits for that click, the line that says so. Every form behind the captcha uses it the same way,
 * with its submit button:
 *
 *   <CaptchaCheck gate={captcha} hintClass={...} />
 *   <SubmitButton
 *     busy={form.submitting()}
 *     busyLabel={captcha.busyLabel('Signing in…')}
 *     blocked={captcha.asking()}
 *     aria-describedby={captcha.asking() ? captcha.hintId : undefined}
 *   >
 *
 * Focus coming back into the form starts a check the gate put off after a send that worked
 * (captchaGate.ts).
 */
export default function CaptchaCheck(props: { gate: CaptchaGate; hintClass?: string }) {
  let anchor: HTMLSpanElement | undefined
  onMount(() => {
    const form = anchor?.closest('form')
    if (!form) return
    const wake = () => {
      props.gate.wake()
    }
    form.addEventListener('focusin', wake)
    onCleanup(() => {
      form.removeEventListener('focusin', wake)
    })
  })

  return (
    <>
      <span ref={anchor} hidden />
      <Turnstile
        appearance="interaction-only"
        onToken={props.gate.onToken}
        onStatus={props.gate.onStatus}
        onWidget={props.gate.onWidget}
      />
      <Show when={props.gate.asking()}>
        <div
          id={props.gate.hintId}
          data-test-id="captcha-hint"
          role="status"
          class={props.hintClass}
        >
          {captchaStatusMessage('interactive')}
        </div>
      </Show>
    </>
  )
}
