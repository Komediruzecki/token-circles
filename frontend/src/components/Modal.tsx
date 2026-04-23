/**
 * Modal Component - Generic modal dialog
 */

import { createSignal, onCleanup,onMount } from 'solid-js'
import styles from './Modal.module.css'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  width?: 'small' | 'medium' | 'large'
  children?: any
}

export function Modal(props: ModalProps) {
  const [isVisible, setIsVisible] = createSignal(false)

  onMount(() => {
    if (props.isOpen) {
      setIsVisible(true)
      document.body.style.overflow = 'hidden'
    }
  })

  onCleanup(() => {
    document.body.style.overflow = ''
  })

  const handleClose = () => {
    setIsVisible(false)
    // Small delay to allow animation
    setTimeout(() => {
      setIsVisible(false)
      props.onClose()
    }, 200)
  }

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose()
    }
  }

  if (!props.isOpen) return null

  return (
    <div
      class={styles.modalOverlay}
      classList={{ visible: isVisible() }}
      onClick={handleOverlayClick}
    >
      <div class={styles.modal} classList={{ visible: isVisible() }}>
        {/* Modal Header */}
        <div class={styles.modalHeader}>
          <h2 class={styles.modalTitle}>{props.title}</h2>
          <button class={styles.modalClose} onClick={handleClose} aria-label="Close modal">
            <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Modal Body */}
        <div class={styles.modalBody}>{props.children}</div>

        {/* Modal Footer */}
        <div class={styles.modalFooter}>
          {!props.title?.includes('Settings') && (
            <button class={styles.modalFooterButton} onClick={handleClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
