/**
 * Log Viewer Component
 * Displays application logs stored in localStorage
 * Accessible from Settings page
 */

import { createSignal, For, onMount, Show } from 'solid-js'
import { logger } from '../core/logger'
import ConfirmButton from './ConfirmButton'
import css from './LogViewer.module.css'
import type { LogEntry, LogLevel } from '../core/logger'

export function LogViewer() {
  const [logs, setLogs] = createSignal<LogEntry[]>([])
  const [filteredLogs, _setFilteredLogs] = createSignal<LogEntry[]>([])
  const [searchTerm, setSearchTerm] = createSignal('')
  const [levelFilter, setLevelFilter] = createSignal<LogLevel[]>([])
  const [componentFilter, setComponentFilter] = createSignal<string>('')
  const [showDetails, setShowDetails] = createSignal(false)
  const [stats, setStats] = createSignal(logger.getStats())
  const [debugMode, setDebugMode] = createSignal(false)
  const [_expandCount, setExpandCount] = createSignal(10)

  const levels = [
    { value: 'error' as LogLevel, label: 'Error', color: '#ef4444' },
    { value: 'warn' as LogLevel, label: 'Warning', color: '#f59e0b' },
    { value: 'info' as LogLevel, label: 'Info', color: '#3b82f6' },
    { value: 'debug' as LogLevel, label: 'Debug', color: '#6b7280' },
  ] as const

  const refreshLogs = () => {
    setLogs(logger.getLogs())
    setStats(logger.getStats())
  }

  const clearLogs = () => {
    logger.clear()
    refreshLogs()
  }

  const toggleDebugMode = () => {
    setDebugMode(!debugMode())
    logger.setDebugMode(!debugMode())
    refreshLogs()
  }

  const exportLogs = () => {
    const logData = logs()
      .map((log) => `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n')

    const blob = new Blob([logData], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `app-logs-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const getFilteredLogs = () => {
    let result = logs()

    if (searchTerm()) {
      const term = searchTerm().toLowerCase()
      result = result.filter(
        (log) =>
          log.message.toLowerCase().includes(term) ||
          log.component?.toLowerCase().includes(term) ||
          JSON.stringify(log.details).toLowerCase().includes(term)
      )
    }

    if (levelFilter().length > 0) {
      result = result.filter((log) => levelFilter().includes(log.level))
    }

    if (componentFilter()) {
      result = result.filter((log) => log.component === componentFilter())
    }

    return result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }

  onMount(() => {
    refreshLogs()
    try {
      setDebugMode(localStorage.getItem('debugMode') === 'true')
    } catch {
      // Ignore
    }
  })

  const filtered = getFilteredLogs()
  const allComponents = Array.from(
    new Set(
      logs()
        .map((l) => l.component)
        .filter(Boolean) as string[]
    )
  ).sort()

  return (
    <div class={css.container}>
      <div class={css.header}>
        <h2>Log Viewer</h2>
        <div class={css.actions}>
          <button class={css.btn} onClick={refreshLogs}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Refresh
          </button>
          <button class={css.btn} onClick={exportLogs}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          </button>
          <ConfirmButton
            class={css.btn}
            onConfirm={clearLogs}
            label={
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Clear
              </>
            }
          />
          <button
            class={css.btn}
            onClick={toggleDebugMode}
            style={{ color: debugMode() ? 'var(--primary)' : undefined }}
          >
            {debugMode() ? 'Debug: ON' : 'Debug: OFF'}
          </button>
        </div>
      </div>

      <div class={css.stats}>
        <div class={css.stat}>
          <span class={css.statLabel}>Total</span>
          <span class={css.statValue}>{stats().total}</span>
        </div>
        <div class={css.stat}>
          <span class={css.statLabel}>Errors</span>
          <span class={css.statValue} style={{ color: '#ef4444' }}>
            {stats().errors}
          </span>
        </div>
        <div class={css.stat}>
          <span class={css.statLabel}>Warnings</span>
          <span class={css.statValue} style={{ color: '#f59e0b' }}>
            {stats().warnings}
          </span>
        </div>
        <div class={css.stat}>
          <span class={css.statLabel}>Last 24h</span>
          <span class={css.statValue}>{stats().last24h}</span>
        </div>
        <div class={css.stat}>
          <span class={css.statLabel}>Last 7d</span>
          <span class={css.statValue}>{stats().last7d}</span>
        </div>
      </div>

      <div class={css.filters}>
        <input
          type="text"
          class={css.searchInput}
          placeholder="Search logs..."
          value={searchTerm()}
          onInput={(e) => setSearchTerm(e.target.value)}
        />
        <select
          class={css.select}
          value={componentFilter()}
          onChange={(e) => setComponentFilter(e.target.value)}
        >
          <option value="">All Components</option>
          <For each={allComponents}>{(comp) => <option value={comp}>{comp}</option>}</For>
        </select>
      </div>

      <div class={css.levelFilters}>
        <For each={levels}>
          {(level) => (
            <button
              class={`${css.levelBtn} ${levelFilter().includes(level.value) ? css.active : ''}`}
              style={{ border: `1px solid ${level.color}` }}
              onClick={() => {
                const newFilter = levelFilter().includes(level.value)
                  ? levelFilter().filter((l) => l !== level.value)
                  : [...levelFilter(), level.value]
                setLevelFilter(newFilter)
              }}
            >
              <span
                style={
                  {
                    width: '8px',
                    height: '8px',
                    'border-radius': '50%',
                    background: level.color,
                  } as Record<string, string>
                }
              />
              {level.label}
              {levelFilter().includes(level.value) &&
                `(${filteredLogs().filter((l) => l.level === level.value).length})`}
            </button>
          )}
        </For>
      </div>

      <div class={css.logContainer}>
        <div class={css.table}>
          <div class={css.tableHeader}>
            <div class={css.colTime}>Time</div>
            <div class={css.colLevel}>Level</div>
            <div class={css.colComponent}>Component</div>
            <div class={css.colMessage}>Message</div>
            <div class={css.colAction}></div>
          </div>
          <div class={css.tableBody}>
            <For each={filtered}>
              {(log) => (
                <div class={`${css.row} ${log.level}`}>
                  <div class={css.colTime}>
                    <div class={css.timeText}>{new Date(log.timestamp).toLocaleTimeString()}</div>
                    <div class={css.dateText}>{new Date(log.timestamp).toLocaleDateString()}</div>
                  </div>
                  <div class={css.colLevel}>
                    <span
                      class={css.levelBadge}
                      style={{ background: levels.find((l) => l.value === log.level)?.color }}
                    >
                      {log.level.toUpperCase()}
                    </span>
                  </div>
                  <div class={css.colComponent}>
                    {log.component || <span class={css.emptyComponent}>-</span>}
                  </div>
                  <div class={css.colMessage}>
                    {showDetails() && log.details ? (
                      <pre class={css.details}>{JSON.stringify(log.details, null, 2)}</pre>
                    ) : (
                      log.message
                    )}
                  </div>
                  <div class={css.colAction}>
                    <button
                      class={css.viewBtn}
                      onClick={() => {
                        setShowDetails(!showDetails())
                      }}
                    >
                      {showDetails() ? 'Hide' : 'Details'}
                    </button>
                  </div>
                </div>
              )}
            </For>

            <Show when={filtered.length === 0}>
              <div class={css.empty}>
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <p>No logs found</p>
              </div>
            </Show>
          </div>
        </div>
      </div>

      <div class={css.footer}>
        <span class={css.count}>
          Showing {filtered.length} of {logs().length} logs
        </span>
        <button class={css.btnSecondary} onClick={() => setExpandCount((c) => c + 10)}>
          Show more
        </button>
      </div>
    </div>
  )
}
