const db = require('../database');
const { sendMail } = require('./emailService');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getUsersWithEmail() {
  return db.prepare("SELECT id, email FROM users WHERE email IS NOT NULL AND email != ''").all();
}

function hasNotificationEnabled(userId, key) {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ? AND profile_id = ?')
    .get(key, userId);
  return row && row.value === 'true';
}

function getProfileIdsForUser(userId) {
  return db
    .prepare('SELECT id FROM profiles WHERE user_id = ?')
    .all(userId)
    .map((r) => r.id);
}

function getBudgetAlerts(profileId, threshold = 80) {
  const now = new Date();
  const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().split('T')[0];

  const budgets = db
    .prepare(
      `SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon
       FROM budgets b
       LEFT JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
       WHERE b.profile_id = ? AND (b.end_date IS NULL OR b.end_date >= ?)`
    )
    .all(profileId, startDate);

  const spentMap = {};
  const spentRows = db
    .prepare(
      `SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
       FROM transactions WHERE profile_id = ? AND type = 'expense' AND date >= ? AND date < ?
       GROUP BY category_id`
    )
    .all(profileId, startDate, endDate);
  for (const row of spentRows) {
    spentMap[row.category_id] = Math.abs(row.total);
  }

  const alerts = [];
  for (const budget of budgets) {
    const spent = spentMap[budget.category_id] || 0;
    const percentage = budget.amount > 0 ? Math.round((spent / budget.amount) * 100) : 0;
    if (percentage >= threshold) {
      alerts.push({
        categoryName: budget.category_name || 'Uncategorized',
        categoryColor: budget.category_color || '#6b7280',
        budgetAmount: budget.amount,
        spent,
        remaining: budget.amount - spent,
        percentage,
        status: percentage > 100 ? 'over' : 'warning',
      });
    }
  }
  return alerts.sort((a, b) => b.percentage - a.percentage);
}

function getUpcomingBills(profileId) {
  const bills = db
    .prepare('SELECT * FROM bills WHERE profile_id = ? AND is_active = 1')
    .all(profileId);
  const today = new Date();
  const upcoming = [];
  for (const bill of bills) {
    if (!bill.due_date) continue;
    const dueDate = new Date(bill.due_date);
    const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) {
      upcoming.push({ ...bill, daysUntilDue: diffDays, overdue: true });
    } else if (diffDays <= 7) {
      upcoming.push({ ...bill, daysUntilDue: diffDays, overdue: false });
    }
  }
  return upcoming.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

function getSpendingReport(profileId) {
  const now = new Date();
  const endDate = now.toISOString().split('T')[0];
  const startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
    .toISOString()
    .split('T')[0];

  const income =
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
         WHERE profile_id = ? AND type = 'income' AND date >= ? AND date <= ?`
      )
      .get(profileId, startDate, endDate)?.total || 0;

  const expenses =
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
         WHERE profile_id = ? AND type = 'expense' AND date >= ? AND date <= ?`
      )
      .get(profileId, startDate, endDate)?.total || 0;

  const categoryBreakdown = db
    .prepare(
      `SELECT c.name, c.color, SUM(t.amount) as total
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.profile_id = ? AND t.type = 'expense' AND t.date >= ? AND t.date <= ?
       GROUP BY c.id ORDER BY total DESC LIMIT 5`
    )
    .all(profileId, startDate, endDate);

  const txCount =
    db
      .prepare(
        `SELECT COUNT(*) as c FROM transactions
         WHERE profile_id = ? AND date >= ? AND date <= ?`
      )
      .get(profileId, startDate, endDate)?.c || 0;

  return {
    totalIncome: income,
    totalExpenses: expenses,
    netBalance: income - expenses,
    categoryBreakdown,
    transactionCount: txCount,
    startDate,
    endDate,
  };
}

// ── Email HTML templates ───────────────────────────────────────────────

