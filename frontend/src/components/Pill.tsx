/**
 * Pill — the app's signature pill container: a hairline glass capsule with a
 * small glowing "satellite" dot at its leading edge, echoing the warm outer
 * satellite of the logo and OrbitSpinner. Use it wherever a compact labelled
 * chip belongs: supported banks/formats in the import dropzones, feature
 * callouts, quick filters.
 *
 * Distinct from `Badge` (the tiny solid status label): Pill is the larger
 * branded container, and can render as a real button via `interactive`.
 */
import { mergeProps, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import styles from './Pill.module.css'
import type { JSX } from 'solid-js'

export type PillTone = 'neutral' | 'accent' | 'primary' | 'success' | 'warning' | 'danger'

export interface PillProps {
  children: JSX.Element
  /** Visual tone. `neutral` keeps the brand's warm satellite dot. */
  tone?: PillTone
  size?: 'sm' | 'md'
  /** Optional leading icon; replaces the satellite dot when provided. */
  icon?: JSX.Element
  /** Set false to drop the leading satellite dot. */
  dot?: boolean
  /** Render as a <button> with hover/focus affordances. */
  interactive?: boolean
  onClick?: (event: MouseEvent) => void
  title?: string
  class?: string
  'data-test-id'?: string
}

const toneClass: Record<PillTone, string> = {
  neutral: styles.neutral,
  accent: styles.accent,
  primary: styles.primary,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
}

export function Pill(props: PillProps) {
  const merged = mergeProps({ tone: 'neutral' as PillTone, size: 'sm' as const, dot: true }, props)
  return (
    <Dynamic
      component={merged.interactive ? 'button' : 'span'}
      type={merged.interactive ? 'button' : undefined}
      class={[
        styles.pill,
        merged.size === 'md' ? styles.md : styles.sm,
        toneClass[merged.tone],
        merged.interactive ? styles.interactive : '',
        merged.class ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={merged.title}
      data-test-id={merged['data-test-id']}
      onClick={merged.onClick}
    >
      <Show
        when={merged.icon}
        fallback={
          <Show when={merged.dot}>
            <span class={styles.dot} aria-hidden="true" />
          </Show>
        }
      >
        <span class={styles.icon} aria-hidden="true">
          {merged.icon}
        </span>
      </Show>
      {merged.children}
    </Dynamic>
  )
}

export default Pill
