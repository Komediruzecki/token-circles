const express = require('express');
const { toCamelCase } = require('../utils');
const { getProfileId } = require('../middleware/profile');
const loanCalc = require('../models/loanCalculator');

module.exports = function({ db, apiRateLimiter, logError }) {
  const router = express.Router();

  router.get('/api/loans', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const rows = db
        .prepare(
          `
        SELECT l.*,
          (SELECT SUM(amount) FROM loan_prepayments WHERE loan_id = l.id) as total_prepaid,
          (SELECT COUNT(*) FROM loan_prepayments WHERE loan_id = l.id) as prepayment_count
        FROM loans l
        WHERE l.profile_id = ?
        ORDER BY l.created_at DESC
      `
        )
        .all(pid);
      res.json(rows);
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/loans', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const { name, principal, interest_rate, start_date, term_months, rate_periods } = req.body;
      const interestRate = interest_rate || 5.0;
      const loanId = req.repos.loans.create({
        name, principal, interest_rate: interestRate, start_date, term_months, profile_id: pid,
      });

      if (rate_periods && rate_periods.length > 0) {
        for (const rp of rate_periods) {
          req.repos.loans.addRatePeriod({ loan_id: loanId, rate: rp.rate, start_month: rp.start_month, end_month: rp.end_month || null });
        }
      } else {
        req.repos.loans.addRatePeriod({ loan_id: loanId, rate: interestRate, start_month: 1, end_month: null });
      }

      res.json({
        id: loanId,
        name,
        principal,
        interest_rate,
        start_date,
        term_months,
        profile_id: pid,
      });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/loans/:id', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const loan = req.repos.loans.getById(req.params.id, pid);
      if (!loan) return res.status(404).json({ error: 'Not found' });
      loan.rate_periods = req.repos.loans.getRatePeriods(req.params.id);
      loan.prepayments = req.repos.loans.getPrepayments(req.params.id);
      res.json(loan);
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/api/loans/:id', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const { name, principal, interest_rate, start_date, term_months, rate_periods } = req.body;
      const result = req.repos.loans.update(req.params.id, pid, {
        name, principal, interest_rate: interest_rate || 5.0, start_date, term_months,
      });
      if (result.changes === 0) return res.status(404).json({ error: 'Not found' });

      if (rate_periods !== undefined) {
        req.repos.loans.deleteRatePeriods(req.params.id);
        for (const rp of rate_periods) {
          req.repos.loans.addRatePeriod({ loan_id: req.params.id, rate: rp.rate, start_month: rp.start_month, end_month: rp.end_month || null });
        }
      }

      res.json(toCamelCase({ ok: true }));
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/api/loans/:id', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const result = req.repos.loans.deleteById(req.params.id, pid);
      if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
      res.json(toCamelCase({ ok: true }));
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Rate periods CRUD
  router.post('/api/loans/:id/rates', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const loan = req.repos.loans.getById(req.params.id, pid);
      if (!loan) return res.status(404).json({ error: 'Loan not found' });
      const { rate, start_month, end_month } = req.body;
      const id = req.repos.loans.addRatePeriod({ loan_id: req.params.id, rate, start_month, end_month: end_month || null });
      res.json({ id });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/api/loans/:id/rates/:rateId', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const loan = db
        .prepare('SELECT id FROM loans WHERE id=? AND profile_id=?')
        .get(req.params.id, pid);
      if (!loan) return res.status(404).json({ error: 'Loan not found' });
      const { rate, start_month, end_month } = req.body;
      req.repos.loans.updateRatePeriod(req.params.rateId, req.params.id, { rate, start_month, end_month: end_month || null });
      res.json(toCamelCase({ ok: true }));
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/api/loans/:id/rates/:rateId', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const loan = req.repos.loans.getById(req.params.id, pid);
      if (!loan) return res.status(404).json({ error: 'Loan not found' });
      req.repos.loans.deleteRatePeriodById(req.params.rateId, req.params.id);
      res.json(toCamelCase({ ok: true }));
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Prepayments CRUD
  router.post('/api/loans/:id/prepayments', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const loan = db
        .prepare('SELECT id FROM loans WHERE id=? AND profile_id=?')
        .get(req.params.id, pid);
      if (!loan) return res.status(404).json({ error: 'Loan not found' });
      const { month, amount, note } = req.body;
      const id = req.repos.loans.addPrepayment({ loan_id: req.params.id, month, amount, note: note || '' });
      res.json({ id });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/api/loans/:id/prepayments/:prepayId', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const loan = req.repos.loans.getById(req.params.id, pid);
      if (!loan) return res.status(404).json({ error: 'Loan not found' });
      req.repos.loans.deletePrepayment(req.params.prepayId, req.params.id);
      res.json(toCamelCase({ ok: true }));
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Calculate amortization
  router.post('/api/loans/:id/calculate', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const loan = db
        .prepare('SELECT * FROM loans WHERE id=? AND profile_id=?')
        .get(req.params.id, pid);
      if (!loan) return res.status(404).json({ error: 'Not found' });

      const ratePeriods = db
        .prepare('SELECT * FROM loan_rate_periods WHERE loan_id=? ORDER BY start_month')
        .all(req.params.id);
      const prepayments = db
        .prepare('SELECT * FROM loan_prepayments WHERE loan_id=? ORDER BY month')
        .all(req.params.id);

      // Prepend the loan's initial rate as the first rate period (months 1 to before first user-set change)
      const initialRatePeriod = [{ rate: loan.interest_rate, start_month: 1, end_month: undefined }];
      const allRatePeriods = [
        ...initialRatePeriod,
        ...ratePeriods.map((rp) => ({
          rate: rp.rate,
          start_month: rp.start_month,
          end_month: rp.end_month,
        })),
      ];

      const scheduleWithPrepayments = loanCalc.calculateSchedule(
        loan.principal,
        loan.start_date,
        loan.term_months,
        allRatePeriods,
        prepayments.map((p) => ({
          month: p.month,
          amount: p.amount,
          note: p.note,
        }))
      );

      const scheduleNoPrepayments = loanCalc.calculateSchedule(
        loan.principal,
        loan.start_date,
        loan.term_months,
        allRatePeriods,
        []
      );

      const summary = loanCalc.getSummary(scheduleWithPrepayments, scheduleNoPrepayments);

      res.json({
        schedule: scheduleWithPrepayments,
        summary,
        comparison: {
          withPrepayments: summary,
          withoutPrepayments: loanCalc.getSummary(scheduleNoPrepayments, scheduleNoPrepayments),
        },
      });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
