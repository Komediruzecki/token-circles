/**
 * ModalContent Component
 * Wrapper for form content in modals
 */

import styles from './ModalContent.module.css'

interface ModalContentProps {
  children: any
  className?: string
}

export default function ModalContent(props: ModalContentProps) {
  return (
    <div class={`${styles.modalContent} ${props.className || ''}`}>
      {props.children}
    </div>
  )
}