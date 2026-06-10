const fs = require('fs');
const path = 'backend/index.js';
const content = fs.readFileSync(path, 'utf8');

const billsApi = `
// ========================
// BILLS API
// ========================
app.get("/api/bills", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const rows = db.prepare(`
      SELECT b.*, c.name as category_name, c.color as category_color
      FROM bills b
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.profile_id = ?
      ORDER BY b.is_active DESC, b.name ASC
    `).all(pid);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/bills/upcoming", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const bills = db.prepare(`
      SELECT b.*, c.name as category_name, c.color as category_color
      FROM bills b
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.profile_id = ? AND b.is_active = 1
      ORDER BY b.name ASC
    `).all(pid);

    const upcoming = bills.map(b => {
      let nextDue = null;
      const lastPaid = b.last_paid ? new Date(b.last_paid) : null;

      if (b.frequency === 'monthly') {
        const dayOfMonth = b.day_of_month || 1;
        if (lastPaid) {
          nextDue = new Date(lastPaid);
          nextDue.setMonth(nextDue.getMonth() + 1);
          nextDue.setDate(Math.min(dayOfMonth, new Date(nextDue.getFullYear(), nextDue.getMonth() + 1, 0).getDate()));
        } else {
          nextDue = new Date(now.getFullYear(), now.getMonth(), Math.min(dayOfMonth, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()));
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/bills", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, amount, frequency, day_of_month, category_id, notes } = req.body;
    if (!name || amount === undefined) {
      return res.status(400).json({ error: 'Name and amount are required' });
    }
    const info = db.prepare(`
      INSERT INTO bills (profile_id, name, amount, frequency, day_of_month, category_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      pid,
      name,
      amount,
      frequency || 'monthly',
      day_of_month || null,
      category_id || null,
      notes || '',
    );
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/bills/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const existing = db.prepare('SELECT id FROM bills WHERE id = ? AND profile_id = ?').get(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { name, amount, frequency, day_of_month, category_id, is_active, notes } = req.body;
    db.prepare(`
      UPDATE bills SET name = ?, amount = ?, frequency = ?, day_of_month = ?, category_id = ?, is_active = ?, notes = ?
      WHERE id = ? AND profile_id = ?
    `).run(
      name ?? '',
      amount ?? 0,
      frequency ?? 'monthly',
      day_of_month ?? null,
      category_id ?? null,
      is_active ?? 1,
      notes ?? '',
      req.params.id,
      pid,
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/bills/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    db.prepare('DELETE FROM bills WHERE id = ? AND profile_id = ?').run(req.params.id, pid);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/bills/:id/mark-paid", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND profile_id = ?').get(req.params.id, pid);
    if (!bill) return res.status(404).json({ error: 'Not found' });

    const todayStr = new Date().toISOString().split('T')[0];
    const info = db.prepare(`
      INSERT INTO transactions (profile_id, description, amount, type, category_id, date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      pid,
      bill.name,
      bill.amount,
      'expense',
      bill.category_id,
      todayStr,
      bill.notes || '',
    );

    db.prepare('UPDATE bills SET last_paid = ? WHERE id = ?').run(todayStr, req.params.id);

    res.json({ ok: true, transactionId: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
`;

// Insert before '// STATS (per-profile)'
const marker = '// ========================\n// STATS (per-profile)';
const idx = content.indexOf(marker);
if (idx === -1) {
  console.error('Could not find insertion marker');
  process.exit(1);
}

const newContent = content.slice(0, idx) + billsApi + '\n' + content.slice(idx);
fs.writeFileSync(path, newContent);
console.log('Bills API inserted successfully');
