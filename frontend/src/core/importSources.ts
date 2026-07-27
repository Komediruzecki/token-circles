/**
 * Client for saved import sources ("Connected Sources"). Talks to /api/import-sources, which
 * apiFetch routes either to the Cloudflare Worker (self-hosted/cloud) or the in-process
 * IndexedDB router (serverless) — so this one module works in both runtimes.
 *
 * A source is a saved, re-runnable import origin. v1 is a Google-Sheet link; the same shape
 * carries a Drive folder or bank-aggregator connection later. The column mapping is stored BY
 * HEADER NAME (see importMapping.ts) so it survives column reordering.
 */
import { apiFetch } from './apiFetch'

export type SourceKind = 'google_sheet' | 'google_drive_folder' | 'bank_aggregator'
export type SourceSchedule = 'manual' | 'on_open' | 'daily'

export interface ImportSource {
  id: number
  profile_id: number
  kind: SourceKind
  label: string
  config: { url?: string; sheetName?: string; [k: string]: unknown }
  mapping?: Record<string, string> | null
  category_types?: Record<string, 'income' | 'expense' | 'account'> | null
  default_account_id?: number | null
  schedule: SourceSchedule
  last_synced_at?: string | null
  last_cursor?: string | null
  created_at?: string
  updated_at?: string
}

export type ImportSourceInput = Partial<
  Omit<ImportSource, 'id' | 'profile_id' | 'created_at' | 'updated_at'>
>

function profileHeaders(): Record<string, string> {
  const pid = localStorage.getItem('currentProfileId') || '1'
  return { 'X-Profile-Id': pid }
}

export async function listImportSources(): Promise<ImportSource[]> {
  const res = await apiFetch('/api/import-sources', { headers: profileHeaders() })
  if (!res.ok) return []
  const rows = await res.json()
  return Array.isArray(rows) ? (rows as ImportSource[]) : []
}

export async function createImportSource(input: ImportSourceInput): Promise<ImportSource | null> {
  const res = await apiFetch('/api/import-sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...profileHeaders() },
    body: JSON.stringify(input),
  })
  if (!res.ok) return null
  return (await res.json()) as ImportSource
}

export async function updateImportSource(
  id: number,
  patch: ImportSourceInput
): Promise<ImportSource | null> {
  const res = await apiFetch(`/api/import-sources/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...profileHeaders() },
    body: JSON.stringify(patch),
  })
  if (!res.ok) return null
  return (await res.json()) as ImportSource
}

export async function deleteImportSource(id: number): Promise<boolean> {
  const res = await apiFetch(`/api/import-sources/${id}`, {
    method: 'DELETE',
    headers: profileHeaders(),
  })
  return res.ok
}

/**
 * Extract the spreadsheet id + gid from a Google Sheets URL — used to label a saved source and
 * to detect when the user re-adds a sheet they've already saved. Returns nulls when absent.
 */
export function parseSheetUrl(url: string): { id: string | null; gid: string | null } {
  const id = url.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? null
  const gid = url.match(/[?&#]gid=(\d+)/)?.[1] ?? null
  return { id, gid }
}
