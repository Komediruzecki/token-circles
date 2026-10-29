import { onCleanup, onMount, Show } from 'solid-js'
import Turnstile, { captchaStatusMessage, turnstileEnabled } from './Turnstile'
import type { JSX } from 'solid-js'
import type { CaptchaGate } from './captchaGate'

/** Out of sight and out of the layout, but still in the accessibility tree. */
const VISUALLY_HIDDEN: JSX.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: '0',
  margin: '-1px',
  overflow: 'hidden',
  'clip-path': 'inset(50%)',
  'white-space': 'nowrap',
  border: '0',
}

/**
 * The captcha in a kit form: Cloudflare's widget, drawn only when it wants a click, and while it
 * waits for that click, the line that says so. Every form behind the captcha uses it the same way,
 * with its submit button, and gives its form `blocked: captcha.asking`:
 *
 *   <CaptchaCheck gate={captcha} hintClass={...} />
 *   <SubmitButton
 *     busy={form.submitting()}
 *     busyLabel={captcha.busyLabel('Signing in…')}
 *     blocked={captcha.asking()}
 *     aria-describedby={captcha.asking() ? captcha.hintId : undefined}
 *   >
 *
 * The line is a live region that is always on the page, out of sight while it says nothing, and
 * only its words come and go: a live region that appears together with its text is not reliably
 * announced (FormNotice.tsx).
 *
 * Focus coming back into the form starts the next check when the last token has gone out with a
 * send that worked (captchaGate.ts), once that send is over.
 */
export default function CaptchaCheck(props: { gate: CaptchaGate; hintClass?: string }) {
  let anchor: HTMLSpanElement | undefined
  onMount(() => {
    const form = anchor?.closest('form')
    if (!form) return
    const wake = () => {
      // Not while the form sends: a box Cloudflare drew now would sit beside "Signing in…".
      if (form.getAttribute('aria-busy') === 'true') return
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
      <Show when={turnstileEnabled}>
        <div
          id={props.gate.hintId}
          data-test-id="captcha-hint"
          role="status"
          class={props.gate.asking() ? props.hintClass : undefined}
          style={props.gate.asking() ? {} : VISUALLY_HIDDEN}
        >
          {props.gate.asking() ? captchaStatusMessage('interactive') : ''}
        </div>
      </Show>
    </>
  )
}
