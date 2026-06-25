/**
 * Shared utility functions extracted from index.js
 */
const path = require('path');
const fs = require('fs');

// Helper function to convert snake_case keys to camelCase
function toCamelCase(obj) {
  if (Array.isArray(obj)) {
    return obj.map((item) => toCamelCase(item));
  }
  if (obj !== null && typeof obj === 'object') {
    const result = {};
    Object.keys(obj).forEach((key) => {
      const camelKey = key.replace(/_([a-z])/g, function (_, letter) {
        return letter.toUpperCase();
      });
      result[camelKey] = toCamelCase(obj[key]);
    });
    return result;
  }
  return obj;
}

// Map category name to an appropriate icon key
function getCategoryIcon(name) {
  const lower = name.toLowerCase();
  const patterns = [
    [/car|auto|vehicle|transport|gas|fuel|parking|uber|lyft|toll/i, 'car'],
    [/food|dining|grocer|restaurant|eat|meal|lunch|dinner|breakfast|cafe|coffee/i, 'coffee'],
    [/hous|rent|mortgage|home|lease|property|real\s*estate/i, 'home'],
    [/utilit|electric|water|gas\s*bill|sewer|trash|garbage|recycling|power|energy/i, 'zap'],
    [
      /entertain|fun|game|movie|cinema|theatre|theater|concert|music|stream|netflix|spotify|hulu|disney|hbo/i,
      'film',
    ],
    [/shop|retail|cloth|apparel|mall|amazon|walmart|target|costco/i, 'shopping-cart'],
    [
      /health|medical|doctor|dentist|pharma|hospital|clinic|therapy|vet|vision|eye|glasses/i,
      'heart',
    ],
    [/edu|school|college|university|tuition|book|course|class|learn|study|student/i, 'book'],
    [/travel|flight|airfare|airline|hotel|airbnb|vacation|trip|holiday/i, 'plane'],
    [/insur/i, 'shield'],
    [/sav|invest|retire|ira|401|stock|broker|dividend|interest/i, 'trending-up'],
    [/phone|mobile|cell|internet|wifi|broadband|telecom|data\s*plan/i, 'smartphone'],
    [/gift|donat|charit|present/i, 'gift'],
    [/pet|dog|cat|animal/i, 'smile'],
    [/fit|gym|sport|exercise|workout|yoga|bike|cycling|run/i, 'bar-chart-2'],
    [/subscri|member|recur/i, 'arrow-right'],
    [/child|kid|baby|daycare|nanny|babysit|school\s*supp/i, 'baby'],
    [/beaut|spa|salon|hair|nail|cosmet|skin|makeup|barber/i, 'sun'],
    [/business|work|office|supplies|desk/i, 'briefcase'],
    [/tax|irs|government/i, 'folder'],
    [/credit|debt|loan|card|payment/i, 'creditcard'],
    [/income|salary|wage|paycheck|payroll|earn|revenue|reimbursement/i, 'dollar-sign'],
    [/misc|other|general|uncategor|unknown|various|catch.?all/i, 'more-horizontal'],
    [/bill/i, 'file-text'],
  ];
  for (const [pattern, icon] of patterns) {
    if (pattern.test(lower)) return icon;
  }
  return 'tag';
}

// Retirement projection calculation helper
function calculateRetirementProjection(
  database,
  profileId,
  settings = null,
  currentAge = 30,
  retirementAge = 65,
  currentSavings = 0,
  monthlyContribution = 500,
  annualReturn = 7,
  withdrawalRate = 4,
  country = 'US'
) {
  const monthsToRetirement = (retirementAge - currentAge) * 12;
  const annualContribution = monthlyContribution * 12;
  const countryAdjustment = country === 'US' ? 1.0 : 0.9;
  const monthlyExpenses = (currentAge >= retirementAge ? 0 : 2500) * countryAdjustment;
  const adjustedExpenses = country === 'US' && currentAge >= retirementAge ? 2500 : monthlyExpenses;
  const annualWithdrawal = adjustedExpenses * 12;

  let savings = currentSavings;
  let investmentGains = 0;
  let balance = savings;

  for (let i = 1; i <= monthsToRetirement; i++) {
    const monthlyReturn = annualReturn / 100 / 12;
    investmentGains += savings * monthlyReturn;
    savings += monthlyContribution;
    balance = savings + investmentGains;
  }

  let retirementSavings = balance;
  let yearsInRetirement = 0;
  let balanceAtYearEnd = retirementSavings;
  let finalBalance = retirementSavings;

  while (retirementSavings > 0 && yearsInRetirement < 50) {
    retirementSavings -= annualWithdrawal;
    const annualReturnReal = (annualReturn - 3) / 100;
    retirementSavings *= 1 + annualReturnReal;
    yearsInRetirement++;
    balanceAtYearEnd = Math.max(0, retirementSavings);
    finalBalance = balanceAtYearEnd;
  }

  const shortfall = balanceAtYearEnd < 0 ? Math.abs(balanceAtYearEnd) : 0;
  const yearsOfRunway = Math.round(retirementSavings / (annualWithdrawal / 12));

  return {
    currentAge,
    retirementAge,
    currentSavings: Math.round(currentSavings),
    monthlyContribution: Math.round(monthlyContribution),
    annualReturn: Math.round(annualReturn),
    withdrawalRate: Math.round(withdrawalRate),
    country,
    expensesAtRetirement: Math.round(annualWithdrawal),
    retirementSavings: Math.round(retirementSavings),
    retirementAgeActual: retirementAge + yearsInRetirement,
    yearsInRetirement,
    balanceAtRetirement: Math.round(balance),
    finalBalance: Math.round(finalBalance),
    shortfall,
    yearsOfRunway,
    current_age: currentAge,
    retirement_age: retirementAge,
    current_amount: Math.round(currentSavings),
    annual_contribution: Math.round(annualContribution),
    expected_return: Math.round(annualReturn),
    withdrawal_rate: Math.round(withdrawalRate),
    years_to_retire: retirementAge - currentAge,
    projected_total: Math.round(balance),
    projected_income: Math.round(balance > 0 ? balance * 0.04 : 0),
    monthly_income_in_retirement: Math.round(balance > 0 ? (balance * 0.04) / 12 : 0),
  };
}

function isValidEmail(email) {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(email || ''));
}

function isValidHexColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(String(color || ''));
}

module.exports = { toCamelCase, getCategoryIcon, calculateRetirementProjection, isValidEmail, isValidHexColor };
