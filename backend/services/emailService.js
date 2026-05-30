const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || 'localhost';
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.SMTP_FROM || 'finance-manager@localhost';

  if (user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  } else {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
    });
  }

  transporter.from = from;

  if (process.env.SMTP_HOST) {
    console.log(`[email] SMTP configured: ${host}:${port}${user ? ' (auth)' : ''}, from: ${from}`);
  } else {
    console.log('[email] No SMTP_HOST set — emails will be logged to console only');
  }

  return transporter;
}

async function sendMail(to, subject, html) {
  if (!to) {
    console.warn('[email] Skipping: no recipient address');
    return { skipped: true, reason: 'no recipient' };
  }

  const transport = getTransporter();
  const from = transport.from;

  // Dev mode: log to console when no SMTP configured
  if (!process.env.SMTP_HOST) {
    console.log(`[email] DEV — To: ${to}`);
    console.log(`[email] DEV — Subject: ${subject}`);
    console.log(`[email] DEV — Body: ${html.substring(0, 200)}...`);
    return { skipped: true, reason: 'no SMTP_HOST configured (dev mode)' };
  }

  try {
    const info = await transport.sendMail({ from, to, subject, html });
    console.log(`[email] Sent to ${to}: ${info.messageId}`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[email] Failed to send to ${to}:`, err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { sendMail };
