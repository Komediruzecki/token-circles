/**
 * CalcTracer — developer-mode calculation trace modal.
 *
 * Clicking an instrumented metric card opens this modal showing the formula, the
 * inputs that went into it, and (optionally) the contributing rows, so any number
 * on the Dashboard/Analytics can be audited against the raw data.
 *
 * Enabled in dev builds automatically, or in production by setting
 * localStorage.devCalcTracer = '1' (power-user/debug switch, no UI for it).
 */
import { For, Show } from 'solid-js'

export interface CalcTrace {
  title: string
  formula: string
  inputs: Array<{ label: string; value: string | number }>
  rows?: { columns: string[]; data: Array<Array<string | number>> }
  note?: string
}

export function isCalcTracerEnabled(): boolean {
  try {
    return import.meta.env.DEV || localStorage.getItem('devCalcTracer') === '1'
  } catch {
    return false
  }
}

interface CalcTracerProps {
  trace: CalcTrace | null
  onClose: () => void
}

export default function CalcTracer(props: CalcTracerProps) {
  return (
    <Show when={props.trace}>
      <div
        style={{
          position: 'fixed',
          inset: '0',
          background: 'rgba(0,0,0,0.5)',
          'z-index': '1000',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '16px',
        }}
        onClick={() => {
          props.onClose()
        }}
      >
        <div
          style={{
            background: 'var(--card-bg, var(--bg-secondary))',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            'border-radius': '12px',
            'max-width': '640px',
            width: '100%',
            'max-height': '80vh',
            overflow: 'auto',
            padding: '20px',
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
              'margin-bottom': '12px',
            }}
          >
            <h3 style={{ margin: '0', 'font-size': '16px' }}>
              Calculation trace: {props.trace!.title}
            </h3>
            <button
              onClick={() => {
                props.onClose()
              }}
              aria-label="Close calculation trace"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '4px',
                display: 'inline-flex',
              }}
            >
              <svg
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
              >
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div
            style={{
              'font-family': 'monospace',
              'font-size': '13px',
              background: 'var(--bg-secondary, rgba(127,127,127,0.08))',
              border: '1px solid var(--border)',
              'border-radius': '8px',
              padding: '10px 12px',
              'margin-bottom': '14px',
              'overflow-x': 'auto',
              'white-space': 'pre-wrap',
            }}
          >
            {props.trace!.formula}
          </div>

          <div
            style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '14px', 'margin-bottom': '14px' }}
          >
            <For each={props.trace!.inputs}>
              {(inp) => (
                <div>
                  <div style={{ 'font-size': '11px', color: 'var(--text-secondary)' }}>
                    {inp.label}
                  </div>
                  <div style={{ 'font-size': '14px', 'font-weight': '600' }}>{inp.value}</div>
                </div>
              )}
            </For>
          </div>

          <Show when={props.trace!.rows && props.trace!.rows.data.length > 0}>
            <div style={{ 'overflow-x': 'auto' }}>
              <table style={{ width: '100%', 'border-collapse': 'collapse', 'font-size': '13px' }}>
                <thead>
                  <tr>
                    <For each={props.trace!.rows!.columns}>
                      {(col) => (
                        <th
                          style={{
                            'text-align': 'left',
                            padding: '6px 8px',
                            'border-bottom': '1px solid var(--border)',
                            color: 'var(--text-secondary)',
                            'font-weight': '600',
                          }}
                        >
                          {col}
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={props.trace!.rows!.data}>
                    {(row) => (
                      <tr>
                        <For each={row}>
                          {(cell) => (
                            <td
                              style={{
                                padding: '6px 8px',
                                'border-bottom': '1px solid var(--border)',
                              }}
                            >
                              {cell}
                            </td>
                          )}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>

          <Show when={props.trace!.note}>
            <div
              style={{ 'font-size': '12px', color: 'var(--text-secondary)', 'margin-top': '12px' }}
            >
              {props.trace!.note}
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}
