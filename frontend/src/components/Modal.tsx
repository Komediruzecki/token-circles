/**
 * Modal Component - Generic modal dialog
 */

import { createSignal, onMount, onCleanup } from 'solid-js';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  width?: 'small' | 'medium' | 'large';
}

export function Modal(props: ModalProps) {
  const [isVisible, setIsVisible] = createSignal(false);

  onMount(() => {
    if (props.isOpen) {
      setIsVisible(true);
      document.body.style.overflow = 'hidden';
    }
  });

  onCleanup(() => {
    document.body.style.overflow = '';
  });

  const handleClose = () => {
    setIsVisible(false);
    // Small delay to allow animation
    setTimeout(() => {
      setIsVisible(false);
      props.onClose();
    }, 200);
  };

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!props.isOpen) return null;

  const widthClass = props.width === 'small' ? 'modal-small' : props.width === 'large' ? 'modal-large' : 'modal-medium';

  return (
    <div
      class="modal-overlay"
      class={{ visible: isVisible() }}
      onClick={handleOverlayClick}
    >
      <div class={`modal ${widthClass}`} class={{ visible: isVisible() }}>
        {/* Modal Header */}
        <div class="modal-header">
          <h2 class="modal-title">{props.title}</h2>
          <button class="modal-close" onClick={handleClose} aria-label="Close modal">
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
        <div class="modal-body">
          {props.children}
        </div>

        {/* Modal Footer */}
        <div class="modal-footer">
          {props.children?.type?.name !== 'SettingsDialog' ? (
            <button class="btn btn-secondary" onClick={handleClose}>
              Close
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}