/**
 * Loan Calculator with variable rate periods and prepayments
 * Uses standard amortization formula for each rate period
 */

/**
 * Calculate monthly payment for a given principal, annual rate, and number of months
 */
function calcMonthlyPayment(principal, annualRate, months) {
  if (annualRate === 0) return principal / months;
  const r = annualRate / 100 / 12;
  return (principal * (r * Math.pow(1 + r, months))) / (Math.pow(1 + r, months) - 1);
}

/**
 * Calculate amortization schedule for a loan with variable rate periods and prepayments
 * Returns array of { month, payment, principal, interest, balance, prepayAmount, rate }
 */
function calculateSchedule(principal, startDate, termMonths, ratePeriods, prepayments) {
  // Sort rate periods by start_month
  const sortedRates = [...ratePeriods].sort((a, b) => a.start_month - b.start_month);
  const sortedPrepayments = [...(prepayments || [])].sort((a, b) => a.month - b.month);

  const schedule = [];
  let balance = principal;
  let monthIndex = 0;
  let lockedPayment = null;

  while (balance > 0.01 && monthIndex < termMonths * 2) {
    monthIndex++;

    // Determine current rate
    let currentRate = 0;
    for (const rp of sortedRates) {
      if (rp.start_month <= monthIndex) {
        if (!rp.end_month || monthIndex <= rp.end_month) {
          currentRate = rp.rate;
        }
      }
    }

    // Determine if there's a prepayment this month
    const prepayment = sortedPrepayments.find((p) => p.month === monthIndex);
    const prepayAmount = prepayment ? prepayment.amount : 0;

    const remainingMonths = termMonths - monthIndex + 1;
    if (remainingMonths <= 0) break;

    // Only recalculate locked payment after prepayment (not on rate change)
    if (prepayment || lockedPayment === null) {
      lockedPayment = calcMonthlyPayment(balance, currentRate, remainingMonths);
    }

    const interestPortion = balance * (currentRate / 100 / 12);
    let principalPortion = lockedPayment - interestPortion;

    // Apply prepayment
    if (prepayment) {
      principalPortion += prepayAmount;
    }

    // Don't overpay
    if (principalPortion > balance) {
      principalPortion = balance;
    }

    balance = Math.max(0, balance - principalPortion);

    // Calculate date for this month
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + monthIndex - 1);
    const monthDate = d.toISOString().split('T')[0];

    schedule.push({
      month: monthIndex,
      date: monthDate,
      payment: lockedPayment,
      principal: principalPortion - (prepayment ? prepayAmount : 0),
      interest: interestPortion,
      balance: balance,
      prepayment: prepayAmount || 0,
      rate: currentRate,
      note: prepayment ? prepayment.note || '' : '',
    });
  }

  return schedule;
}

/**
 * Calculate schedule WITHOUT prepayments for comparison
 */
function calculateScheduleNoPrepayments(principal, startDate, termMonths, ratePeriods) {
  return calculateSchedule(principal, startDate, termMonths, ratePeriods, []);
}

/**
 * Calculate total interest paid
 */
function totalInterest(schedule) {
  return schedule.reduce((sum, row) => sum + row.interest, 0);
}

/**
 * Calculate total amount paid
 */
function totalPaid(schedule) {
  return schedule.reduce((sum, row) => sum + row.payment + row.prepayment, 0);
}

/**
 * Calculate payoff date
 */
function payoffDate(schedule) {
  if (schedule.length === 0) return null;
  return schedule[schedule.length - 1].date;
}

/**
 * Calculate interest saved from prepayments
 */
function interestSaved(originalSchedule, prepaySchedule) {
  return totalInterest(originalSchedule) - totalInterest(prepaySchedule);
}

/**
 * Calculate months saved from prepayments.
 * Uses financial equivalence: interest saved / monthly payment of original schedule.
 * Falls back to schedule-length difference when equivalence rounds to 0 but
 * actual months were eliminated (e.g. late-term prepayments).
 */
function monthsSaved(originalSchedule, prepaySchedule) {
  const saved = interestSaved(originalSchedule, prepaySchedule);
  const monthlyPayment = originalSchedule.length > 0 ? originalSchedule[0].payment : 1;
  const equivMonths = Math.round(saved / monthlyPayment);
  const eliminatedMonths = originalSchedule.length - prepaySchedule.length;
  return Math.max(equivMonths, eliminatedMonths);
}

/**
 * Get summary stats
 */
function getSummary(schedule, originalSchedule) {
  const originalInterest = totalInterest(originalSchedule);
  const newInterest = totalInterest(schedule);
  const originalMonths = originalSchedule.length;
  const newMonths = schedule.length;

  return {
    totalPaid: totalPaid(schedule),
    totalInterest: newInterest,
    interestSaved: originalInterest - newInterest,
    monthsSaved: monthsSaved(originalSchedule, schedule),
    payoffDate: payoffDate(schedule),
    totalPayments: schedule.length,
    avgMonthlyPayment:
      schedule.length > 0 ? schedule.reduce((s, r) => s + r.payment, 0) / schedule.length : 0,
    maxBalance: schedule.length > 0 ? schedule[0].balance : 0,
    originalTotalInterest: originalInterest,
    originalTotalPayments: originalMonths,
  };
}

module.exports = {
  calculateSchedule,
  calculateScheduleNoPrepayments,
  totalInterest,
  totalPaid,
  payoffDate,
  interestSaved,
  monthsSaved,
  getSummary,
  calcMonthlyPayment,
};
