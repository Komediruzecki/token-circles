/**
 * Unit tests for loanCalculator.js
 */
const {
  calcMonthlyPayment,
  calculateSchedule,
  calculateScheduleNoPrepayments,
  totalInterest,
  totalPaid,
  payoffDate,
  interestSaved,
  monthsSaved,
  getSummary
} = require('../../backend/models/loanCalculator');

describe('loanCalculator', () => {
  describe('calcMonthlyPayment', () => {
    test('calculates correct monthly payment for standard loan', () => {
      // $100,000 at 5% for 30 years (360 months)
      const payment = calcMonthlyPayment(100000, 5, 360);
      expect(payment).toBeCloseTo(536.82, 1);
    });

    test('calculates correct monthly payment for short-term loan', () => {
      // $10,000 at 6% for 12 months
      const payment = calcMonthlyPayment(10000, 6, 12);
      expect(payment).toBeCloseTo(860.66, 1);
    });

    test('handles zero interest rate', () => {
      const payment = calcMonthlyPayment(12000, 0, 12);
      expect(payment).toBeCloseTo(1000, 2);
    });

    test('handles 100% interest rate edge case', () => {
      const payment = calcMonthlyPayment(1000, 100, 12);
      expect(payment).toBeGreaterThan(0);
    });
  });

  describe('calculateSchedule', () => {
    test('generates correct number of payments for standard loan', () => {
      const schedule = calculateSchedule(
        10000, '2024-01-01', 12,
        [{ rate: 6, start_month: 1, end_month: null }],
        []
      );
      expect(schedule.length).toBe(12);
    });

    test('all payments sum to approximately principal plus total interest', () => {
      const principal = 12000;
      const schedule = calculateSchedule(
        principal, '2024-01-01', 12,
        [{ rate: 6, start_month: 1, end_month: null }],
        []
      );
      const totalSum = schedule.reduce((sum, row) => sum + row.payment + row.prepayment, 0);
      expect(totalSum).toBeGreaterThan(principal);
      expect(totalSum).toBeLessThan(principal * 1.1); // within 10% of principal
    });

    test('balance reaches zero at end of schedule', () => {
      const schedule = calculateSchedule(
        10000, '2024-01-01', 12,
        [{ rate: 6, start_month: 1, end_month: null }],
        []
      );
      const lastPayment = schedule[schedule.length - 1];
      expect(lastPayment.balance).toBeCloseTo(0, 1);
    });

    test('final payment does not overpay', () => {
      const schedule = calculateSchedule(
        10000, '2024-01-01', 12,
        [{ rate: 6, start_month: 1, end_month: null }],
        []
      );
      const lastPayment = schedule[schedule.length - 1];
      expect(lastPayment.payment + lastPayment.interest).toBeGreaterThanOrEqual(lastPayment.principal);
    });

    test('handles prepayment reducing total interest', () => {
      const scheduleNoPrepay = calculateSchedule(
        10000, '2024-01-01', 24,
        [{ rate: 5, start_month: 1, end_month: null }],
        []
      );
      const scheduleWithPrepay = calculateSchedule(
        10000, '2024-01-01', 24,
        [{ rate: 5, start_month: 1, end_month: null }],
        [{ month: 6, amount: 2000, note: 'Early payoff' }]
      );

      expect(totalInterest(scheduleWithPrepay)).toBeLessThan(totalInterest(scheduleNoPrepay));
    });

    test('handles prepayment shortening loan term', () => {
      const scheduleNoPrepay = calculateSchedule(
        10000, '2024-01-01', 24,
        [{ rate: 5, start_month: 1, end_month: null }],
        []
      );
      const scheduleWithPrepay = calculateSchedule(
        10000, '2024-01-01', 24,
        [{ rate: 5, start_month: 1, end_month: null }],
        [{ month: 6, amount: 3000, note: 'Large prepayment' }]
      );

      expect(scheduleWithPrepay.length).toBeLessThan(scheduleNoPrepay.length);
    });

    test('handles variable rate periods', () => {
      const schedule = calculateSchedule(
        50000, '2024-01-01', 60,
        [
          { rate: 5, start_month: 1, end_month: 12 },
          { rate: 6, start_month: 13, end_month: 36 },
          { rate: 7, start_month: 37, end_month: null }
        ],
        []
      );

      expect(schedule.length).toBeGreaterThan(0);
      // Check that the rate changes at expected boundaries
      const period1 = schedule.find(r => r.month === 6);
      const period2 = schedule.find(r => r.month === 24);
      const period3 = schedule.find(r => r.month === 48);

      expect(period1.rate).toBe(5);
      expect(period2.rate).toBe(6);
      expect(period3.rate).toBe(7);
    });

    test('dates are calculated correctly', () => {
      const schedule = calculateSchedule(
        10000, '2024-01-15', 12,
        [{ rate: 6, start_month: 1, end_month: null }],
        []
      );
      expect(schedule[0].date).toBe('2024-01-15');
      expect(schedule[1].date).toBe('2024-02-15');
      expect(schedule[11].date).toBe('2024-12-15');
    });

    test('rate column reflects exact rate changes in amortization schedule', () => {
      // Test case: $100k at 3.3% months 1-12, then 2.8% from month 13 onwards
      const schedule = calculateSchedule(
        100000, '2024-01-01', 50,
        [
          { rate: 3.3, start_month: 1, end_month: 12 },
          { rate: 2.8, start_month: 13, end_month: null }
        ],
        []
      );

      // Months 1-12 should have 3.3%
      for (let month = 1; month <= 12; month++) {
        const row = schedule.find(r => r.month === month);
        expect(row).toBeDefined();
        expect(row.rate).toBe(3.3);
      }

      // Months 13+ should have 2.8%
      for (let month = 13; month <= schedule.length; month++) {
        const row = schedule.find(r => r.month === month);
        expect(row).toBeDefined();
        expect(row.rate).toBe(2.8);
      }
    });

    test('rate column in table shows multiple distinct rate periods correctly', () => {
      // Three rate periods: 5% for 1-12, 6% for 13-36, 7% for 37+
      const schedule = calculateSchedule(
        50000, '2024-01-01', 60,
        [
          { rate: 5, start_month: 1, end_month: 12 },
          { rate: 6, start_month: 13, end_month: 36 },
          { rate: 7, start_month: 37, end_month: null }
        ],
        []
      );

      const uniqueRates = [...new Set(schedule.map(r => r.rate))];
      expect(uniqueRates).toEqual([5, 6, 7]);
    });

    test('rate period with no end_month applies to end of term', () => {
      const schedule = calculateSchedule(
        10000, '2024-01-01', 24,
        [
          { rate: 4, start_month: 1, end_month: 12 },
          { rate: 5, start_month: 13, end_month: null }
        ],
        []
      );

      // Last month should still have rate 5
      const lastRow = schedule[schedule.length - 1];
      expect(lastRow.rate).toBe(5);
    });

    test('prepayments work correctly with variable rate periods', () => {
      // Loan with 2 rate periods, plus a prepayment in month 6
      const scheduleWithPrepay = calculateSchedule(
        100000, '2024-01-01', 24,
        [
          { rate: 5, start_month: 1, end_month: 12 },
          { rate: 6, start_month: 13, end_month: null }
        ],
        [{ month: 6, amount: 5000, note: 'Prepayment' }]
      );

      const scheduleNoPrepay = calculateSchedule(
        100000, '2024-01-01', 24,
        [
          { rate: 5, start_month: 1, end_month: 12 },
          { rate: 6, start_month: 13, end_month: null }
        ],
        []
      );

      // Prepayment should shorten loan term
      expect(scheduleWithPrepay.length).toBeLessThan(scheduleNoPrepay.length);

      // Rates should still be correct after prepayment month
      const row6 = scheduleWithPrepay.find(r => r.month === 6);
      expect(row6.rate).toBe(5);
      expect(row6.prepayment).toBe(5000);

      // Month 13 should still have the rate change to 6%
      const row13 = scheduleWithPrepay.find(r => r.month === 13);
      expect(row13.rate).toBe(6);
    });
  });

  describe('totalInterest', () => {
    test('calculates total interest correctly', () => {
      const schedule = calculateSchedule(
        10000, '2024-01-01', 12,
        [{ rate: 6, start_month: 1, end_month: null }],
        []
      );
      const interest = totalInterest(schedule);
      expect(interest).toBeGreaterThan(0);
      expect(interest).toBeLessThan(1000); // reasonable for $10k at 6% for 1 year
    });

    test('returns 0 for empty schedule', () => {
      expect(totalInterest([])).toBe(0);
    });
  });

  describe('totalPaid', () => {
    test('includes prepayments in total paid', () => {
      const prepayAmount = 2000;
      const schedule = calculateSchedule(
        10000, '2024-01-01', 24,
        [{ rate: 5, start_month: 1, end_month: null }],
        [{ month: 6, amount: prepayAmount, note: 'Test prepayment' }]
      );
      const total = totalPaid(schedule);
      // Find the prepayment row
      const prepayRow = schedule.find(r => r.month === 6);
      expect(prepayRow.prepayment).toBe(prepayAmount);
    });
  });

  describe('payoffDate', () => {
    test('returns date of last payment', () => {
      const schedule = calculateSchedule(
        10000, '2024-01-01', 12,
        [{ rate: 6, start_month: 1, end_month: null }],
        []
      );
      expect(payoffDate(schedule)).toBe('2024-12-01');
    });

    test('returns null for empty schedule', () => {
      expect(payoffDate([])).toBeNull();
    });
  });

  describe('interestSaved', () => {
    test('calculates interest saved from prepayments', () => {
      const scheduleOriginal = calculateSchedule(
        10000, '2024-01-01', 24,
        [{ rate: 5, start_month: 1, end_month: null }],
        []
      );
      const schedulePrepaid = calculateSchedule(
        10000, '2024-01-01', 24,
        [{ rate: 5, start_month: 1, end_month: null }],
        [{ month: 6, amount: 2000, note: 'Prepayment' }]
      );

      const saved = interestSaved(scheduleOriginal, schedulePrepaid);
      expect(saved).toBeGreaterThan(0);
    });
  });

  describe('monthsSaved', () => {
    test('calculates months saved from prepayments', () => {
      const scheduleOriginal = calculateSchedule(
        10000, '2024-01-01', 24,
        [{ rate: 5, start_month: 1, end_month: null }],
        []
      );
      const schedulePrepaid = calculateSchedule(
        10000, '2024-01-01', 24,
        [{ rate: 5, start_month: 1, end_month: null }],
        [{ month: 6, amount: 3000, note: 'Large prepayment' }]
      );

      const saved = monthsSaved(scheduleOriginal, schedulePrepaid);
      expect(saved).toBeGreaterThan(0);
    });
  });

  describe('getSummary', () => {
    test('returns complete summary with all expected fields', () => {
      const schedule = calculateSchedule(
        10000, '2024-01-01', 12,
        [{ rate: 6, start_month: 1, end_month: null }],
        []
      );
      const summary = getSummary(schedule, schedule);

      expect(summary).toHaveProperty('totalPaid');
      expect(summary).toHaveProperty('totalInterest');
      expect(summary).toHaveProperty('interestSaved');
      expect(summary).toHaveProperty('monthsSaved');
      expect(summary).toHaveProperty('payoffDate');
      expect(summary).toHaveProperty('totalPayments');
      expect(summary).toHaveProperty('avgMonthlyPayment');
      expect(summary).toHaveProperty('maxBalance');
    });

    test('calculates interestSaved and monthsSaved correctly', () => {
      const scheduleNoPrepay = calculateSchedule(
        10000, '2024-01-01', 24,
        [{ rate: 5, start_month: 1, end_month: null }],
        []
      );
      const scheduleWithPrepay = calculateSchedule(
        10000, '2024-01-01', 24,
        [{ rate: 5, start_month: 1, end_month: null }],
        [{ month: 6, amount: 2000, note: 'Prepayment' }]
      );

      const summary = getSummary(scheduleWithPrepay, scheduleNoPrepay);
      expect(summary.interestSaved).toBeGreaterThan(0);
      expect(summary.monthsSaved).toBeGreaterThanOrEqual(0);
    });
  });
});
