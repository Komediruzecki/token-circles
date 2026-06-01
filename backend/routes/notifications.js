const express = require('express');
const { sendMail } = require('../services/emailService');
const reminderService = require('../services/reminderService');
const { getProfileId } = require('../middleware/profile');
const { isValidEmail } = require('../utils');

module.exports = function ({ db, apiRateLimiter, requireAuth, logError }) {
  const router = express.Router();

  // ── Get notification settings ────────────────────────────────────────
  router.get('/api/notifications/settings', apiRateLimiter, requireAuth, (req, res) => {
    try {
      const pid = getProfileId(req);
      const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);

      const rows = db
        .prepare("SELECT key, value FROM settings WHERE profile_id = ? AND key LIKE 'email_%'")
        .all(pid);

      const settings = { email: user?.email || '' };
      for (const r of rows) {
        settings[r.key] = r.value;
      }

      res.json({
        email: settings.email,
        emailNotifications: settings.email_notifications !== 'false',
        budgetAlerts: settings.email_budget_alerts !== 'false',
        billsReminders: settings.email_bills_reminders !== 'false',
        spendingReport: settings.email_spending_report !== 'false',
      });
    } catch (err) {
      console.error(err.message);
      logError('error', 'notifications', err, req);
      res.status(500).json({ error: 'Failed to load notification settings' });
    }
  });

  // ── Update notification settings ─────────────────────────────────────
  router.put('/api/notifications/settings', apiRateLimiter, requireAuth, (req, res) => {
    try {
      const body = req.body || {};
      const { email, emailNotifications, budgetAlerts, billsReminders, spendingReport } = body;
      const pid = getProfileId(req);

      if (email !== undefined) {
        const trimmedEmail = String(email).trim();
        if (trimmedEmail && !isValidEmail(trimmedEmail)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }
        db.prepare('UPDATE users SET email = ? WHERE id = ?').run(trimmedEmail, req.session.userId);
      }

      const upsert = db.prepare(
        'INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)'
      );
      if (emailNotifications !== undefined) {
        upsert.run('email_notifications', emailNotifications ? 'true' : 'false', pid);
      }
      if (budgetAlerts !== undefined) {
        upsert.run('email_budget_alerts', budgetAlerts ? 'true' : 'false', pid);
      }
      if (billsReminders !== undefined) {
        upsert.run('email_bills_reminders', billsReminders ? 'true' : 'false', pid);
      }
      if (spendingReport !== undefined) {
        upsert.run('email_spending_report', spendingReport ? 'true' : 'false', pid);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error(err.message);
      logError('error', 'notifications', err, req);
      res.status(500).json({ error: 'Failed to update notification settings' });
    }
  });

  // ── Send test email ──────────────────────────────────────────────────
  router.post('/api/notifications/test-email', apiRateLimiter, requireAuth, async (req, res) => {
    try {
      const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
      const recipient = user?.email;

      if (!recipient) {
        return res.status(400).json({ error: 'No email address configured' });
      }

      const result = await sendMail(
        recipient,
        'Test Email — Finance Manager',
        '<h2>Finance Manager</h2><p>This is a test email. If you received this, your email configuration is working correctly.</p>'
      );

      res.json(result);
    } catch (err) {
      console.error(err.message);
      logError('error', 'notifications', err, req);
      res.status(500).json({ error: 'Failed to send test email' });
    }
  });

  // ── Manually trigger a reminder (scoped to requesting user only) ─────
  router.post('/api/notifications/trigger', apiRateLimiter, requireAuth, async (req, res) => {
    try {
      const { type } = req.body;
      const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.session.userId);

      if (!user || !user.email) {
        return res.status(400).json({ error: 'No email address configured for your account' });
      }

      if (type === 'budget-alert') {
        await reminderService.sendBudgetAlertsForUser(user);
        res.json({ ok: true, type: 'budget-alert' });
      } else if (type === 'report') {
        await reminderService.sendSpendingReportForUser(user);
        res.json({ ok: true, type: 'report' });
      } else if (type === 'bills') {
        await reminderService.sendBillsRemindersForUser(user);
        res.json({ ok: true, type: 'bills' });
      } else {
        res.status(400).json({ error: 'Invalid type. Use: budget-alert, report, or bills' });
      }
    } catch (err) {
      console.error(err.message);
      logError('error', 'notifications', err, req);
      res.status(500).json({ error: 'Failed to trigger notification' });
    }
  });

  return router;
};
