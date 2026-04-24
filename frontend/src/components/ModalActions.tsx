/**
 * ModalActions Component
 * Wrapper for modal action buttons
 */

import { JSX } from 'solid-js'
import styles from './ModalActions.module.css'

interface ModalActionsProps {
  children: JSX.Element
  className?: string
}

export default function ModalActions(props: ModalActionsProps) {
  return <div class={`${styles.modalActions} ${props.className || ''}`}>{props.children}</div>
}
