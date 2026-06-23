/**
 * BillCalendar — Monthly calendar view of bills
 *
 * GIVEN: A user is viewing the Bills page with the Calendar tab active
 * WHEN: The calendar loads
 * THEN: A monthly grid displays with day headers (Sun–Sat) and bill dots on due dates
 *
 * GIVEN: The user clicks a day with bills
 * WHEN: The day is selected
 * THEN: A popover/sidebar shows bill details for that day with mark-paid and edit actions
 *
 * GIVEN: The user is viewing a month
 * WHEN: They click the prev/next arrows
 * THEN: The calendar navigates to the previous/next month
 *
 * GIVEN: A bill is overdue
 * WHEN: The calendar renders
 * THEN: The bill dot shows in red (--danger color) with an overdue indicator
 */
import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import ConfirmButton from '../components/ConfirmButton'
import { formatCurrency, apiGet, apiPost, apiPut, apiDelete, showToast } from '../core/api'
import { useAppState } from '../core/appStore'
import styles from './BillCalendar.module.css'
import type { Component } from 'solid-js'

interface CalendarBill {
  id: number
  name: string
  amount: number
  frequency: string
  category_name?: string
  category_color?: string
  category_id?: number | null
  date: string
  paid: boolean
  type: 'bill' | 'subscription'
  is_overdue: boolean
}

interface CalendarDay {
  bills: CalendarBill[]
}

interface CalendarData {
  year: number
  month: number
  monthLabel: string
  firstDow: number
  days: Record<string, CalendarBill[]>
  summary: {
    totalAmount: number
    paidAmount: number
    billCount: number
  }
}

interface Category {
  id: number
  name: string
  type: 'expense' | 'income'
  color: string
}

