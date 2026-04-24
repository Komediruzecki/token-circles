/**
 * ModalActions Component
 * Wrapper for modal action buttons
 */

import styles from './ModalActions.module.css'
import type { JSX } from 'solid-js'

interface ModalActionsProps {
  children: JSX.Element
  className?: string
}

export default function ModalActions(props: ModalActionsProps) {
  return <div class={`${styles.modalActions} ${props.className ?? ''}`}>{props.children}</div>
}
