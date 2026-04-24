/**
 * Button Component - Reusable button component with multiple variants
 */

import { mergeProps } from 'solid-js'
import type { JSX } from 'solid-js'

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'link'
  size?: 'sm' | 'md' | 'lg'
  children: JSX.Element
  class?: string
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
}

export default function Button(props: ButtonProps) {
  const merged = mergeProps({ variant: 'primary', size: 'md' }, props)

  const baseClass = 'btn'
  const variantClass = `btn-${merged.variant}`
  const sizeClass = merged.size !== 'md' ? `btn-${merged.size}` : ''

  return (
    <button
      type={merged.type}
      class={`${baseClass} ${variantClass} ${sizeClass} ${merged.class ?? ''}`.trim()}
      onClick={merged.onClick}
      disabled={merged.disabled}
    >
      {merged.children}
    </button>
  )
}