interface BillCalendarProps {
  onRefresh?: () => void
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const BillCalendar: Component<BillCalendarProps> = (props) => {
  const state = useAppState()

  const [currentYear, setCurrentYear] = createSignal(new Date().getFullYear())
  const [currentMonth, setCurrentMonth] = createSignal(new Date().getMonth() + 1)
  const [selectedDay, setSelectedDay] = createSignal<number | null>(null)
  const [selectedBills, setSelectedBills] = createSignal<CalendarBill[]>([])
  const [markingPaid, setMarkingPaid] = createSignal(new Set<number>())
  const [popoverStyle, setPopoverStyle] = createSignal<Record<string, string>>({})

  const [calendarData, { refetch: refetchCalendar, mutate: mutateCalendar }] =
    createResource(
      () => ({ year: currentYear(), month: currentMonth(), v: state.profileVersion }),
      async ({ year, month }) => {
        const data = await apiGet<CalendarData>(
          `/api/bills/calendar?year=${year}&month=${month}`
        )
        return data
      }
    )

  const loading = () => calendarData.loading && !calendarData()

  const prevMonth = () => {
    if (currentMonth() === 1) {
      setCurrentMonth(12)
      setCurrentYear(currentYear() - 1)
    } else {
      setCurrentMonth(currentMonth() - 1)
    }
    setSelectedDay(null)
  }

  const nextMonth = () => {
    if (currentMonth() === 12) {
      setCurrentMonth(1)
      setCurrentYear(currentYear() + 1)
    } else {
      setCurrentMonth(currentMonth() + 1)
    }
    setSelectedDay(null)
  }

  const goToToday = () => {
    const now = new Date()
    setCurrentYear(now.getFullYear())
    setCurrentMonth(now.getMonth() + 1)
    setSelectedDay(null)
  }

  const daysArray = createMemo(() => {
    const data = calendarData()
    if (!data) return []
    const lastDay = new Date(data.year, data.month, 0).getDate()
    return Array.from({ length: lastDay }, (_, i) => i + 1)
  })

  const isToday = (day: number) => {
    const now = new Date()
    return (
      day === now.getDate() &&
      currentMonth() === now.getMonth() + 1 &&
      currentYear() === now.getFullYear()
    )
  }

  const hasOverdue = (bills: CalendarBill[]) => bills.some((b) => b.is_overdue)
  const hasUnpaid = (bills: CalendarBill[]) => bills.some((b) => !b.paid && !b.is_overdue)

  const selectDay = (day: number, bills: CalendarBill[], event?: MouseEvent) => {
    setSelectedDay(day)
    setSelectedBills(bills)

    // Position the popover near the click
    if (event) {
      const target = event.currentTarget as HTMLElement
      const rect = target.getBoundingClientRect()
      // Center the popover horizontally, position above/below based on viewport
      const popoverWidth = 320
      let left = rect.left + rect.width / 2 - popoverWidth / 2
      // Clamp to viewport
      if (left < 10) left = 10
      if (left + popoverWidth > window.innerWidth - 10)
        left = window.innerWidth - popoverWidth - 10

      // Position below the cell if room, otherwise above
      const top = rect.bottom + 8
      setPopoverStyle({
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        'max-width': `${popoverWidth}px`,
      })
    }
  }

  const closePopover = () => {
    setSelectedDay(null)
    setSelectedBills([])
  }

  // Mark a bill as paid from the calendar
  const markPaid = async (billId: number) => {
    setMarkingPaid(new Set([...markingPaid(), billId]))
    try {
      await apiPost(`/api/bills/${billId}/mark-paid`, {})
      showToast('Bill marked as paid', 'success')
      // Optimistic update in selected bills
      setSelectedBills((prev) => prev.map((b) => (b.id === billId ? { ...b, paid: true } : b)))
      // Refresh calendar data
      await refetchCalendar()
      props.onRefresh?.()
    } catch (err) {
      console.error('Failed to mark bill as paid:', err)
      showToast('Failed to mark bill as paid', 'error')
    } finally {
      const next = new Set(markingPaid())
      next.delete(billId)
      setMarkingPaid(next)
    }
  }

  // Format date for display
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  // Day status class
  const dayStatusClass = (bills: CalendarBill[]): string => {
    if (!bills.length) return ''
    if (hasOverdue(bills)) return styles.dayOverdue
    if (bills.every((b) => b.paid)) return styles.dayAllPaid
    return styles.dayUpcoming
  }

  return (
    <div class={styles.calendarWrap}>
      {/* Month header */}
      <div class={styles.monthHeader}>
        <button class={styles.navBtn} onClick={prevMonth} title="Previous month">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div class={styles.monthLabelGroup}>
          <h2 class={styles.monthLabel}>{calendarData()?.monthLabel || ''}</h2>
          <button class={styles.todayBtn} onClick={goToToday}>
            Today
          </button>
        </div>
        <button class={styles.navBtn} onClick={nextMonth} title="Next month">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Summary bar */}
      <Show when={calendarData()}>
        <div class={styles.calSummary}>
          <div class={styles.calSummaryItem}>
            <span class={styles.calSummaryLabel}>Bills</span>
            <span class={styles.calSummaryValue}>{calendarData()!.summary.billCount}</span>
          </div>
          <div class={styles.calSummaryItem}>
            <span class={styles.calSummaryLabel}>Total</span>
            <span class={styles.calSummaryValue}>{formatCurrency(calendarData()!.summary.totalAmount)}</span>
          </div>
          <div class={styles.calSummaryItem}>
            <span class={styles.calSummaryLabel}>Paid</span>
            <span class={`${styles.calSummaryValue} ${styles.calSummaryPaid}`}>
              {formatCurrency(calendarData()!.summary.paidAmount)}
            </span>
          </div>
        </div>
      </Show>

      {/* Loading state */}
      <Show when={loading()}>
        <div class={styles.loadingState}>Loading calendar...</div>
      </Show>

      {/* Calendar grid */}
      <Show when={calendarData()}>
        <div class={styles.calendarGrid}>
          {/* Day headers */}
          <For each={WEEKDAYS}>
            {(day) => <div class={styles.dayHeader}>{day}</div>}
          </For>

          {/* Empty cells before first day of month */}
          {Array.from({ length: calendarData()!.firstDow }, (_, i) => (
            <div class={`${styles.dayCell} ${styles.dayEmpty}`} />
          ))}

          {/* Day cells */}
          <For each={daysArray()}>
            {(day) => {
              const bills: CalendarBill[] = calendarData()!.days[String(day)] || []
              return (
                <div
                  class={`${styles.dayCell} ${dayStatusClass(bills)} ${
                    isToday(day) ? styles.today : ''
                  } ${selectedDay() === day ? styles.daySelected : ''} ${
                    bills.length > 0 ? styles.hasBills : ''
                  }`}
                  onClick={(e) => bills.length > 0 && selectDay(day, bills, e)}
                  role={bills.length > 0 ? 'button' : undefined}
                  tabIndex={bills.length > 0 ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && bills.length > 0) selectDay(day, bills)
                  }}
                >
                  <span class={styles.dayNumber}>{day}</span>
                  {bills.length > 0 && (
                    <div class={styles.billDots}>
                      <For each={bills.slice(0, 4)}>
                        {(bill) => (
                          <span
                            class={`${styles.billDot} ${
                              bill.paid
                                ? styles.dotPaid
                                : bill.is_overdue
                                  ? styles.dotOverdue
                                  : styles.dotUpcoming
                            }`}
                            style={
                              bill.category_color
                                ? { 'background-color': bill.paid ? undefined : bill.category_color }
                                : undefined
                            }
                            title={bill.name}
                          />
                        )}
                      </For>
                      {bills.length > 4 && (
                        <span class={styles.moreBills}>+{bills.length - 4}</span>
                      )}
                    </div>
                  )}
                </div>
              )
            }}
          </For>
        </div>
      </Show>

      {/* Day detail popover */}
      <Show when={selectedDay() !== null && selectedBills().length > 0}>
        <div class={styles.popoverBackdrop} onClick={closePopover} />
        <div class={styles.popover} style={popoverStyle()}>
          <div class={styles.popoverHeader}>
            <h3 class={styles.popoverTitle}>
              {calendarData() &&
                formatDate(
                  `${calendarData()!.year}-${String(calendarData()!.month).padStart(2, '0')}-${String(selectedDay()).padStart(2, '0')}`
                )}
            </h3>
            <button class={styles.popoverClose} onClick={closePopover}>
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class={styles.popoverBody}>
            <For each={selectedBills()}>
              {(bill) => (
                <div
                  class={`${styles.popoverBill} ${
                    bill.is_overdue ? styles.popoverBillOverdue : bill.paid ? styles.popoverBillPaid : ''
                  }`}
                >
                  <div class={styles.popoverBillLeft}>
                    {bill.category_color && (
                      <span
                        class={styles.popoverBillColor}
                        style={{ 'background-color': bill.category_color }}
                      />
                    )}
                    <div class={styles.popoverBillInfo}>
                      <span class={styles.popoverBillName}>{bill.name}</span>
                      <span class={styles.popoverBillMeta}>
                        {bill.frequency === 'monthly'
                          ? 'Monthly'
                          : bill.frequency === 'weekly'
                            ? 'Weekly'
                            : bill.frequency === 'biweekly'
                              ? 'Biweekly'
                              : bill.frequency}
                        {bill.category_name && ` • ${bill.category_name}`}
                        {bill.paid && ' • Paid'}
                        {bill.is_overdue && !bill.paid && ' • Overdue'}
                      </span>
                    </div>
                  </div>
                  <div class={styles.popoverBillRight}>
                    <span
                      class={`${styles.popoverBillAmount} ${
                        bill.is_overdue && !bill.paid ? styles.amountOverdue : ''
                      }`}
                    >
                      {formatCurrency(bill.amount)}
                    </span>
                    {!bill.paid && (
                      <button
                        class={styles.popoverMarkPaid}
                        onClick={() => markPaid(bill.id)}
                        disabled={markingPaid().has(bill.id)}
                      >
                        {markingPaid().has(bill.id) ? '...' : 'Pay'}
                      </button>
                    )}
                    {bill.paid && <span class={styles.popoverPaidCheck}>✓</span>}
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

export default BillCalendar
export type { CalendarBill, CalendarData }
