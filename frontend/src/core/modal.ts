/**
 * Modal module - handles modal open/close state
 */

/**
 * Modal store - manages modal state
 */
export class ModalStore {
  private isOpen = false
  private currentModal: string = ''
  private data: Record<string, unknown> | null = null
  private closeCallback: (() => void) | null = null

  /**
   * Open a modal
   */
  open(modalId: string, data?: Record<string, unknown>): void {
    this.currentModal = modalId
    this.data = data || null
    this.isOpen = true

    const el = document.getElementById(modalId)
    if (el) {
      el.classList.add('show')
    }
  }

  /**
   * Close current modal
   */
  close(): void {
    if (!this.isOpen) return

    const el = document.getElementById(this.currentModal)
    if (el) {
      el.classList.remove('show')
    }

    // Reset state after animation
    setTimeout(() => {
      this.currentModal = ''
      this.data = null
      this.isOpen = false
      if (this.closeCallback) {
        this.closeCallback()
        this.closeCallback = null
      }
    }, 300) // Wait for transition
  }

  /**
   * Close a specific modal by ID
   */
  closeById(modalId: string): void {
    if (this.currentModal === modalId) {
      this.close()
    }
  }

  /**
   * Check if modal is open
   */
  isModalOpen(): boolean {
    return this.isOpen
  }

  /**
   * Get current modal ID
   */
  getCurrentModal(): string {
    return this.currentModal
  }

  /**
   * Get modal data
   */
  getData(): Record<string, unknown> | null {
    return this.data ?? null
  }

  /**
   * Set close callback
   */
  onAfterClose(callback: () => void): void {
    this.closeCallback = callback
  }
}

// Export singleton instance
export const modal = new ModalStore()

// Global access for HTML attributes - available on window for direct HTML attribute calls
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).modal = {
  open: modal.open.bind(modal),
  close: modal.close.bind(modal),
}
