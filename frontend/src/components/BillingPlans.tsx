import { createSignal, For, onMount, Show } from 'solid-js'

// Renders the plan catalogue from the worker's GET /api/plans (single source of truth = plans.ts)
// so the comparison can never drift from what the worker enforces. Server-mode only.
const API = (import.meta.env.VITE_API_URL ?? '') as string

interface PlanDef {
  id: string
  name: string
  monthlyPriceUsd: number
  annualPriceUsd: number
  limits: {
    receiptsPerProfile: number | null
    remindersPerMonth: number | null
    profiles: number | null
  }
  features: {
    cloudSync: boolean
    emailReminders: boolean
    receipts: boolean
    advancedReports: boolean
  }
}

const RECOMMENDED = 'advanced'

function CheckIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      style={{ color: 'var(--primary, #4f46e5)', 'flex-shrink': 0 }}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function DashIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      style={{ color: 'var(--text-secondary)', opacity: 0.5, 'flex-shrink': 0 }}
    >
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export default function BillingPlans(props: {
  currentPlan: () => string
  configured: () => boolean
  availablePlans: () => string[]
  // The CTA currently mid-redirect ('manage' or a plan id), or null. Only that button shows
  // "Redirecting…"; the rest just disable to prevent a double-click.
  busyKey: () => string | null
  onUpgrade: (planId: string, interval: 'monthly' | 'annual') => void
  onManage: () => void
}) {
  const [plans, setPlans] = createSignal<PlanDef[]>([])
  const [notices, setNotices] = createSignal<{ beta?: string; fairUse?: string }>({})
  const [interval, setInterval] = createSignal<'monthly' | 'annual'>('monthly')

  onMount(async () => {
    try {
      const res = await fetch(`${API}/api/plans`)
      const data = await res.json()
      setPlans(data.plans ?? [])
      setNotices(data.notices ?? {})
    } catch {
      /* leave empty — the card just won't render tiers */
    }
  })

  // The billing status stores 'premium' (single price) → it maps to the 'advanced' tier.
  const currentId = () => {
    const p = props.currentPlan()
    return p === 'premium' ? 'advanced' : p || 'free'
  }
  const isCurrent = (id: string) => currentId() === id

  const fmt = (n: number | null) =>
    n === null ? 'Unlimited' : n === 0 ? '—' : n.toLocaleString('en-US')

  const row = (on: boolean, label: string) => (
    <div style={{ display: 'flex', 'align-items': 'center', gap: '7px', margin: '5px 0' }}>
      {on ? <CheckIcon /> : <DashIcon />}
      <span style={{ 'font-size': '13px', color: on ? 'var(--text)' : 'var(--text-secondary)' }}>
        {label}
      </span>
    </div>
  )

  return (
    <div>
      {/* Monthly / annual toggle */}
      <div style={{ display: 'flex', 'align-items': 'center', gap: '10px', margin: '4px 0 16px' }}>
        <div
          style={{
            display: 'inline-flex',
            background: 'var(--bg, #0b0e14)',
            border: '1px solid var(--border, rgba(255,255,255,0.12))',
            'border-radius': '999px',
            padding: '3px',
          }}
        >
          <For each={['monthly', 'annual'] as const}>
            {(opt) => (
              <button
                type="button"
                onClick={() => setInterval(opt)}
                style={{
                  border: 'none',
                  cursor: 'pointer',
                  padding: '6px 14px',
                  'border-radius': '999px',
                  'font-size': '13px',
                  'font-weight': interval() === opt ? 600 : 400,
                  background: interval() === opt ? 'var(--primary)' : 'transparent',
                  color: interval() === opt ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {opt === 'monthly' ? 'Monthly' : 'Annual'}
              </button>
            )}
          </For>
        </div>
        <Show when={interval() === 'annual'}>
          <span style={{ 'font-size': '12px', color: 'var(--primary)' }}>≈ 2 months free</span>
        </Show>
      </div>

      {/* Tier grid */}
      <div
        style={{
          display: 'grid',
          'grid-template-columns': 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px',
        }}
      >
        <For each={plans()}>
          {(p) => {
            const recommended = p.id === RECOMMENDED
            const mine = isCurrent(p.id)
            const price = () => (interval() === 'annual' ? p.annualPriceUsd : p.monthlyPriceUsd)
            const per = () => (interval() === 'annual' ? '/yr' : '/mo')
            return (
              <div
                style={{
                  position: 'relative',
                  border: `1px solid ${recommended ? 'var(--primary)' : 'var(--border, rgba(255,255,255,0.12))'}`,
                  'border-radius': '12px',
                  padding: '16px',
                  background: 'var(--bg, #0b0e14)',
                  display: 'flex',
                  'flex-direction': 'column',
                }}
              >
                <Show when={recommended}>
                  <span
                    style={{
                      position: 'absolute',
                      top: '-9px',
                      left: '16px',
                      background: 'var(--primary)',
                      color: '#fff',
                      'font-size': '10px',
                      'font-weight': 700,
                      'letter-spacing': '0.04em',
                      'text-transform': 'uppercase',
                      padding: '2px 8px',
                      'border-radius': '999px',
                    }}
                  >
                    Recommended
                  </span>
                </Show>

                <div style={{ 'font-size': '15px', 'font-weight': 600, color: 'var(--text)' }}>
                  {p.name}
                </div>
                <div style={{ margin: '6px 0 12px' }}>
                  <span style={{ 'font-size': '24px', 'font-weight': 700, color: 'var(--text)' }}>
                    {price() === 0 ? 'Free' : `$${price()}`}
                  </span>
                  <Show when={price() !== 0}>
                    <span style={{ 'font-size': '13px', color: 'var(--text-secondary)' }}>
                      {per()}
                    </span>
                  </Show>
                </div>

                <div style={{ flex: 1 }}>
                  {row(
                    p.limits.profiles !== 0,
                    p.limits.profiles === null
                      ? 'Unlimited profiles'
                      : `${p.limits.profiles} profile${p.limits.profiles === 1 ? '' : 's'}`
                  )}
                  {row(p.features.cloudSync, 'Cloud sync')}
                  {row(
                    p.features.emailReminders,
                    p.features.emailReminders
                      ? `Email reminders (${fmt(p.limits.remindersPerMonth)}/mo)`
                      : 'Email reminders'
                  )}
                  {row(
                    p.features.receipts,
                    p.features.receipts
                      ? `Receipt storage (${fmt(p.limits.receiptsPerProfile)})`
                      : 'Receipt storage'
                  )}
                  {row(p.features.advancedReports, 'Advanced reports (tax & P&L)')}
                </div>

                {/* CTA */}
                <div style={{ 'margin-top': '14px' }}>
                  <Show when={mine}>
                    <Show
                      when={p.id !== 'free'}
                      fallback={
                        <div
                          style={{
                            'text-align': 'center',
                            'font-size': '13px',
                            'font-weight': 600,
                            color: 'var(--text-secondary)',
                            padding: '8px',
                          }}
                        >
                          Current plan
                        </div>
                      }
                    >
                      <button
                        type="button"
                        onClick={props.onManage}
                        disabled={props.busyKey() !== null}
                        style={ctaStyle(false)}
                      >
                        {props.busyKey() === 'manage' ? 'Redirecting…' : 'Manage billing'}
                      </button>
                    </Show>
                  </Show>
                  <Show when={!mine && p.id !== 'free'}>
                    <button
                      type="button"
                      onClick={() => {
                        props.onUpgrade(p.id, interval())
                      }}
                      disabled={
                        props.busyKey() !== null ||
                        !props.configured() ||
                        !props.availablePlans().includes(p.id)
                      }
                      style={ctaStyle(recommended)}
                    >
                      {props.busyKey() === p.id
                        ? 'Redirecting…'
                        : props.configured() && props.availablePlans().includes(p.id)
                          ? 'Upgrade'
                          : 'Coming soon'}
                    </button>
                  </Show>
                </div>
              </div>
            )
          }}
        </For>
      </div>

      <Show when={!props.configured()}>
        <p style={{ 'font-size': '12px', color: 'var(--text-secondary)', margin: '14px 0 0' }}>
          Billing isn't configured on the server yet — upgrade is disabled.
        </p>
      </Show>
      <p style={{ 'font-size': '12px', color: 'var(--text-secondary)', margin: '10px 0 0' }}>
        {notices().beta} {notices().fairUse}
      </p>
    </div>
  )
}

function ctaStyle(primary: boolean) {
  return {
    width: '100%',
    'justify-content': 'center',
    padding: '8px 12px',
    'border-radius': '8px',
    'font-size': '13px',
    'font-weight': 600,
    cursor: 'pointer',
    border: primary ? 'none' : '1px solid var(--border, rgba(255,255,255,0.16))',
    background: primary ? 'var(--primary)' : 'transparent',
    color: primary ? '#fff' : 'var(--text)',
  } as const
}
