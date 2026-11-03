// Types for mailbox.mjs, for the TypeScript tests that import it (src/__tests__/mailbox.test.ts).

/** A mail as the mailbox keeps it: Resend's fields, then its own id and arrival time. */
export interface KeptMail {
  from?: string
  to: string | string[]
  subject: string
  html: string
  text?: string
  reply_to?: string | string[]
  headers?: Record<string, string>
  id: string
  received_at: string
}

export const MAIL_ID: RegExp
export const MAX_MAILS: number
export const MAX_TOTAL_BYTES: number

/** A new mail id, after every id this process has made: ids sort in the order they were made. */
export function newId(): string

/** The index page for these mails, newest first; `to` is the filter it shows, or null. */
export function indexPage(mails: KeptMail[], to: string | null): string

export function startMailbox(opts: {
  port: number
  dir: string
  host?: string
  log?: (msg: string) => void
  maxMails?: number
  maxBytes?: number
}): Promise<{ url: string; port: number; close: () => Promise<void> }>
