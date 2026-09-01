/**
 * Centralized Logging System
 * Logs to both console and localStorage so you can view logs on mobile devices
 * where console access is limited
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  details?: unknown
  component?: string
}

const STORAGE_KEY = 'app_logs'
const MAX_LOGS = 500

// In-memory buffer for logs
let logBuffer: LogEntry[] = []
let isInitialized = false

/**
 * Get all logs from localStorage
 */
function getLogsFromStorage(): LogEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch {
    // Storage might be disabled or corrupted
  }
  return []
}

/**
 * Save logs to localStorage
 */
function saveLogsToStorage(logs: LogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs))
  } catch {
    // Ignore storage errors
  }
}

/**
 * Create a log entry
 */
function createLogEntry(
  level: LogLevel,
  message: string,
  details?: unknown,
  component?: string
): LogEntry {
  const timestamp = new Date().toISOString()
  return { timestamp, level, message, details, component }
}

/**
 * Add a log entry to both buffer and storage
 */
function addLogEntry(entry: LogEntry): void {
  logBuffer.push(entry)

  // Periodically flush to storage (every 10 logs or on error)
  if (entry.level === 'error' || logBuffer.length >= MAX_LOGS || logBuffer.length % 10 === 0) {
    flushLogs()
  }
}

/**
 * Whether an entry reaches the browser console.
 *
 * The console belongs to the person using the app, not to us, so a production build writes
 * nothing to it — `error` used to be exempt from every gate and printed unconditionally. Stored
 * logs are the supported way to inspect a problem: the LogViewer in Settings > About reads them,
 * and nothing here affects what gets recorded.
 *
 * Development keeps the usual feedback loop for the levels worth interrupting on, and `debugMode`
 * is the escape hatch that turns everything back on in any build — so chasing a production report
 * is "enable debug mode, reproduce, send the log", not a special build.
 */
function shouldWriteToConsole(level: LogLevel): boolean {
  if (isDebugMode()) return true
  if (!import.meta.env.DEV) return false
  return level === 'warn' || level === 'error'
}

/**
 * Write a log entry to the console. Called once per entry, by log(), as it happens — never over
 * stored history (see flushLogs).
 */
function writeLogToConsole(entry: LogEntry): void {
  if (!shouldWriteToConsole(entry.level)) return

  const { timestamp, level, message, details } = entry
  const timestampFmt = new Date(timestamp).toLocaleTimeString()
  const line = `[${timestampFmt}] [${level.toUpperCase()}] ${message}`

  switch (level) {
    case 'debug':
    case 'info':
      console.info(line, details ?? '')
      break
    case 'warn':
      console.warn(line, details ?? '')
      break
    case 'error':
      console.error(line, details ?? '')
      break
  }
}

/**
 * Check if debug mode is enabled
 */
function isDebugMode(): boolean {
  try {
    return localStorage.getItem('debugMode') === 'true'
  } catch {
    return false
  }
}

/**
 * Flush logs to localStorage.
 *
 * Persistence only — the console is written by log(), once per entry, as it happens. This used to
 * end with `trimmedLogs.forEach(writeLogToConsole)`, which re-emitted the ENTIRE stored history on
 * every flush, and initLogging() flushes on boot: each reload dumped up to MAX_LOGS past errors,
 * timestamped hours apart but arriving in one burst under the flush's own stack. That is
 * indistinguishable from the app failing those requests right now, and reloading only reprints it.
 */
function flushLogs(): void {
  try {
    const allLogs = getLogsFromStorage()
    const newLogs = logBuffer.concat(allLogs)

    // Sort by timestamp (newest first)
    newLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    // Keep only the last MAX_LOGS
    const trimmedLogs = newLogs.slice(0, MAX_LOGS)

    saveLogsToStorage(trimmedLogs)

    // Clear buffer
    logBuffer = []
  } catch {
    // Ignore errors
  }
}

/**
 * Clear all logs
 */
