import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { sendMail } from '../email';
import { renderSupportAck } from '../emailTemplates';
import { enforce, clientIp, rateLimit } from '../ratelimit';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Public support contact form. Relays the user's message to the PRIVATE support inbox
// (env.SUPPORT_EMAIL — a worker secret, never sent to the client) via Resend, with the
// sender's address as reply-to so the team can reply directly. Rate-limited per IP;
// Turnstile will gate this too once wired (backlog #4).
export const supportRoutes = new Hono<AppEnv>();

supportRoutes.post('/api/support/contact', async (c) => {
  const rl = await enforce(c, `support:${clientIp(c)}`, 5, 3600);
  if (rl) return rl;
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    message?: string;
    subject?: string;
  };
  const email = (body.email ?? '').trim();
  const message = (body.message ?? '').trim();
  if (!EMAIL_RE.test(email)) return c.json({ error: 'A valid email is required' }, 400);
  if (message.length < 5) return c.json({ error: 'Please enter a message' }, 400);
  if (message.length > 5000) return c.json({ error: 'Message is too long (5000 chars max)' }, 400);

  // Not configured (no SUPPORT_EMAIL secret) → accept but no-op, so the UI degrades gracefully.
  if (!c.env.SUPPORT_EMAIL) {
    console.log('[support] SUPPORT_EMAIL not configured; message dropped');
    return c.json({ ok: true, delivered: false });
  }

  const subject = ((body.subject ?? '').trim() || 'Support request').slice(0, 120);
  // Short, human-friendly tracking id — included in both emails and the API response so a request
  // is easy to reference. (Email is the record for now; persist to D1 later for a queryable queue.)
  const ticketId = `TC-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const html = `<p><strong>Request ID:</strong> ${ticketId}</p>
    <p><strong>From:</strong> ${escapeHtml(email)}</p>
    <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
    <hr>
    <p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;
  const r = await sendMail(
    c.env,
    c.env.SUPPORT_EMAIL,
    `[Token Circles] ${subject} (${ticketId})`,
    html,
    { replyTo: email }
  );

  // Best-effort acknowledgement back to the user. Sent ONLY if the support relay actually went
  // through, and it deliberately does NOT echo the user-supplied message back: `email` is
  // unverified, so reflecting attacker-chosen text would turn this into a branded, DKIM-signed
  // phishing/spam relay to arbitrary recipients. A generic confirmation + ticket id carries no
  // attacker-controlled payload. Per-email rate-limited too, so one target address can't be mailed
  // repeatedly from rotating IPs. No reply-to override → replies go to From (hello@), keeping
  // SUPPORT_EMAIL private.
  const ackRl = await rateLimit(c.env, `support-email:${email.toLowerCase()}`, 3, 3600);
  if (r.sent && ackRl.ok) {
    const ack = renderSupportAck({ ticketId });
    await sendMail(c.env, email, ack.subject, ack.html, { text: ack.text }).catch(() => {
      /* ack is best-effort; the support message already went through */
    });
  }

  return c.json({ ok: true, delivered: r.sent, ticketId });
});
