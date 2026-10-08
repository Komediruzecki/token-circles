/**
 * The month and year pickers name and select months on the person's calendar.
 *
 * A month was built as local midnight on the 1st and printed with toISOString(), which is the UTC
 * date: east of UTC that is the last day of the month before, so picking October in Zagreb asked
 * for 30 September to 30 October. And a stored '2026-10-01' was read back with new Date(), which
 * parses it as UTC midnight: west of UTC that is the evening of 30 September, so the picker showed
 * September for an October range.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FilterBar from '../FilterBar'

const hostZone = process.env.TZ
let host: HTMLDivElement | undefined
let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  host?.remove()
  if (hostZone === undefined) delete process.env.TZ
  else process.env.TZ = hostZone
})

function mount(dateRange: { from: string; to: string }) {
  const onChange = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <FilterBar
        categories={[]}
        tags={[]}
        selectedCategories={[]}
        selectedTags={[]}
        dateRange={dateRange}
        selectedPreset="custom"
        onChange={onChange}
      />
    ),
    host
  )
  const [monthSelect, yearSelect] = Array.from(host.querySelectorAll('select'))
  return { onChange, monthSelect: monthSelect!, yearSelect: yearSelect! }
}

describe('FilterBar month and year pickers', () => {
  it('east of UTC, picking October asks for 1 to 31 October', () => {
    process.env.TZ = 'Europe/Zagreb'
    const { onChange, monthSelect } = mount({ from: '2026-09-01', to: '2026-09-30' })
    monthSelect.value = '9'
    monthSelect.dispatchEvent(new Event('change', { bubbles: true }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0].dateRange).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })

  it('west of UTC, an October range shows October and 2026', () => {
    process.env.TZ = 'America/Los_Angeles'
    const { monthSelect, yearSelect } = mount({ from: '2026-10-01', to: '2026-10-31' })
    expect(monthSelect.value).toBe('9')
    expect(yearSelect.value).toBe('2026')
  })

  it('west of UTC, a range from 1 January is in the new year', () => {
    process.env.TZ = 'America/Los_Angeles'
    const { monthSelect, yearSelect } = mount({ from: '2027-01-01', to: '2027-01-31' })
    expect(monthSelect.value).toBe('0')
    expect(yearSelect.value).toBe('2027')
  })
})
