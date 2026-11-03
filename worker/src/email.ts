import type { Env } from './index';

/**
 * How long a mail call waits for Resend. Past it the call is aborted and sendMail throws, as it
 * does when the network fails, so a caller's own handling of that failure runs.
 */
const MAIL_TIMEOUT_MS = 10_000;

/**
 * The headers that let a mail app show its own unsubscribe button: List-Unsubscribe (RFC 2369)
 * names the URL, and List-Unsubscribe-Post (RFC 8058) says a form POST of
 * `List-Unsubscribe=One-Click` to it unsubscribes, with no page in between. The URL must answer
 * that POST (routes/notifications.ts); a GET of it only shows a page.
 */
export function listUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** The hosts DEV_MAIL_SINK may name: this machine, by its loopback address or its name. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Where a development Worker hands its mails instead of Resend: the URL of a mailbox on this
 * machine (frontend/scripts/mailbox.mjs), which keeps each mail for a person or a test to read.
 * Only when all three hold: no RESEND_API_KEY, APP_ENV is exactly 'development', and DEV_MAIL_SINK
 * is a plain http URL on 127.0.0.1, localhost or [::1] with no user or password in it. Null when
 * no sink is asked for; `refused` says why a DEV_MAIL_SINK that is set is not used. A deployed
 * Worker (APP_ENV 'dev' or 'production') never posts a mail anywhere but Resend.
 */
export function devMailSink(env: Env): { url: string } | { refused: string } | null {
  if (env.RESEND_API_KEY || !env.DEV_MAIL_SINK) return null;
  if (env.APP_ENV !== 'development') return { refused: 'APP_ENV is not development' };
  let url: URL;
  try {
    url = new URL(env.DEV_MAIL_SINK);
  } catch {
    return { refused: 'it is not a URL' };
  }
  if (url.protocol !== 'http:' || url.username || url.password) {
    return { refused: 'it is not a plain http URL' };
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    return { refused: 'its host is not 127.0.0.1, localhost or [::1]' };
  }
  return { url: url.href };
}

// Outbound transactional email via Resend's HTTP API (Workers can't open SMTP sockets).
// Dev parity with the legacy console-log mode: when RESEND_API_KEY is unset, log + skip, unless a
// development mailbox takes the mails (devMailSink above). The mailbox gets the very request body
// Resend would, and its answer is read as Resend's is: taken is { sent: true, id }, so each caller
// goes on as it does in production once Resend has taken a mail (a week-one claim stays, a
// reminder's slot stays, support sends its acknowledgement).
//
// `listUnsubscribe` is the unsubscribe URL of the list this mail belongs to, the same one its
// footer links to. Only mails with such a link pass it; sign-in, account and billing mails have
// nothing to unsubscribe from and send no List-Unsubscribe header.
export async function sendMail(
  env: Env,
  to: string,
  subject: string,
  html: string,
  opts?: { replyTo?: string; text?: string; listUnsubscribe?: string | null }
): Promise<{ sent: boolean; skipped?: boolean; error?: string; status?: number; id?: string }> {
  if (!to) return { sent: false, skipped: true };
  const body = JSON.stringify({
    from: env.EMAIL_FROM || 'Token Circles <hello@tokencircles.com>',
    to,
    subject,
    html,
    // Plain-text twin (deliverability + text-only clients).
    ...(opts?.text ? { text: opts.text } : {}),
    ...(opts?.replyTo ? { reply_to: opts.replyTo } : {}),
    ...(opts?.listUnsubscribe ? { headers: listUnsubscribeHeaders(opts.listUnsubscribe) } : {}),
  });
  if (!env.RESEND_API_KEY) {
    const sink = devMailSink(env);
    if (sink && 'url' in sink) return sendToSink(sink.url, body, to, subject);
    if (sink) console.warn(`[email] DEV_MAIL_SINK is not used: ${sink.refused}`);
    console.log(`[email] DEV (no RESEND_API_KEY) -> to=${to} subject=${subject}`);
    return { sent: false, skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body,
    signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[email] Resend ${res.status}: ${body}`);
    return { sent: false, error: `Resend ${res.status}`, status: res.status };
  }
  // `sent` means Resend ACCEPTED the message, not that anyone received it. A recipient on the
  // account's suppression list — anything that has hard-bounced or complained before — is accepted
  // here with a 2xx and silently dropped at delivery, which is exactly how support requests went
  // missing while the sender still got a "we received it" acknowledgement.
  //
  // Nothing in this response can tell us that, so log the id: it is the only handle that ties a
  // request to its row in the Resend dashboard, where the real status and any suppression reason
  // live. Without it a lost message cannot even be looked up.
  const id = ((await res.json().catch(() => ({}))) as { id?: string }).id;
  console.log(`[email] Resend accepted id=${id ?? 'unknown'} to=${to} subject=${subject}`);
  return { sent: true, id };
}

/**
 * Hand `body`, the request Resend would have had, to the development mailbox at `url`. Its answer
 * reads as Resend's: any 2xx is taken, with the id from its JSON when there is one, anything else
 * is refused with its status, and a mailbox that is down throws as a network failure does. A
 * redirect is not followed: the mail goes to the URL DEV_MAIL_SINK names or nowhere, and a 3xx is
 * a refusal like any other non-2xx. The log line carries the id from the mailbox's answer, the
 * address and the subject; the body and the rest of the answer are never logged, as a mail holds
 * sign-in links.
 */
async function sendToSink(
  url: string,
  body: string,
  to: string,
  subject: string
): Promise<{ sent: boolean; error?: string; status?: number; id?: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    // workerd takes 'follow' or 'manual' only; 'manual' hands back the 3xx itself, which !res.ok
    // below refuses.
    redirect: 'manual',
    signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
  });
  if (!res.ok) {
    console.error(`[email] DEV mailbox refused the mail: ${res.status}`);
    return { sent: false, error: `DEV mailbox ${res.status}`, status: res.status };
  }
  const id = ((await res.json().catch(() => ({}))) as { id?: string }).id;
  console.log(`[email] DEV mailbox took id=${id ?? 'unknown'} to=${to} subject=${subject}`);
  return { sent: true, id };
}
