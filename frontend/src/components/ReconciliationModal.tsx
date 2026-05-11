/**
 * Reconciliation Modal Component
 * Mark transactions as reconciled
 */
import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { api, toast } from '../core/api'

export interface ReconciliationModalProps {
  isOpen: () => boolean
  onClose: () => void
  selectedTransactionIds: number[]
  onReconciled: () => void
}

export default function ReconciliationModal(props: ReconciliationModalProps) {
  const [summary, setSummary] = createSignal<{
    reconciled_count: number
    unreconciled_count: number
    reconciled_total: number
    unreconciled_total: number
  } | null>(null)
  const [isLoading, setIsLoading] = createSignal(false)
  const [isReconciling, setIsReconciling] = createSignal(false)

  const loadSummary = async () => {
    setIsLoading(true)
    try {
      const data = await api.getReconciliationSummary()
      setSummary(data)
    } catch {
      // Summary loading is best-effort
    } finally {
      setIsLoading(false)
    }
  }

  const reconcileSelected = async () => {
    if (props.selectedTransactionIds.length === 0) {
      toast('No transactions selected', 'error')
      return
    }
    setIsReconciling(true)
    try {
      const result = await api.reconcileByIds(props.selectedTransactionIds)
      toast(result.message || `Marked ${result.updated} transactions as reconciled`, 'success')
      await loadSummary()
      props.onReconciled()
      props.onClose()
    } catch {
      toast('Failed to reconcile transactions', 'error')
    } finally {
      setIsReconciling(false)
    }
  }

  const reconcileAllUnreconciled = async () => {
    const s = summary()
    if (!s || s.unreconciled_count === 0) {
      toast('No unreconciled transactions', 'info')
      return
    }
    setIsReconciling(true)
    try {
      // Get all unreconciled transactions and reconcile them
      const result = await api.reconcileByDateRange('2000-01-01', '2099-12-31')
      toast(result.message || `Marked ${result.count} transactions as reconciled`, 'success')
      await loadSummary()
      props.onReconciled()
      props.onClose()
    } catch {
      toast('Failed to reconcile transactions', 'error')
    } finally {
      setIsReconciling(false)
    }
  }

  onMount(() => {
    loadSummary()
  })

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && props.isOpen()) props.onClose()
  }
  document.addEventListener('keydown', handleKeyDown)
  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown)
  })

  return (
    <div style={{ display: props.isOpen() ? 'block' : 'none' }}>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          'z-index': 1000,
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
        }}
        onClick={props.onClose}
      >
        <div
          style={{
            background: 'var(--card-bg)',
            'border-radius': 'var(--radius)',
            padding: '24px',
            'min-width': '400px',
            'max-width': '480px',
            width: '100%',
            'box-shadow': '0 20px 60px rgba(0,0,0,0.3)',
          }}
          onClick={(e) => {
            e.stopPropagation()
          }}
        >
          <div
            style={{
              display: 'flex',
              'justify-content': 'space-between',
              'align-items': 'center',
              'margin-bottom': '20px',
            }}
          >
            <h2 style={{ margin: 0, 'font-size': '18px', 'font-weight': 700 }}>Reconciliation</h2>
            <button
              onClick={props.onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                padding: '4px',
                'border-radius': '4px',
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <Show when={isLoading()}>
            <div style={{ display: 'flex', 'justify-content': 'center', padding: '20px' }}>
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  border: '3px solid var(--border)',
                  'border-top-color': 'var(--primary)',
                  'border-radius': '50%',
                  animation: 'spin 0.6s linear infinite',
                }}
              />
            </div>
          </Show>

          <Show when={!isLoading() && summary()}>
            <div
              style={{
                display: 'grid',
                'grid-template-columns': '1fr 1fr',
                gap: '12px',
                'margin-bottom': '20px',
              }}
            >
              <div
                style={{
                  padding: '12px',
                  background: 'var(--bg)',
                  'border-radius': '8px',
                  'text-align': 'center',
                }}
              >
                <div
                  style={{
                    'font-size': '12px',
                    color: 'var(--text-secondary)',
                    'margin-bottom': '4px',
                  }}
                >
                  Reconciled
                </div>
                <div style={{ 'font-size': '20px', 'font-weight': 700, color: 'var(--success)' }}>
                  {summary()!.reconciled_count}
                </div>
              </div>
              <div
                style={{
                  padding: '12px',
                  background: 'var(--bg)',
                  'border-radius': '8px',
                  'text-align': 'center',
                }}
              >
                <div
                  style={{
                    'font-size': '12px',
                    color: 'var(--text-secondary)',
                    'margin-bottom': '4px',
                  }}
                >
                  Unreconciled
                </div>
                <div style={{ 'font-size': '20px', 'font-weight': 700, color: 'var(--warning)' }}>
                  {summary()!.unreconciled_count}
                </div>
              </div>
            </div>
          </Show>

          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
            <button
              onClick={reconcileSelected}
              disabled={props.selectedTransactionIds.length === 0 || isReconciling()}
              style={{
                padding: '10px 16px',
                background:
                  props.selectedTransactionIds.length > 0
                    ? 'var(--primary)'
                    : 'var(--bg-secondary)',
                color: props.selectedTransactionIds.length > 0 ? '#fff' : 'var(--text-secondary)',
                border: 'none',
                'border-radius': 'var(--radius)',
                cursor: props.selectedTransactionIds.length > 0 ? 'pointer' : 'not-allowed',
                'font-size': '14px',
                'font-weight': 500,
              }}
            >
              Reconcile Selected ({props.selectedTransactionIds.length})
            </button>
            <button
              onClick={reconcileAllUnreconciled}
              disabled={isReconciling()}
              style={{
                padding: '10px 16px',
                background: 'var(--bg-secondary)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                'border-radius': 'var(--radius)',
                cursor: 'pointer',
                'font-size': '14px',
                'font-weight': 500,
              }}
            >
              Mark All Unreconciled as Reconciled
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
