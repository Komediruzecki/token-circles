/**
 * ModalContent Component
 * Wrapper for form content in modals
 */

import styles from './ModalContent.module.css'
import type { JSX } from 'solid-js'

interface ModalContentProps {
  children: JSX.Element
  className?: string
}

export default function ModalContent(props: ModalContentProps) {
  return <div class={`${styles.modalContent} ${props.className ?? ''}`}>{props.children}</div>
}
