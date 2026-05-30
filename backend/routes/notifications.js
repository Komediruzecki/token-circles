const express = require('express');
const { sendMail } = require('../services/emailService');
const reminderService = require('../services/reminderService');

module.exports = function ({ db, apiRateLimiter, requireAuth, logError }) {
  const router = express.Router();

  // ── Get notification settings ────────────────────────────────────────
  router.get('/api/notifications/settings', apiRateLimiter, requireAuth, (req, res) => {
    try {
      const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);

      const rows = db
        .prepare("SELECT key, value FROM settings WHERE profile_id = ? AND key LIKE 'email_%'")
        .all(req.session.userId);

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
      res.status(500).json({ error: err.message });
    }
  });

  // ── Update notification settings ─────────────────────────────────────
  router.put('/api/notifications/settings', apiRateLimiter, requireAuth, (req, res) => {
    try {
      const { email, emailNotifications, budgetAlerts, billsReminders, spendingReport } = req.body;

      // Update email on users table
      if (email !== undefined) {
        db.prepare('UPDATE users SET email = ? WHERE id = ?').run(
          String(email).trim(),
          req.session.userId
        );
      }

      // Update settings
      const upsert = db.prepare(
        'INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)'
      );

      if (emailNotifications !== undefined) {
        upsert.run(
          'email_notifications',
          emailNotifications ? 'true' : 'false',
          req.session.userId
        );
      }
      if (budgetAlerts !== undefined) {
        upsert.run('email_budget_alerts', budgetAlerts ? 'true' : 'false', req.session.userId);
      }
      if (billsReminders !== undefined) {
        upsert.run('email_bills_reminders', billsReminders ? 'true' : 'false', req.session.userId);
      }
      if (spendingReport !== undefined) {
        upsert.run('email_spending_report', spendingReport ? 'true' : 'false', req.session.userId);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error(err.message);
      logError('error', 'notifications', err, req);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Send test email ──────────────────────────────────────────────────
  router.post('/api/notifications/test-email', apiRateLimiter, requireAuth, async (req, res) => {
    try {
      const { to } = req.body;
      const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
      const recipient = to || user?.email;

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
      res.status(500).json({ error: err.message });
    }
  });

  // ── Manually trigger a reminder ──────────────────────────────────────
  router.post('/api/notifications/trigger', apiRateLimiter, requireAuth, async (req, res) => {
    try {
      const { type } = req.body;

      if (type === 'budget-alert') {
        await reminderService.sendBudgetAlerts();
        res.json({ ok: true, type: 'budget-alert' });
      } else if (type === 'report') {
        await reminderService.sendSpendingReports();
        res.json({ ok: true, type: 'report' });
      } else if (type === 'bills') {
        await reminderService.sendBillsReminders();
        res.json({ ok: true, type: 'bills' });
      } else {
        res.status(400).json({ error: 'Invalid type. Use: budget-alert, report, or bills' });
      }
    } catch (err) {
      console.error(err.message);
      logError('error', 'notifications', err, req);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
