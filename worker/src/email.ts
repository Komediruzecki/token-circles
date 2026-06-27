import type { Env } from './index';

// Outbound transactional email via Resend's HTTP API (Workers can't open SMTP sockets).
// Dev parity with the legacy console-log mode: when RESEND_API_KEY is unset, log + skip.
export async function sendMail(
  env: Env,
  to: string,
  subject: string,
  html: string,
  opts?: { replyTo?: string }
): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  if (!to) return { sent: false, skipped: true };
  if (!env.RESEND_API_KEY) {
    console.log(`[email] DEV (no RESEND_API_KEY) -> to=${to} subject=${subject}`);
    return { sent: false, skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'Token Circles <noreply@tokencircles.com>',
      to,
      subject,
      html,
      ...(opts?.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[email] Resend ${res.status}: ${body}`);
    return { sent: false, error: `Resend ${res.status}` };
  }
  return { sent: true };
}
