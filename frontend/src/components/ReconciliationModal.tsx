/**
 * Reconciliation Modal Component
 * Placeholder for transaction reconciliation functionality
 */

export interface ReconciliationModalProps {
  isOpen: () => boolean
  onClose: () => void
}

export default function ReconciliationModal(props: ReconciliationModalProps) {
  return (
    <div>
      <p>Reconciliation modal placeholder</p>
      <button onClick={props.onClose}>Close</button>
    </div>
  )
}
