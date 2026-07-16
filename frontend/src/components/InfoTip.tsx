/**
 * InfoTip — small circled-i hint icon with a native tooltip.
 * Used next to aggregate numbers so every stat can state its formula and
 * time window (hover on desktop; aria-label for screen readers).
 */
interface InfoTipProps {
  text: string
  testId?: string
}

export default function InfoTip(props: InfoTipProps) {
  return (
    <span
      title={props.text}
      aria-label={props.text}
      data-test-id={props.testId}
      role="img"
      style={{
        display: 'inline-flex',
        'align-items': 'center',
        'margin-left': '4px',
        color: 'var(--text-secondary)',
        cursor: 'help',
        'vertical-align': 'middle',
        opacity: 0.75,
      }}
    >
      <svg
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="12" r="10" />
        <path stroke-linecap="round" d="M12 16v-4m0-4h.01" />
      </svg>
    </span>
  )
}
