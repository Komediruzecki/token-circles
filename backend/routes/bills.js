const express = require('express');
const { toCamelCase } = require('../utils');
const { getProfileId } = require('../middleware/profile');
const { asyncHandler } = require('../lib/errors');

function isBillPaidForCurrentPeriod(bill, now) {
  if (!bill.last_paid_date) return false;
  const lastPaid = new Date(bill.last_paid_date);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  if (bill.frequency === 'monthly') {
    // Paid if last_paid is in the current month
    return (
      lastPaid.getMonth() === today.getMonth() && lastPaid.getFullYear() === today.getFullYear()
    );
  } else if (bill.frequency === 'weekly') {
    // Paid if last_paid is within the last 7 days
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return lastPaid >= weekAgo;
  } else if (bill.frequency === 'biweekly') {
    // Paid if last_paid is within the last 14 days
    const twoWeeksAgo = new Date(today);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    return lastPaid >= twoWeeksAgo;
  } else if (bill.frequency === 'yearly') {
    // Paid if last_paid is in the current year
    return lastPaid.getFullYear() === today.getFullYear();
  }
  return false;
}

module.exports = function ({ apiRateLimiter, logError , requireAuth }) {
  const router = express.Router();

  router.get('/api/bills', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const rows = req.repos.bills.all(
      `
      SELECT b.*, c.name as category_name, c.color as category_color
      FROM bills b
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.profile_id = ?
      ORDER BY b.is_active DESC, b.name ASC
    `,
      pid
    );

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const billsWithStatus = rows.map((b) => {
      const paid = isBillPaidForCurrentPeriod(b, now);
      return { ...b, paid };
    });

    // Filter by paid status if requested
    let result = billsWithStatus;
    if (req.query.paid === 'true') {
      result = result.filter((b) => b.paid);
    } else if (req.query.paid === 'false') {
      result = result.filter((b) => !b.paid);
    }

    // Filter by type if requested (bill, subscription)
    if (req.query.type) {
      result = result.filter((b) => (b.type || 'bill') === req.query.type);
    }

    res.json(result);

  }));

  router.get('/api/bills/upcoming', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const bills = req.repos.bills.all(
      `
      SELECT b.*, c.name as category_name, c.color as category_color
      FROM bills b
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.profile_id = ? AND b.is_active = 1
      ORDER BY b.name ASC
    `,
      pid
    );

    const upcoming = bills.map((b) => {
      let nextDue = null;
      const lastPaid = b.last_paid ? new Date(b.last_paid) : null;

      if (b.frequency === 'monthly') {
        const dayOfMonth = b.day_of_month || 1;
        if (lastPaid) {
          nextDue = new Date(lastPaid);
          nextDue.setMonth(nextDue.getMonth() + 1);
          nextDue.setDate(
            Math.min(
              dayOfMonth,
              new Date(nextDue.getFullYear(), nextDue.getMonth() + 1, 0).getDate()
            )
          );
        } else {
          nextDue = new Date(
            now.getFullYear(),
            now.getMonth(),
            Math.min(dayOfMonth, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())
          );
          if (nextDue < now) nextDue.setMonth(nextDue.getMonth() + 1);
        }
      } else if (b.frequency === 'weekly') {
        if (lastPaid) {
          nextDue = new Date(lastPaid);
          nextDue.setDate(nextDue.getDate() + 7);
        } else {
          nextDue = new Date(todayStr);
          nextDue.setDate(nextDue.getDate() + 7);
        }
      } else if (b.frequency === 'yearly') {
        if (lastPaid) {
          nextDue = new Date(lastPaid);
          nextDue.setFullYear(nextDue.getFullYear() + 1);
        } else {
          const dayOfMonth = b.day_of_month || 1;
          nextDue = new Date(now.getFullYear(), 0, dayOfMonth);
          if (nextDue < now) nextDue.setFullYear(nextDue.getFullYear() + 1);
        }
      }

      const nextDueStr = nextDue ? nextDue.toISOString().split('T')[0] : null;
      const daysUntil = nextDueStr ? Math.ceil((nextDue - now) / (1000 * 60 * 60 * 24)) : null;
      const isOverdue = daysUntil !== null && daysUntil < 0;

      return {
        id: b.id,
        name: b.name,
        amount: b.amount,
        frequency: b.frequency,
        day_of_month: b.day_of_month,
        category_name: b.category_name,
        category_color: b.category_color,
        category_id: b.category_id,
        last_paid: b.last_paid,
        next_due_date: nextDueStr,
        days_until: daysUntil,
        is_overdue: isOverdue,
        paid: isBillPaidForCurrentPeriod(b, now),
      };
    });

    upcoming.sort((a, b) => {
      if (a.is_overdue && !b.is_overdue) return -1;
      if (!a.is_overdue && b.is_overdue) return 1;
      if (a.days_until !== null && b.days_until !== null) return a.days_until - b.days_until;
      if (a.days_until !== null) return -1;
      if (b.days_until !== null) return 1;
      return 0;
    });

    res.json(upcoming);

  }));

  router.post('/api/bills', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { name, amount, frequency, day_of_month, category_id, notes, type, dueDate } = req.body;
    if (!name || amount === undefined) {
      return res.status(400).json({ error: 'Name and amount are required' });
    }
    if (!dueDate) {
      return res.status(400).json({ error: 'Due date is required' });
    }
    if (isNaN(Date.parse(dueDate))) {
      return res.status(400).json({ error: 'Invalid due date format' });
    }
    if (parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }
    const info = req.repos.bills.create({
      profile_id: pid,
      name,
      amount,
      frequency: frequency || 'monthly',
      day_of_month: day_of_month || null,
      category_id: category_id || null,
      notes: notes || '',
      type: type || 'bill',
      due_date: dueDate,
    });
    res.json({ id: info.lastInsertRowid });

  }));

  router.put('/api/bills/:id', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const existing = req.repos.bills.getById(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { name, amount, frequency, day_of_month, category_id, is_active, notes, type } =
      req.body;
    req.repos.bills.update(req.params.id, pid, {
      name: name ?? '',
      amount: amount ?? 0,
      frequency: frequency ?? 'monthly',
      day_of_month: day_of_month ?? null,
      category_id: category_id ?? null,
      is_active: is_active ?? 1,
      notes: notes ?? '',
      type: type ?? 'bill',
    });
    res.json(toCamelCase({ ok: true }));

  }));

  router.delete('/api/bills/:id', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    req.repos.bills.deleteById(req.params.id, pid);
    res.json(toCamelCase({ ok: true }));

  }));

  router.post('/api/bills/:id/mark-paid', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const bill = req.repos.bills.getById(req.params.id, pid);
    if (!bill) return res.status(404).json({ error: 'Not found' });

    const todayStr = new Date().toISOString().split('T')[0];
    const info = req.repos.transactions.create({
      profile_id: pid,
      description: bill.name,
      amount: bill.amount,
      type: 'expense',
      category_id: bill.category_id,
      date: todayStr,
      notes: bill.notes || '',
    });

    req.repos.bills.markPaid(req.params.id, pid);

    res.json({ ok: true, transactionId: info.lastInsertRowid });

  }));

  router.get('/api/bills/summary', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const summary = req.repos.bills.getSummary(pid);
    res.json(summary);

  }));

  router.get('/api/bills/notifications', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const bills = req.repos.bills.list(pid);
    const today = new Date();
    const upcoming = bills.filter((b) => {
      if (!b.due_date) return false;
      const dueDate = new Date(b.due_date);
      const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= 7;
    });
    res.json({ notifications: upcoming, count: upcoming.length });

  }));

  return router;
};
