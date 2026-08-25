/**
 * TokenOrbitLink — an inline action with the product's own motif around it: three tokens
 * tracing slow circles around the pill they sit in.
 *
 * The tokens ride the button's `border-box`, so the orbit is the shape of the button itself and
 * stays correct at any label length or font size — nothing to re-measure when the copy changes.
 * Engines without `offset-path: border-box` get the engraved pill and no tokens at all; see the
 * `@supports` note in the stylesheet for why that is better than a fallback.
 *
 * For the one action on a card that is genuinely a way *out* — cancelling, managing, leaving —
 * where a plain underlined link disappears among the buttons beside it.
 */
import { splitProps } from 'solid-js'
import styles from './TokenOrbitLink.module.css'
import type { JSX } from 'solid-js'

export interface TokenOrbitLinkProps extends Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  'class' | 'children'
> {
  /** The label. */
  children: JSX.Element
  /** Tighten the orbit into a steady sweep while the action is resolving. */
  busy?: boolean
}

export default function TokenOrbitLink(props: TokenOrbitLinkProps) {
  const [local, rest] = splitProps(props, ['children', 'busy'])

  return (
    <button
      type="button"
      {...rest}
      class={styles.tokenOrbitLink}
      classList={{ [styles.busy]: local.busy === true }}
    >
      <span class={styles.label}>{local.children}</span>
      <span class={`${styles.token} ${styles.t1}`} aria-hidden="true" />
      <span class={`${styles.token} ${styles.t2}`} aria-hidden="true" />
      <span class={`${styles.token} ${styles.t3}`} aria-hidden="true" />
    </button>
  )
}