function budgetAlertHtml(allAlerts) {
  if (allAlerts.length === 0) return null;

  const rows = allAlerts
    .map(
      (a) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${escapeHtml(a.categoryColor)};margin-right:8px"></span>
        ${escapeHtml(a.categoryName)}
      </td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${a.budgetAmount.toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${a.spent.toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;color:${a.status === 'over' ? '#ef4444' : '#f59e0b'}">
        ${a.status === 'over' ? 'OVER' : a.percentage + '%'}
      </td>
    </tr>`
    )
    .join('');

  const hasOverBudget = allAlerts.some((a) => a.status === 'over');
  const description = hasOverBudget
    ? 'The following budgets have exceeded their limit:'
    : 'The following budgets are approaching their limit (80%+ used):';

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
    <h2 style="color:#1f2937">Budget Alert</h2>
    <p>${description}</p>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f3f4f6">
        <th style="padding:8px;text-align:left">Category</th>
        <th style="padding:8px;text-align:right">Budget</th>
        <th style="padding:8px;text-align:right">Spent</th>
        <th style="padding:8px;text-align:right">Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#6b7280;margin-top:24px;font-size:12px">Finance Manager — Budget Alerts</p>
  </body></html>`;
}

function spendingReportHtml(report) {
  if (report.transactionCount === 0) return null;

  const categories = report.categoryBreakdown
    .map(
      (c) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${escapeHtml(c.color || '#6b7280')};margin-right:8px"></span>
        ${escapeHtml(c.name || 'Uncategorized')}
      </td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${(c.total || 0).toFixed(2)}</td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
    <h2 style="color:#1f2937">Spending Report</h2>
    <p>${report.startDate} to ${report.endDate}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <tr><td style="padding:8px">Total Income</td><td style="padding:8px;text-align:right;color:#10b981">$${report.totalIncome.toFixed(2)}</td></tr>
      <tr><td style="padding:8px">Total Expenses</td><td style="padding:8px;text-align:right;color:#ef4444">$${report.totalExpenses.toFixed(2)}</td></tr>
      <tr style="font-weight:bold"><td style="padding:8px;border-top:2px solid #1f2937">Net</td><td style="padding:8px;text-align:right;border-top:2px solid #1f2937">$${report.netBalance.toFixed(2)}</td></tr>
    </table>
    <h3>Top Spending Categories</h3>
    <table style="width:100%;border-collapse:collapse">
      <tbody>${categories || '<tr><td>No spending data</td></tr>'}</tbody>
    </table>
    <p style="color:#6b7280;margin-top:8px">${report.transactionCount} transactions</p>
    <p style="color:#6b7280;margin-top:24px;font-size:12px">Finance Manager — Bi-weekly Report</p>
  </body></html>`;
}

function billsReminderHtml(bills) {
  if (bills.length === 0) return null;

  const rows = bills
    .map(
      (b) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(b.name)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${(b.amount || 0).toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${b.due_date || '-'}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;color:${b.overdue ? '#ef4444' : b.daysUntilDue === 0 ? '#ef4444' : b.daysUntilDue <= 2 ? '#f59e0b' : '#6b7280'}">
        ${b.overdue ? 'Overdue' : b.daysUntilDue === 0 ? 'Today' : b.daysUntilDue === 1 ? 'Tomorrow' : b.daysUntilDue + ' days'}
      </td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
    <h2 style="color:#1f2937">Upcoming Bills</h2>
    <p>${bills.length} bill${bills.length !== 1 ? 's' : ''} due or overdue:</p>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f3f4f6">
        <th style="padding:8px;text-align:left">Bill</th>
        <th style="padding:8px;text-align:right">Amount</th>
        <th style="padding:8px;text-align:right">Due Date</th>
        <th style="padding:8px;text-align:right">Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#6b7280;margin-top:24px;font-size:12px">Finance Manager — Bills Reminder</p>
  </body></html>`;
}

// ── Sender functions ───────────────────────────────────────────────────

async function sendBudgetAlerts() {
  console.log('[reminder] Running budget alerts check...');
  const users = getUsersWithEmail();
  for (const user of users) {
    try {
      if (!hasNotificationEnabled(user.id, 'email_notifications')) continue;
      if (!hasNotificationEnabled(user.id, 'email_budget_alerts')) continue;

      const profileIds = getProfileIdsForUser(user.id);
      const allAlerts = [];
      for (const pid of profileIds) {
        try {
          allAlerts.push(...getBudgetAlerts(pid));
        } catch (e) {
          console.error(`[reminder] Budget alerts failed for profile ${pid}:`, e.message);
        }
      }

      if (allAlerts.length === 0) continue;
      // Deduplicate by category, keeping highest severity
      const seen = new Set();
      const deduped = [];
      for (const a of allAlerts.sort((a, b) => b.percentage - a.percentage)) {
        if (!seen.has(a.categoryName)) {
          seen.add(a.categoryName);
          deduped.push(a);
        }
      }

      const html = budgetAlertHtml(deduped);
      if (html) {
        await sendMail(user.email, 'Budget Alert — Finance Manager', html);
      }
    } catch (e) {
      console.error(`[reminder] Budget alerts failed for user ${user.id}:`, e.message);
    }
  }
}

async function sendSpendingReports() {
  console.log('[reminder] Running spending report...');
  const users = getUsersWithEmail();
  for (const user of users) {
    try {
      if (!hasNotificationEnabled(user.id, 'email_notifications')) continue;
      if (!hasNotificationEnabled(user.id, 'email_spending_report')) continue;

      const profileIds = getProfileIdsForUser(user.id);
      // Send per-profile report for the first profile with data
      for (const pid of profileIds) {
        try {
          const report = getSpendingReport(pid);
          const html = spendingReportHtml(report);
          if (html) {
            await sendMail(user.email, 'Spending Report — Finance Manager', html);
            break; // one report per user is enough
          }
        } catch (e) {
          console.error(`[reminder] Spending report failed for profile ${pid}:`, e.message);
        }
      }
    } catch (e) {
      console.error(`[reminder] Spending report failed for user ${user.id}:`, e.message);
    }
  }
}

async function sendBillsReminders() {
  console.log('[reminder] Running bills reminder check...');
  const users = getUsersWithEmail();
  for (const user of users) {
    try {
      if (!hasNotificationEnabled(user.id, 'email_notifications')) continue;
      if (!hasNotificationEnabled(user.id, 'email_bills_reminders')) continue;

      const profileIds = getProfileIdsForUser(user.id);
      let allBills = [];
      for (const pid of profileIds) {
        try {
          allBills = allBills.concat(getUpcomingBills(pid));
        } catch (e) {
          console.error(`[reminder] Bills check failed for profile ${pid}:`, e.message);
        }
      }

      if (allBills.length === 0) continue;

      const html = billsReminderHtml(allBills);
      if (html) {
        await sendMail(user.email, 'Upcoming Bills — Finance Manager', html);
      }
    } catch (e) {
      console.error(`[reminder] Bills reminder failed for user ${user.id}:`, e.message);
    }
  }
}

module.exports = {
  sendBudgetAlerts,
  sendSpendingReports,
  sendBillsReminders,
  getBudgetAlerts,
  getSpendingReport,
  getUpcomingBills,
};
