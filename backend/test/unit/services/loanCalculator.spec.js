/**
 * Unit tests for the loan amortization calculator.
 * Pure math functions — no database, just correctness validation.
 */

const loanCalc = require('../../../models/loanCalculator');

describe('Loan Calculator', () => {
  // ------- calcMonthlyPayment -------
  describe('calcMonthlyPayment()', () => {
    it('should calculate monthly payment for a standard loan', () => {
      // $100,000 at 5% for 30 years (360 months)
      const payment = loanCalc.calcMonthlyPayment(100000, 5, 360);
      expect(payment).toBeCloseTo(536.82, 2);
    });

    it('should handle zero interest rate', () => {
      const payment = loanCalc.calcMonthlyPayment(12000, 0, 12);
      expect(payment).toBe(1000); // 12000 / 12
    });

    it('should handle single-month term', () => {
      const payment = loanCalc.calcMonthlyPayment(1000, 12, 1);
      expect(payment).toBeCloseTo(1010, 0); // 1000 * (0.01 * 1.01^1) / (1.01^1 - 1)
    });

    it('should handle very small principal', () => {
      const payment = loanCalc.calcMonthlyPayment(1, 5, 360);
      expect(payment).toBeCloseTo(0.00537, 5);
    });

    it('should handle very large principal', () => {
      const payment = loanCalc.calcMonthlyPayment(1000000, 3.5, 360);
      expect(payment).toBeCloseTo(4490.45, 2);
    });

    it('should give higher payment for higher rate', () => {
      const low = loanCalc.calcMonthlyPayment(100000, 3, 360);
      const high = loanCalc.calcMonthlyPayment(100000, 7, 360);
      expect(high).toBeGreaterThan(low);
    });

    it('should give higher payment for shorter term', () => {
      const long = loanCalc.calcMonthlyPayment(100000, 5, 360);
      const short = loanCalc.calcMonthlyPayment(100000, 5, 180);
      expect(short).toBeGreaterThan(long);
    });
  });

  // ------- calculateSchedule -------
  describe('calculateSchedule()', () => {
    it('should produce a schedule that pays off the loan', () => {
      const schedule = loanCalc.calculateSchedule(10000, '2025-01-01', 12, [], []);
      const lastRow = schedule[schedule.length - 1];
      expect(lastRow.balance).toBeLessThan(0.02);
      expect(lastRow.month).toBeLessThanOrEqual(12);
    });

    it('should have interest + principal sum to payment (excluding prepayments)', () => {
      const schedule = loanCalc.calculateSchedule(50000, '2025-01-01', 60, [], []);
      for (const row of schedule) {
        const principalRepayment = row.principal + row.prepayment;
        expect(row.payment).toBeCloseTo(principalRepayment + row.interest, 2);
      }
    });

    it('should handle zero interest rate', () => {
      const schedule = loanCalc.calculateSchedule(12000, '2025-01-01', 12, []);
      expect(schedule).toHaveLength(12);
      for (const row of schedule) {
        expect(row.interest).toBe(0);
        expect(row.payment).toBe(1000);
      }
      expect(schedule[11].balance).toBe(0);
    });

    it('should apply prepayments to reduce balance', () => {
      const schedule = loanCalc.calculateSchedule(100000, '2025-01-01', 360, [], [
        { month: 1, amount: 10000, note: 'Bonus payment' },
      ]);

      // After a 10k prepayment on month 1, the remaining term should be shorter
      expect(schedule.length).toBeLessThan(360);
      expect(schedule[0].prepayment).toBe(10000);
      expect(schedule[0].note).toBe('Bonus payment');
    });

    it('should handle rate changes', () => {
      const ratePeriods = [
        { start_month: 1, end_month: 6, rate: 3 },
        { start_month: 7, rate: 5 },
      ];

      const schedule = loanCalc.calculateSchedule(100000, '2025-01-01', 360, ratePeriods, []);

      // First 6 months at 3%
      const firstHalf = schedule.filter((r) => r.month <= 6);
      for (const row of firstHalf) {
        expect(row.rate).toBe(3);
      }

      // After month 6 at 5%
      const secondHalf = schedule.filter((r) => r.month > 6);
      for (const row of secondHalf) {
        expect(row.rate).toBe(5);
      }
    });

    it('should handle overlapping rate periods (last matching wins)', () => {
      const ratePeriods = [
        { start_month: 1, end_month: 12, rate: 5 },
        { start_month: 6, rate: 4 },
      ];

      const schedule = loanCalc.calculateSchedule(100000, '2025-01-01', 360, ratePeriods, []);

      // Months 6+ should use 4% (later period wins)
      const mid = schedule.find((r) => r.month === 6);
      expect(mid.rate).toBe(4);
    });

    it('should produce correct dates', () => {
      const schedule = loanCalc.calculateSchedule(10000, '2025-01-15', 3, []);
      expect(schedule[0].date).toContain('2025-01');
      expect(schedule[1].date).toContain('2025-02');
      expect(schedule[2].date).toContain('2025-03');
    });

    it('should never produce negative balance', () => {
      const schedule = loanCalc.calculateSchedule(100000, '2025-01-01', 360, [], [
        { month: 1, amount: 99999, note: 'Almost payoff' },
      ]);
      for (const row of schedule) {
        expect(row.balance).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ------- totalInterest -------
  describe('totalInterest()', () => {
    it('should sum all interest payments', () => {
      const schedule = loanCalc.calculateSchedule(100000, '2025-01-01', 360, [
        { start_month: 1, rate: 5 },
      ]);
      const interest = loanCalc.totalInterest(schedule);
      // For $100k at 5%, total interest should be substantial
      expect(interest).toBeGreaterThan(50000);
    });

    it('should return 0 for zero-interest schedule', () => {
      const schedule = loanCalc.calculateSchedule(12000, '2025-01-01', 12, []);
      expect(loanCalc.totalInterest(schedule)).toBe(0);
    });

    it('should return 0 for empty schedule', () => {
      expect(loanCalc.totalInterest([])).toBe(0);
    });
  });

  // ------- totalPaid -------
  describe('totalPaid()', () => {
    it('should equal original principal for zero-interest loan', () => {
      const schedule = loanCalc.calculateSchedule(12000, '2025-01-01', 12, []);
      expect(loanCalc.totalPaid(schedule)).toBeCloseTo(12000, 2);
    });

    it('should include prepayments', () => {
      const schedule = loanCalc.calculateSchedule(100000, '2025-01-01', 360, [], [
        { month: 1, amount: 5000, note: '' },
      ]);
      const paid = loanCalc.totalPaid(schedule);
      // Should be more than the pure payments
      expect(paid).toBeGreaterThan(5000);
    });

    it('should return 0 for empty schedule', () => {
      expect(loanCalc.totalPaid([])).toBe(0);
    });
  });

  // ------- payoffDate -------
  describe('payoffDate()', () => {
    it('should return the last schedule entry date', () => {
      const schedule = loanCalc.calculateSchedule(12000, '2025-01-01', 12, []);
      const date = loanCalc.payoffDate(schedule);
      expect(date).toBe(schedule[schedule.length - 1].date);
    });

    it('should return null for empty schedule', () => {
      expect(loanCalc.payoffDate([])).toBeNull();
    });
  });

  // ------- interestSaved -------
  describe('interestSaved()', () => {
    it('should calculate savings from prepayments', () => {
      const original = loanCalc.calculateSchedule(200000, '2025-01-01', 360, [
        { start_month: 1, rate: 5 },
      ]);
      const withPrepay = loanCalc.calculateSchedule(
        200000,
        '2025-01-01',
        360,
        [{ start_month: 1, rate: 5 }],
        [{ month: 1, amount: 20000, note: '' }],
      );

      const saved = loanCalc.interestSaved(original, withPrepay);
      expect(saved).toBeGreaterThan(0);
    });

    it('should return 0 when schedules are identical', () => {
      const schedule = loanCalc.calculateSchedule(10000, '2025-01-01', 12, []);
      expect(loanCalc.interestSaved(schedule, schedule)).toBe(0);
    });
  });

  // ------- monthsSaved -------
  describe('monthsSaved()', () => {
    it('should calculate months eliminated by prepayments', () => {
      const original = loanCalc.calculateSchedule(200000, '2025-01-01', 360, [
        { start_month: 1, rate: 5 },
      ]);
      const withPrepay = loanCalc.calculateSchedule(
        200000,
        '2025-01-01',
        360,
        [{ start_month: 1, rate: 5 }],
        [{ month: 1, amount: 50000, note: '' }],
      );

      const saved = loanCalc.monthsSaved(original, withPrepay);
      expect(saved).toBeGreaterThan(0);
    });

    it('should return 0 when schedules are identical', () => {
      const schedule = loanCalc.calculateSchedule(10000, '2025-01-01', 12, []);
      expect(loanCalc.monthsSaved(schedule, schedule)).toBe(0);
    });
  });

  // ------- getSummary -------
  describe('getSummary()', () => {
    it('should return comprehensive summary object', () => {
      const schedule = loanCalc.calculateSchedule(100000, '2025-01-01', 360, [
        { start_month: 1, rate: 5 },
      ]);
      const original = loanCalc.calculateScheduleNoPrepayments(100000, '2025-01-01', 360, [
        { start_month: 1, rate: 5 },
      ]);
      const summary = loanCalc.getSummary(schedule, original);

      expect(summary).toHaveProperty('totalPaid');
      expect(summary).toHaveProperty('totalInterest');
      expect(summary).toHaveProperty('interestSaved');
      expect(summary).toHaveProperty('monthsSaved');
      expect(summary).toHaveProperty('payoffDate');
      expect(summary).toHaveProperty('totalPayments');
      expect(summary).toHaveProperty('avgMonthlyPayment');
      expect(summary).toHaveProperty('maxBalance');
      expect(summary).toHaveProperty('originalTotalInterest');
      expect(summary).toHaveProperty('originalTotalPayments');

      expect(summary.totalPaid).toBeGreaterThan(0);
      expect(summary.totalPayments).toBe(schedule.length);
      expect(summary.interestSaved).toBe(0); // Same schedule
      expect(summary.monthsSaved).toBe(0);
      // maxBalance is schedule[0].balance — the balance AFTER the first payment
      expect(summary.maxBalance).toBeLessThan(100000);
      expect(summary.maxBalance).toBeGreaterThan(99000);
    });

    it('should detect savings from prepayments', () => {
      const original = loanCalc.calculateSchedule(200000, '2025-01-01', 360, [
        { start_month: 1, rate: 5 },
      ]);
      const withPrepay = loanCalc.calculateSchedule(
        200000,
        '2025-01-01',
        360,
        [{ start_month: 1, rate: 5 }],
        [{ month: 12, amount: 10000, note: '' }],
      );
      const summary = loanCalc.getSummary(withPrepay, original);

      expect(summary.interestSaved).toBeGreaterThan(0);
      expect(summary.monthsSaved).toBeGreaterThan(0);
      expect(summary.totalPayments).toBeLessThan(summary.originalTotalPayments);
    });
  });

  // ------- Edge Cases -------
  describe('edge cases', () => {
    it('should handle 1-month loan', () => {
      const schedule = loanCalc.calculateSchedule(1000, '2025-01-01', 1, []);
      expect(schedule.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle rate period starting after loan start', () => {
      const ratePeriods = [{ start_month: 3, rate: 5 }];
      const schedule = loanCalc.calculateSchedule(100000, '2025-01-01', 360, ratePeriods, []);

      // First 2 months at 0%, then 5%
      expect(schedule[0].rate).toBe(0);
      expect(schedule[1].rate).toBe(0);
      expect(schedule[2].rate).toBe(5);
    });

    it('should handle very high interest rate', () => {
      const schedule = loanCalc.calculateSchedule(10000, '2025-01-01', 12, [
        { start_month: 1, rate: 50 },
      ]);
      // Should still complete
      const last = schedule[schedule.length - 1];
      expect(last.balance).toBeLessThan(0.02);
    });

    it('should handle prepayment larger than remaining balance', () => {
      const schedule = loanCalc.calculateSchedule(1000, '2025-01-01', 12, [], [
        { month: 1, amount: 2000, note: 'Overpay' },
      ]);
      // Should pay off immediately
      expect(schedule.length).toBe(1);
      expect(schedule[0].balance).toBe(0);
    });

    it('should handle multiple prepayments', () => {
      const schedule = loanCalc.calculateSchedule(100000, '2025-01-01', 360, [
        { start_month: 1, rate: 5 },
      ], [
        { month: 6, amount: 5000, note: 'Bonus' },
        { month: 12, amount: 3000, note: 'Tax return' },
        { month: 24, amount: 10000, note: 'Inheritance' },
      ]);

      expect(schedule.length).toBeLessThan(360); // Prepayments shortened the loan
    });

    it('should handle empty rate periods (default 0%)', () => {
      const schedule = loanCalc.calculateSchedule(12000, '2025-01-01', 12, []);
      for (const row of schedule) {
        expect(row.rate).toBe(0);
        expect(row.interest).toBe(0);
      }
    });
  });

  // ------- Real-World Scenarios -------
  describe('real-world scenarios', () => {
    it('30-year $300k mortgage at 6.5%', () => {
      const schedule = loanCalc.calculateSchedule(300000, '2025-06-01', 360, [
        { start_month: 1, rate: 6.5 },
      ]);

      const monthly = loanCalc.calcMonthlyPayment(300000, 6.5, 360);
      expect(monthly).toBeCloseTo(1896.2, 1);

      const totalInt = loanCalc.totalInterest(schedule);
      // Total interest over 30 years should be ~$382,632
      expect(totalInt).toBeGreaterThan(350000);
      expect(totalInt).toBeLessThan(400000);
    });

    it('5-year $25k car loan at 4%', () => {
      const schedule = loanCalc.calculateSchedule(25000, '2025-01-01', 60, [
        { start_month: 1, rate: 4 },
      ]);

      const monthly = loanCalc.calcMonthlyPayment(25000, 4, 60);
      expect(monthly).toBeCloseTo(460.41, 2);
      expect(schedule.length).toBeLessThanOrEqual(60);
    });

    it('ARM loan: 3% for 5 years, then 6%', () => {
      const ratePeriods = [
        { start_month: 1, end_month: 60, rate: 3 },
        { start_month: 61, rate: 6 },
      ];
      const schedule = loanCalc.calculateSchedule(300000, '2025-01-01', 360, ratePeriods);

      // Payment is locked at the initial rate and only recalculates on prepayment.
      // The rate change at month 61 affects the interest/principal split, not the payment amount.
      const midPoint = schedule.find((r) => r.month === 61);
      expect(midPoint.rate).toBe(6); // Rate changed
      expect(midPoint.interest).toBeGreaterThan(schedule[0].interest); // More interest at higher rate
      expect(midPoint.principal).toBeLessThan(schedule[0].principal); // Less principal paid off
    });
  });
});