function clearLogs(): void {
  logBuffer = []
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Get filtered logs
 */
function getLogs(
  filter?: {
    level?: LogLevel[]
    component?: string
    startDate?: string
    endDate?: string
  },
  limit?: number
): LogEntry[] {
  let logs = getLogsFromStorage()

  if (filter?.level && filter.level.length > 0) {
    logs = logs.filter((log) => filter.level!.includes(log.level))
  }

  if (filter?.component) {
    logs = logs.filter((log) => log.component === filter.component)
  }

  if (filter?.startDate) {
    logs = logs.filter((log) => new Date(log.timestamp) >= new Date(filter.startDate!))
  }

  if (filter?.endDate) {
    logs = logs.filter((log) => new Date(log.timestamp) <= new Date(filter.endDate!))
  }

  if (limit) {
    logs = logs.slice(0, limit)
  }

  return logs
}

/**
 * Get log statistics
 */
function getLogStats(): {
  total: number
  errors: number
  warnings: number
  infos: number
  debugs: number
  last24h: number
  last7d: number
} {
  const logs = getLogsFromStorage()

  const errorLogs = logs.filter((log) => log.level === 'error')
  const warnLogs = logs.filter((log) => log.level === 'warn')
  const infoLogs = logs.filter((log) => log.level === 'info')
  const debugLogs = logs.filter((log) => log.level === 'debug')

  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const last24h = logs.filter((log) => new Date(log.timestamp) >= yesterday).length

  const last7d = logs.filter((log) => new Date(log.timestamp) >= weekAgo).length

  return {
    total: logs.length,
    errors: errorLogs.length,
    warnings: warnLogs.length,
    infos: infoLogs.length,
    debugs: debugLogs.length,
    last24h,
    last7d,
  }
}

// ============ PUBLIC API ============

/**
 * Initialize logging system
 */
export function initLogging(): void {
  if (isInitialized) return
  isInitialized = true

  // Do NOT preload stored logs into logBuffer: flushLogs() merges the buffer WITH the stored logs,
  // so seeding the buffer from storage duplicated every log on each page load (the buffer is only
  // meant to hold NEW, un-flushed entries).
  log('info', 'Logging system initialized')
  flushLogs()
}

/**
 * Add a log entry
 */
export function log(level: LogLevel, message: string, details?: unknown, component?: string): void {
  const entry = createLogEntry(level, message, details, component)
  addLogEntry(entry)
  writeLogToConsole(entry)
}

/**
 * Debug log
 */
export function debug(message: string, details?: unknown, component?: string): void {
  log('debug', message, details, component)
}

/**
 * Info log
 */
export function info(message: string, details?: unknown, component?: string): void {
  log('info', message, details, component)
}

/**
 * Warning log
 */
export function warn(message: string, details?: unknown, component?: string): void {
  log('warn', message, details, component)
}

/**
 * Error log
 */
export function error(message: string, details?: unknown, component?: string): void {
  log('error', message, details, component)
}

/**
 * Error with full stack trace
 */
export function errorWithStack(message: string, error: unknown, component?: string): void {
  let details: Record<string, unknown> = { message }

  if (error instanceof Error) {
    details = {
      message: error.message,
      stack: error.stack,
      name: error.name,
    }
  } else if (typeof error === 'object' && error !== null) {
    details = error as Record<string, unknown>
  }

  log('error', message, details, component)
}

/**
 * Set debug mode
 */
export function setDebugMode(enabled: boolean): void {
  try {
    localStorage.setItem('debugMode', enabled ? 'true' : 'false')
    log('info', `Debug mode ${enabled ? 'enabled' : 'disabled'}`)
  } catch {
    // Ignore errors
  }
}

/**
 * Check debug mode status
 */
export function isDebugging(): boolean {
  return isDebugMode()
}

// Export all utility functions
export const logger = {
  init: initLogging,
  log,
  debug,
  info,
  warn,
  error,
  errorWithStack,
  clear: clearLogs,
  getLogs,
  getStats: getLogStats,
  setDebugMode,
  isDebugMode: isDebugging,
}
