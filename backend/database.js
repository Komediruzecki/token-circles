const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(
  __dirname,
  '..',
  'db',
  process.env.NODE_ENV === 'test' ? 'test.db' : 'finance.db'
);
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize database schema
const fs = require('fs');
const schemaPath = path.join(__dirname, 'db', 'schema.sql');
if (fs.existsSync(schemaPath)) {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
}

// Seed demo user if no users exist
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
if (userCount.c === 0) {
  const bcrypt = require('bcrypt');
  const defaultUsername = process.env.DEFAULT_USERNAME || 'person';
  const defaultPassword = process.env.DEFAULT_PASSWORD || 'something-like-this';
  const passwordHash = bcrypt.hashSync(defaultPassword, 12);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
    defaultUsername,
    passwordHash
  );
}

// Seed a single default profile if no profiles exist
const profileCount = db.prepare('SELECT COUNT(*) as c FROM profiles').get();
if (profileCount.c === 0) {
  db.prepare('INSERT INTO profiles (name, user_id) VALUES (?, ?)').run('Personal Profile', 1);
}

function seedThreeTierProfiles() {
  const profiles = [
    { id: 1, name: 'Example Low Income', tier: 'low' },
    { id: 2, name: 'Example Mid Income', tier: 'mid' },
    { id: 3, name: 'Example High Income', tier: 'high' },
  ];

  // Insert the three profiles
  const insertProfile = db.prepare('INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (?, ?, ?)');
  for (const p of profiles) {
    insertProfile.run(p.id, p.name, 1);
  }

  // Seed categories for each profile if none exist
  for (const profile of profiles) {
    const catCount = db
      .prepare('SELECT COUNT(*) as c FROM categories WHERE profile_id = ?')
      .get(profile.id);
    if (catCount.c === 0) {
      seedCategoriesForProfile(profile.id);
    }
  }

  // Seed data for each profile if no transactions exist
  for (const profile of profiles) {
    const txCount = db
      .prepare('SELECT COUNT(*) as c FROM transactions WHERE profile_id = ?')
      .get(profile.id);
    if (txCount.c === 0) {
      seedProfileData(profile);
    }
  }
}

function seedCategoriesForProfile(profileId) {
  const insertCat = db.prepare(
    'INSERT INTO categories (name, color, icon, type, profile_id) VALUES (?, ?, ?, ?, ?)'
  );

  const categories = [
    // Income categories
    ['Salary Income', '#059669', 'briefcase', 'income'],
    ['Passive Income', '#2563eb', 'trending-up', 'income'],
    ['Investment Income', '#4f46e5', 'dollar-sign', 'income'],
    ['Other Income', '#9333ea', 'plus-circle', 'income'],
    // Expense categories
    ['Rent / Mortgage', '#dc2626', 'home', 'expense'],
    ['Utilities', '#475569', 'zap', 'expense'],
    ['Groceries', '#ea580c', 'shopping-cart', 'expense'],
    ['Clothing', '#7c3aed', 'shirt', 'expense'],
    ['Household Items', '#0891b2', 'package', 'expense'],
    ['Emergency Fund', '#dc2626', 'shield', 'expense'],
    ['Investments / Stocks / ETF', '#16a34a', 'bar-chart-2', 'expense'],
    ['Car', '#d97706', 'car', 'expense'],
    ['Car Maintenance', '#b45309', 'tool', 'expense'],
    ['Food / Eating Out / Restaurants', '#f97316', 'utensils', 'expense'],
    ['Health', '#16a34a', 'heart', 'expense'],
    ['Subscriptions', '#0891b2', 'tv', 'expense'],
    ['Transportation', '#6366f1', 'bus', 'expense'],
    ['Travel / Vacation', '#0d9488', 'plane', 'expense'],
    ['Education', '#db2777', 'book', 'expense'],
    ['Entertainment', '#8b5cf6', 'film', 'expense'],
    ['Personal Care', '#e11d48', 'smile', 'expense'],
    ['Insurance', '#64748b', 'shield-check', 'expense'],
    ['Gifts / Donations', '#ec4899', 'gift', 'expense'],
  ];

  for (const cat of categories) {
    insertCat.run(...cat, profileId);
  }
}

function seedProfileData(profile) {
  const { id: profileId, tier } = profile;

  // Get category IDs
  const cats = {};
  db.prepare('SELECT name, id FROM categories WHERE profile_id = ?')
    .all(profileId)
    .forEach((c) => {
      cats[c.name] = c.id;
    });

  // Get category ID helper
  const catId = (name) => cats[name] || null;

  // Tier-based configuration
  const tierConfig = getTierConfig(tier);
  const startYear = 2000;
  const currentYear = 2026;

  // Create accounts for this profile
  seedAccounts(profileId, tierConfig);

  // Create loans for this profile
  seedLoans(profileId, tierConfig, startYear);

  // Generate transactions
  seedTransactions(profileId, tierConfig, startYear, currentYear, catId);

  // Create budgets for all years
  seedBudgets(profileId, tierConfig, startYear, currentYear, catId);

  // Create savings goals
  seedSavingsGoals(profileId, tierConfig);

  // Create bills for this profile
  seedBills(profileId, tierConfig);

  // Set emergency fund config
  seedEmergencyFundConfig(profileId, tierConfig);

  // Create portfolio holdings
  seedPortfolio(profileId, tier);

  // Seed recurring transactions
  seedRecurringTransactions(profileId, tierConfig, catId);
}

function getTierConfig(tier) {
  const configs = {
    low: {
      // Monthly take-home: ~$2,500
      monthlySalary: 2500,
      minTransactionsPerMonth: 50,
      maxTransactionsPerMonth: 70,
      rent: { min: 600, max: 900 },
      utilities: { min: 80, max: 150 },
      groceries: { min: 250, max: 400 },
      dining: { min: 50, max: 120 },
      carPayment: { min: 150, max: 250 },
      gas: { min: 80, max: 140 },
      entertainment: { min: 30, max: 80 },
      healthcare: { min: 50, max: 150 },
      clothing: { min: 30, max: 80 },
      subscriptions: { min: 20, max: 50 },
      // Accounts
      accounts: [
        { name: 'Checking Account', type: 'giro', balance: 1200 },
        { name: 'Savings Account', type: 'savings', balance: 3500 },
      ],
      // Loan
      loans: [{ name: 'Used Car Loan', principal: 8000, rate: 7.5, term: 48 }],
      // Savings goals
      savingsGoals: [
        { name: 'Emergency Fund', target: 5000, current: 2500 },
        { name: 'Vehicle Replacement', target: 4000, current: 800 },
      ],
    },
    mid: {
      // Monthly take-home: ~$5,500
      monthlySalary: 5500,
      minTransactionsPerMonth: 70,
      maxTransactionsPerMonth: 100,
      rent: { min: 1200, max: 1800 },
      utilities: { min: 150, max: 250 },
      groceries: { min: 400, max: 600 },
      dining: { min: 150, max: 350 },
      carPayment: { min: 350, max: 500 },
      gas: { min: 120, max: 200 },
      entertainment: { min: 100, max: 250 },
      healthcare: { min: 100, max: 250 },
      clothing: { min: 80, max: 200 },
      subscriptions: { min: 50, max: 120 },
      investments: { min: 300, max: 600 },
      // Accounts
      accounts: [
        { name: 'Primary Checking', type: 'giro', balance: 3500 },
        { name: 'High-Yield Savings', type: 'savings', balance: 15000 },
        { name: 'Investment Account', type: 'investment', balance: 45000 },
      ],
      // Loans
      loans: [
        { name: 'Mortgage', principal: 250000, rate: 4.5, term: 360 },
        { name: 'Auto Loan', principal: 28000, rate: 5.2, term: 60 },
      ],
      // Savings goals
      savingsGoals: [
        { name: 'Emergency Fund', target: 15000, current: 12000 },
        { name: 'Home Renovation', target: 20000, current: 5000 },
        { name: 'Vacation Fund', target: 5000, current: 2000 },
      ],
    },
    high: {
      // Monthly take-home: ~$15,000
      monthlySalary: 15000,
      minTransactionsPerMonth: 80,
      maxTransactionsPerMonth: 120,
      rent: { min: 2500, max: 4000 },
      utilities: { min: 250, max: 450 },
      groceries: { min: 800, max: 1500 },
      dining: { min: 400, max: 1000 },
      carPayment: { min: 600, max: 1200 },
      gas: { min: 150, max: 300 },
      entertainment: { min: 300, max: 700 },
      healthcare: { min: 200, max: 500 },
      clothing: { min: 200, max: 500 },
      subscriptions: { min: 100, max: 250 },
      investments: { min: 2000, max: 4000 },
      // Accounts
      accounts: [
        { name: 'Primary Checking', type: 'giro', balance: 12000 },
        { name: 'High-Yield Savings', type: 'savings', balance: 60000 },
        { name: 'Investment Portfolio', type: 'investment', balance: 250000 },
        { name: 'Retirement (401k)', type: 'retirement', balance: 180000 },
      ],
      // Loans
      loans: [
        { name: 'Luxury Home Mortgage', principal: 850000, rate: 3.75, term: 360 },
        { name: 'Luxury Vehicle Lease', principal: 75000, rate: 4.2, term: 48 },
        { name: 'Investment Property Loan', principal: 300000, rate: 4.8, term: 240 },
      ],
      // Savings goals
      savingsGoals: [
        { name: 'Emergency Fund', target: 50000, current: 50000 },
        { name: 'Second Home Down Payment', target: 150000, current: 45000 },
        { name: 'Private School Fund', target: 100000, current: 25000 },
        { name: 'European Vacation 2026', target: 15000, current: 8000 },
      ],
    },
  };

  return configs[tier];
}

function seedAccounts(profileId, config) {
  const insertAccount = db.prepare(
    'INSERT INTO accounts (name, type, currency, balance, profile_id) VALUES (?, ?, ?, ?, ?)'
  );

  for (const acc of config.accounts) {
    insertAccount.run(acc.name, acc.type, 'USD', acc.balance, profileId);
  }
}

function seedLoans(profileId, config, startYear) {
  const insertLoan = db.prepare(
    'INSERT INTO loans (name, principal, interest_rate, start_date, term_months, profile_id) VALUES (?, ?, ?, ?, ?, ?)'
  );

  for (const loan of config.loans) {
    // Start loan at various points in the past 10 years
    const loanStartYear = startYear + 10 + Math.floor(Math.random() * 10);
    const loanStartMonth = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
    const startDate = `${loanStartYear}-${loanStartMonth}-01`;

    insertLoan.run(loan.name, loan.principal, loan.rate, startDate, loan.term, profileId);
  }
}

function seedTransactions(profileId, config, startYear, currentYear, catId) {
  const insertTx = db.prepare(
    'INSERT INTO transactions (description, amount, date, category_id, type, profile_id, currency, beneficiary, notes) VALUES (?,?,?,?,?,?,?,?,?)'
  );

  // Inflation rate
  const inflationRate = 0.03;
  const inflationMult = (year) => Math.pow(1 + inflationRate, year - startYear);

  const monthlySalary = config.monthlySalary;
  const targetMin = config.minTransactionsPerMonth;
  const targetMax = config.maxTransactionsPerMonth;

  for (let year = startYear; year <= currentYear; year++) {
    const monthsToSeed = year === currentYear ? new Date().getMonth() + 1 : 12;

    for (let month = 1; month <= monthsToSeed; month++) {
      const ym = `${year}-${String(month).padStart(2, '0')}`;
      const mult = inflationMult(year);
      const batch = [];

      // --- INCOME ---
      // Primary salary (bi-weekly)
      for (const day of ['01', '15']) {
        const basePay = (monthlySalary / 2) * mult;
        const variation = basePay * (0.95 + Math.random() * 0.1);
        batch.push([
          'Salary Deposit',
          variation.toFixed(2),
          `${ym}-${day}`,
          catId('Salary Income'),
          'income',
          profileId,
          'USD',
          'Employer Inc',
          `Pay period ${month}/${year}`,
        ]);
      }

      // Annual bonus (December)
      if (month === 12) {
        const bonusBase = monthlySalary * (0.5 + Math.random() * 0.5);
        batch.push([
          'Year-End Bonus',
          (bonusBase * mult).toFixed(2),
          `${ym}-20`,
          catId('Salary Income'),
          'income',
          profileId,
          'USD',
          'Employer Inc',
          'Annual performance bonus',
        ]);
      }

      // Passive income (quarterly rental)
      if (month % 3 === 0 && year >= 2005) {
        const passive = monthlySalary * 0.1 * mult * (0.8 + Math.random() * 0.4);
        batch.push([
          'Passive Income - Rental Property',
          passive.toFixed(2),
          `${ym}-${String(10 + Math.floor(Math.random() * 5)).padStart(2, '0')}`,
          catId('Passive Income'),
          'income',
          profileId,
          'USD',
          'Property Management LLC',
          'Q rental income',
        ]);
      }

      // Investment dividends (quarterly)
      if (month === 3 || month === 6 || month === 9 || month === 12) {
        const dividendBase = monthlySalary * 0.08 * mult * (0.5 + Math.random());
        batch.push([
          'Investment Dividend',
          dividendBase.toFixed(2),
          `${ym}-15`,
          catId('Investment Income'),
          'income',
          profileId,
          'USD',
          'Vanguard / Fidelity',
          'Quarterly dividend payment',
        ]);
      }

      // --- EXPENSES ---
      // Housing (1st)
      batch.push([
        'Rent Payment',
        randRange(config.rent.min, config.rent.max) * mult,
        `${ym}-01`,
        catId('Rent / Mortgage'),
        'expense',
        profileId,
        'USD',
        'Property Management Co',
        'Monthly rent',
      ]);

      // Utilities
      batch.push([
        'Electricity Bill',
        (randRange(60, 180) * mult).toFixed(2),
        `${ym}-12`,
        catId('Utilities'),
        'expense',
        profileId,
        'USD',
        'Power Company',
        '',
      ]);
      batch.push([
        'Natural Gas Bill',
        (randRange(40, 120) * mult).toFixed(2),
        `${ym}-15`,
        catId('Utilities'),
        'expense',
        profileId,
        'USD',
        'Gas Utility',
        '',
      ]);
      batch.push([
        'Water & Sewer',
        (randRange(30, 80) * mult).toFixed(2),
        `${ym}-18`,
        catId('Utilities'),
        'expense',
        profileId,
        'USD',
        'Water Dept',
        '',
      ]);
      batch.push([
        'Internet Service',
        (randRange(50, 100) * mult).toFixed(2),
        `${ym}-20`,
        catId('Utilities'),
        'expense',
        profileId,
        'USD',
        'ISP Provider',
        '',
      ]);
      batch.push([
        'Mobile Phone Plan',
        (randRange(40, 80) * mult).toFixed(2),
        `${ym}-10`,
        catId('Utilities'),
        'expense',
        profileId,
        'USD',
        'Verizon/AT&T',
        '',
      ]);

      // Groceries (3 visits)
      for (let w = 0; w < 3; w++) {
        const day = 5 + w * 7;
        batch.push([
          'Grocery Shopping',
          (randRange(config.groceries.min / 3, config.groceries.max / 3) * mult).toFixed(2),
          `${ym}-${String(Math.min(day, 28)).padStart(2, '0')}`,
          catId('Groceries'),
          'expense',
          profileId,
          'USD',
          'Supermarket Chain',
          '',
        ]);
      }

      // Food / Eating Out
      const diningCount = Math.floor(randRange(3, 6));
      for (let i = 0; i < diningCount; i++) {
        const day = 3 + i * 5 + Math.floor(Math.random() * 3);
        const restaurants = [
          'Local Bistro',
          'Pizza Place',
          'Sushi Bar',
          'Burger Joint',
          'Thai Restaurant',
          'Italian Place',
        ];
        batch.push([
          'Restaurant / Takeout',
          (
            randRange(config.dining.min / diningCount, config.dining.max / diningCount) * mult
          ).toFixed(2),
          `${ym}-${String(Math.min(day, 28)).padStart(2, '0')}`,
          catId('Food / Eating Out / Restaurants'),
          'expense',
          profileId,
          'USD',
          restaurants[Math.floor(Math.random() * restaurants.length)],
          '',
        ]);
      }

      // Coffee / Lunch
      const lunchCount = Math.floor(randRange(1, 3));
      for (let i = 0; i < lunchCount; i++) {
        const day = 5 + i * 8 + Math.floor(Math.random() * 3);
        batch.push([
          'Coffee / Lunch',
          (randRange(8, 20) * mult).toFixed(2),
          `${ym}-${String(Math.min(day, 28)).padStart(2, '0')}`,
          catId('Food / Eating Out / Restaurants'),
          'expense',
          profileId,
          'USD',
          'Coffee Shop / Cafe',
          '',
        ]);
      }

      // Car & Transportation
      if (config.carPayment) {
        batch.push([
          'Auto Loan Payment',
          (randRange(config.carPayment.min, config.carPayment.max) * mult).toFixed(2),
          `${ym}-05`,
          catId('Car'),
          'expense',
          profileId,
          'USD',
          'Auto Lender',
          'Monthly car payment',
        ]);
      }

      // Gas fill-ups
      const gasFreq = config.tier === 'low' ? 2 : 4;
      for (let g = 0; g < gasFreq; g++) {
        const day = 3 + g * 7 + Math.floor(Math.random() * 3);
        batch.push([
          'Gas Station',
          (randRange(config.gas.min / gasFreq, config.gas.max / gasFreq) * mult).toFixed(2),
          `${ym}-${String(Math.min(day, 28)).padStart(2, '0')}`,
          catId('Car'),
          'expense',
          profileId,
          'USD',
          'Shell / Chevron',
          '',
        ]);
      }

      // Car maintenance (quarterly)
      if (month % 3 === 0) {
        batch.push([
          'Car Maintenance / Service',
          (randRange(100, 300) * mult).toFixed(2),
          `${ym}-${String(15 + Math.floor(Math.random() * 5)).padStart(2, '0')}`,
          catId('Car Maintenance'),
          'expense',
          profileId,
          'USD',
          'Auto Shop',
          'Oil change, inspections',
        ]);
      }

      // Insurance
      batch.push([
        'Health Insurance Premium',
        (randRange(50, 300) * mult).toFixed(2),
        `${ym}-01`,
        catId('Insurance'),
        'expense',
        profileId,
        'USD',
        'Insurance Co',
        'Monthly health insurance',
      ]);
      if (month % 3 === 1) {
        batch.push([
          'Auto Insurance Premium',
          (randRange(100, 200) * mult).toFixed(2),
          `${ym}-${String(5 + Math.floor(Math.random() * 10)).padStart(2, '0')}`,
          catId('Insurance'),
          'expense',
          profileId,
          'USD',
          'State Farm / Allstate',
          '',
        ]);
      }
      if (month === 1) {
        batch.push([
          'Home/Renters Insurance Annual',
          (randRange(300, 1200) * mult).toFixed(2),
          `${ym}-10`,
          catId('Insurance'),
          'expense',
          profileId,
          'USD',
          'Insurance Co',
          'Annual premium',
        ]);
      }

      // Healthcare
      const healthVisits = Math.floor(randRange(1, 2));
      for (let h = 0; h < healthVisits; h++) {
        const day = 10 + h * 10 + Math.floor(Math.random() * 5);
        batch.push([
          'Medical / Pharmacy',
          (randRange(config.healthcare.min / 2, config.healthcare.max / 2) * mult).toFixed(2),
          `${ym}-${String(Math.min(day, 28)).padStart(2, '0')}`,
          catId('Health'),
          'expense',
          profileId,
          'USD',
          'Doctor / Pharmacy',
          '',
        ]);
      }

      // Subscriptions
      const subscriptions = [
        'Netflix Subscription',
        'Spotify Premium',
        'Gym Membership',
        'Online News Sub',
        'Cloud Storage',
      ];
      const subCount = config.tier === 'high' ? 4 : config.tier === 'mid' ? 3 : 2;
      for (let s = 0; s < subCount; s++) {
        const subCosts = [15, 10, 40, 10, 10];
        batch.push([
          subscriptions[s],
          (subCosts[s] * mult).toFixed(2),
          `${ym}-${String(5 + Math.floor(Math.random() * 20)).padStart(2, '0')}`,
          catId('Subscriptions'),
          'expense',
          profileId,
          'USD',
          'Service Provider',
          '',
        ]);
      }

      // Clothing (quarterly)
      if (month === 2 || month === 5 || month === 8 || month === 11) {
        batch.push([
          'Clothing / Apparel Purchases',
          (randRange(config.clothing.min, config.clothing.max) * mult).toFixed(2),
          `${ym}-${String(15 + Math.floor(Math.random() * 5)).padStart(2, '0')}`,
          catId('Clothing'),
          'expense',
          profileId,
          'USD',
          'Retail Store / Online',
          '',
        ]);
      }

      // Household
      batch.push([
        'Household Supplies',
        (randRange(50, 150) * mult).toFixed(2),
        `${ym}-${String(10 + Math.floor(Math.random() * 10)).padStart(2, '0')}`,
        catId('Household Items'),
        'expense',
        profileId,
        'USD',
        'Target / Walmart',
        '',
      ]);

      // Online shopping
      const amazonOrders = Math.floor(randRange(1, 2));
      for (let a = 0; a < amazonOrders; a++) {
        const day = 8 + a * 10 + Math.floor(Math.random() * 4);
        batch.push([
          'Online Shopping',
          (randRange(30, 120) * mult).toFixed(2),
          `${ym}-${String(Math.min(day, 28)).padStart(2, '0')}`,
          catId('Household Items'),
          'expense',
          profileId,
          'USD',
          'Amazon.com',
          '',
        ]);
      }

      // Entertainment
      const entertainmentCount = Math.floor(randRange(1, 3));
      for (let e = 0; e < entertainmentCount; e++) {
        const day = 7 + e * 10 + Math.floor(Math.random() * 3);
        const activities = ['Movie Theater', 'Concert / Event', 'Sports Game', 'Arcade / Bowling'];
        batch.push([
          activities[e % activities.length],
          (
            randRange(
              config.entertainment.min / entertainmentCount,
              config.entertainment.max / entertainmentCount
            ) * mult
          ).toFixed(2),
          `${ym}-${String(Math.min(day, 28)).padStart(2, '0')}`,
          catId('Entertainment'),
          'expense',
          profileId,
          'USD',
          'Venue / Theater',
          '',
        ]);
      }

      // Education
      if (month === 1 || month === 9) {
        batch.push([
          'Education / Course / Books',
          (randRange(50, 300) * mult).toFixed(2),
          `${ym}-${String(5 + Math.floor(Math.random() * 10)).padStart(2, '0')}`,
          catId('Education'),
          'expense',
          profileId,
          'USD',
          'University / Online Course',
          '',
        ]);
      }

      // Personal care
      const personalVisits = Math.floor(randRange(1, 2));
      for (let p = 0; p < personalVisits; p++) {
        const day = 6 + p * 12 + Math.floor(Math.random() * 3);
        batch.push([
          'Personal Care / Grooming',
          (randRange(25, 60) * mult).toFixed(2),
          `${ym}-${String(Math.min(day, 28)).padStart(2, '0')}`,
          catId('Personal Care'),
          'expense',
          profileId,
          'USD',
          'Salon / Barber',
          '',
        ]);
      }

      // Travel (July & December)
      if (month === 7 || month === 12) {
        const travelMult = config.tier === 'high' ? 2 : 1;
        batch.push([
          'Travel / Vacation',
          (randRange(500, 2000) * travelMult * mult).toFixed(2),
          `${ym}-${String(1 + Math.floor(Math.random() * 10)).padStart(2, '0')}`,
          catId('Travel / Vacation'),
          'expense',
          profileId,
          'USD',
          'Airline / Hotel / Travel Agency',
          '',
        ]);
      }

      // Public transportation
      const transitCount = config.tier === 'low' ? 4 : 2;
      for (let t = 0; t < transitCount; t++) {
        const day = 2 + t * 7 + Math.floor(Math.random() * 2);
        batch.push([
          'Public Transportation',
          (randRange(2, 5) * mult).toFixed(2),
          `${ym}-${String(Math.min(day, 28)).padStart(2, '0')}`,
          catId('Transportation'),
          'expense',
          profileId,
          'USD',
          'Metro / Bus',
          '',
        ]);
      }

      // Investments (monthly)
      if (config.investments && month !== 12) {
        batch.push([
          'Investment Contribution',
          (randRange(config.investments.min, config.investments.max) * mult).toFixed(2),
          `${ym}-05`,
          catId('Investments / Stocks / ETF'),
          'expense',
          profileId,
          'USD',
          'Brokerage Account',
          'Monthly investment deposit',
        ]);
      }

      // Emergency fund (Jan & July)
      if (month === 1 || month === 7) {
        batch.push([
          'Emergency Fund Transfer',
          (config.monthlySalary * 0.05 * mult).toFixed(2),
          `${ym}-${String(25 + Math.floor(Math.random() * 3)).padStart(2, '0')}`,
          catId('Emergency Fund'),
          'expense',
          profileId,
          'USD',
          'Savings Account',
          'Semi-annual emergency fund contribution',
        ]);
      }

      // Gifts / Donations
      if (month === 12) {
        batch.push([
          'Holiday Gifts / Charity',
          (randRange(200, 800) * mult).toFixed(2),
          `${ym}-20`,
          catId('Gifts / Donations'),
          'expense',
          profileId,
          'USD',
          'Various',
          '',
        ]);
      } else if (month === 6 || month === 11) {
        batch.push([
          'Gift / Donation',
          (randRange(50, 150) * mult).toFixed(2),
          `${ym}-${String(10 + Math.floor(Math.random() * 10)).padStart(2, '0')}`,
          catId('Gifts / Donations'),
          'expense',
          profileId,
          'USD',
          'Charity / Gift Recipient',
          '',
        ]);
      }

      // --- Pad to reach a random target between min and max with random purchases ---
      const target = targetMin + Math.floor(Math.random() * (targetMax - targetMin + 1));
      const padNeeded = target - batch.length;
      for (let i = 0; i < Math.max(0, padNeeded); i++) {
        const day = 1 + Math.floor(Math.random() * 28);
        const cats = [
          'Groceries',
          'Food / Eating Out / Restaurants',
          'Entertainment',
          'Personal Care',
          'Household Items',
        ];
        batch.push([
          'Miscellaneous Purchase',
          (randRange(10, 50) * mult).toFixed(2),
          `${ym}-${String(day).padStart(2, '0')}`,
          catId(cats[Math.floor(Math.random() * cats.length)]),
          'expense',
          profileId,
          'USD',
          'Various Merchant',
          '',
        ]);
      }

      // Insert all for this month
      for (const tx of batch) {
        insertTx.run(...tx);
      }
    }
  }
}

function seedBudgets(profileId, config, startYear, currentYear, catId) {
  const insertBudget = db.prepare(
    'INSERT INTO budgets (category_id, amount, period, start_date, profile_id) VALUES (?, ?, ?, ?, ?)'
  );

  // Create budgets for all years from startYear to currentYear (each year gets all 12 months)
  const years = [];
  for (let y = startYear; y <= currentYear; y++) {
    years.push(y);
  }

  // Calculate avg monthly spend per category from all historical transactions
  const avgSpends = db
    .prepare(
      `
    SELECT category_id, AVG(monthly_total) as avg_amount
    FROM (
      SELECT category_id, strftime('%Y-%m', date) as month, SUM(amount) as monthly_total
      FROM transactions
      WHERE profile_id = ? AND type = 'expense' AND category_id IS NOT NULL
      GROUP BY category_id, month
    )
    GROUP BY category_id
  `
    )
    .all(profileId);

  const avgMap = {};
  for (const row of avgSpends) {
    avgMap[row.category_id] = row.avg_amount;
  }

  // Create budgets for each year/month based on historical averages
  // Category names must EXACTLY match seedCategoriesForProfile names
  const budgetCategories = [
    'Rent / Mortgage',
    'Utilities',
    'Groceries',
    'Food / Eating Out / Restaurants',
    'Car',
    'Health',
    'Entertainment',
    'Clothing',
    'Subscriptions',
    'Transportation',
    'Travel / Vacation',
    'Education',
    'Personal Care',
    'Household Items',
  ];

  for (const year of years) {
    // Skip future years beyond current year + 1
    if (year > currentYear + 1) break;

    for (let month = 1; month <= 12; month++) {
      const monthStr = `${year}-${String(month).padStart(2, '0')}-01`;
      for (const catName of budgetCategories) {
        const cid = catId(catName);
        if (cid) {
          const avg = avgMap[cid] || 0;
          // Budget = 100% of average (realistic baseline)
          const budgetAmount =
            avg > 0 ? avg : config[catName.toLowerCase().replace(/[^a-z]+/g, '')]?.min || 100;
          insertBudget.run(cid, budgetAmount.toFixed(2), 'monthly', monthStr, profileId);
        }
      }
    }
  }
}

function seedSavingsGoals(profileId, config) {
  const insertGoal = db.prepare(
    'INSERT INTO savings_goals (name, target_amount, current_amount, deadline, notes, profile_id) VALUES (?, ?, ?, ?, ?, ?)'
  );

  // Current year + 1 to 3 years out
  const currentYear = new Date().getFullYear();

  for (const goal of config.savingsGoals) {
    const deadline = `${currentYear + (Math.random() > 0.5 ? 1 : 2)}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-01`;
    insertGoal.run(
      goal.name,
      goal.target,
      goal.current,
      deadline,
      `Savings goal for ${goal.name}`,
      profileId
    );
  }
}

function seedBills(profileId, config) {
  const insertBill = db.prepare(
    'INSERT INTO bills (name, amount, profile_id, due_date, next_due_date, recurring, category_id, last_paid_date, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const bills = [
    {
      name: 'Rent / Mortgage',
      amount: config.rent?.min || 1000,
      frequency: 'monthly',
      day_of_month: 1,
      type: 'bill',
    },
    { name: 'Electricity Bill', amount: 150, frequency: 'monthly', day_of_month: 15, type: 'bill' },
    { name: 'Natural Gas Bill', amount: 80, frequency: 'monthly', day_of_month: 20, type: 'bill' },
    {
      name: 'Internet Service',
      amount: 70,
      frequency: 'monthly',
      day_of_month: 5,
      type: 'subscription',
    },
    { name: 'Car Insurance', amount: 120, frequency: 'monthly', day_of_month: 10, type: 'bill' },
    { name: 'Health Insurance', amount: 200, frequency: 'monthly', day_of_month: 1, type: 'bill' },
    {
      name: 'Netflix',
      amount: 15.99,
      frequency: 'monthly',
      day_of_month: 10,
      type: 'subscription',
    },
    {
      name: 'Spotify',
      amount: 11.99,
      frequency: 'monthly',
      day_of_month: 15,
      type: 'subscription',
    },
    {
      name: 'Cloud Storage',
      amount: 9.99,
      frequency: 'monthly',
      day_of_month: 20,
      type: 'subscription',
    },
  ];

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  for (const bill of bills) {
    // Calculate due date based on frequency and day_of_month
    let dueDate, nextDueDate;
    if (bill.frequency === 'monthly' && bill.day_of_month !== undefined) {
      const day = Math.min(Math.max(1, bill.day_of_month), 28);
      dueDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      // Calculate next month's due date
      let nextMonth = currentMonth + 1;
      let nextYear = currentYear;
      if (nextMonth >= 12) {
        nextMonth = 0;
        nextYear++;
      }
      nextDueDate = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    } else {
      dueDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-15`;
      nextDueDate = `${currentYear}-${String(currentMonth + 3).padStart(2, '0')}-15`;
    }

    insertBill.run(
      bill.name,
      bill.amount,
      profileId,
      dueDate,
      nextDueDate,
      1, // recurring
      null, // category_id
      null, // last_paid_date
      bill.type || 'bill'
    );
  }
}

function seedEmergencyFundConfig(profileId, config) {
  const insertConfig = db.prepare(
    'INSERT OR REPLACE INTO emergency_fund_config (id, monthly_expenses, profile_id) VALUES (1, ?, ?)'
  );

  // Monthly expenses = roughly 80% of salary
  const monthlyExpenses = config.monthlySalary * 0.8;
  insertConfig.run(monthlyExpenses.toFixed(2), profileId);
}

function seedPortfolio(profileId, tier) {
  const insertHolding = db.prepare(
    'INSERT INTO portfolio_holdings (ticker, shares, purchase_price, purchase_date, notes, profile_id) VALUES (?, ?, ?, ?, ?, ?)'
  );

  // Portfolio configurations per tier
  const portfolios = {
    low: [
      {
        ticker: 'SPY',
        shares: 5,
        price: 420.0,
        date: '2025-01-15',
        notes: 'S&P 500 ETF - starter position',
      },
      {
        ticker: 'VTI',
        shares: 8,
        price: 210.0,
        date: '2025-03-10',
        notes: 'Total US Stock Market ETF',
      },
    ],
    mid: [
      {
        ticker: 'SPY',
        shares: 20,
        price: 410.0,
        date: '2024-06-15',
        notes: 'S&P 500 ETF - core position',
      },
      { ticker: 'QQQ', shares: 15, price: 350.0, date: '2024-08-01', notes: 'Nasdaq-100 ETF' },
      {
        ticker: 'AMD',
        shares: 50,
        price: 120.0,
        date: '2025-02-20',
        notes: 'AMD semiconductor growth',
      },
      {
        ticker: 'VTI',
        shares: 25,
        price: 215.0,
        date: '2024-11-10',
        notes: 'Total US Stock Market ETF',
      },
      { ticker: 'AAPL', shares: 30, price: 175.0, date: '2025-01-05', notes: 'Apple Inc.' },
    ],
    high: [
      {
        ticker: 'SPY',
        shares: 75,
        price: 400.0,
        date: '2024-01-15',
        notes: 'S&P 500 ETF - large core position',
      },
      { ticker: 'QQQ', shares: 60, price: 340.0, date: '2024-03-20', notes: 'Nasdaq-100 ETF' },
      {
        ticker: 'NVDA',
        shares: 100,
        price: 85.0,
        date: '2024-05-10',
        notes: 'NVIDIA - AI/GPU growth',
      },
      { ticker: 'AMD', shares: 150, price: 110.0, date: '2024-08-15', notes: 'AMD semiconductor' },
      {
        ticker: 'AAPL',
        shares: 80,
        price: 170.0,
        date: '2024-06-01',
        notes: 'Apple Inc. - core holding',
      },
      {
        ticker: 'VTI',
        shares: 100,
        price: 205.0,
        date: '2024-09-01',
        notes: 'Total US Stock Market ETF',
      },
      {
        ticker: 'MSFT',
        shares: 40,
        price: 380.0,
        date: '2025-01-10',
        notes: 'Microsoft - cloud/AI play',
      },
      { ticker: 'GOOGL', shares: 35, price: 140.0, date: '2025-02-15', notes: 'Alphabet Inc.' },
    ],
  };

  const holdings = portfolios[tier] || [];
  for (const h of holdings) {
    insertHolding.run(h.ticker, h.shares, h.price, h.date, h.notes, profileId);
  }
}

function seedRecurringTransactions(profileId, config, catId) {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const yyyy = nextMonth.getFullYear();
  const mm = String(nextMonth.getMonth() + 1).padStart(2, '0');
  const dd = '01';
  const nextDate = `${yyyy}-${mm}-${dd}`;

  const insert = db.prepare(
    `INSERT INTO recurring_transactions (profile_id, description, amount, type, category_id, frequency, day_of_month, next_date, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );

  const recurring = [
    // Income
    {
      desc: 'Monthly Salary',
      amount: config.monthlySalary,
      type: 'income',
      cat: 'Salary Income',
      freq: 'monthly',
      dom: 1,
    },
    // Housing
    {
      desc: 'Rent Payment',
      amount: Math.round((config.rent.min + config.rent.max) / 2),
      type: 'expense',
      cat: 'Rent / Mortgage',
      freq: 'monthly',
      dom: 5,
    },
    // Utilities
    {
      desc: 'Electric Bill',
      amount: Math.round(config.utilities.max * 0.6),
      type: 'expense',
      cat: 'Utilities',
      freq: 'monthly',
      dom: 10,
    },
    {
      desc: 'Water Bill',
      amount: Math.round(config.utilities.max * 0.25),
      type: 'expense',
      cat: 'Utilities',
      freq: 'monthly',
      dom: 15,
    },
    {
      desc: 'Internet Service',
      amount: Math.round(config.utilities.max * 0.35),
      type: 'expense',
      cat: 'Utilities',
      freq: 'monthly',
      dom: 20,
    },
    // Subscriptions
    {
      desc: 'Streaming Services',
      amount: Math.round(config.subscriptions.max * 0.6),
      type: 'expense',
      cat: 'Subscriptions',
      freq: 'monthly',
      dom: 3,
    },
    {
      desc: 'Gym Membership',
      amount: Math.round(config.subscriptions.max * 0.4),
      type: 'expense',
      cat: 'Subscriptions',
      freq: 'monthly',
      dom: 1,
    },
    // Transportation
    {
      desc: 'Car Payment',
      amount: Math.round((config.carPayment.min + config.carPayment.max) / 2),
      type: 'expense',
      cat: 'Car',
      freq: 'monthly',
      dom: 7,
    },
    {
      desc: 'Fuel',
      amount: Math.round((config.gas.min + config.gas.max) / 2),
      type: 'expense',
      cat: 'Transportation',
      freq: 'weekly',
      dom: null,
    },
    // Insurance
    {
      desc: 'Health Insurance',
      amount: Math.round(config.healthcare.max * 0.7),
      type: 'expense',
      cat: 'Insurance',
      freq: 'monthly',
      dom: 1,
    },
    {
      desc: 'Car Insurance',
      amount: Math.round(config.healthcare.max * 0.3),
      type: 'expense',
      cat: 'Insurance',
      freq: 'monthly',
      dom: 15,
    },
    // Groceries
    {
      desc: 'Weekly Groceries',
      amount: Math.round(config.groceries.max / 4),
      type: 'expense',
      cat: 'Groceries',
      freq: 'weekly',
      dom: null,
    },
  ];

  // Add investments for mid and high tiers
  if (config.investments) {
    recurring.push({
      desc: 'Monthly Investment',
      amount: Math.round((config.investments.min + config.investments.max) / 2),
      type: 'expense',
      cat: 'Investments / Stocks / ETF',
      freq: 'monthly',
      dom: 2,
    });
  }

  for (const r of recurring) {
    const catId_val = catId(r.cat);
    const nextDate_adjusted = r.dom ? `${yyyy}-${mm}-${String(r.dom).padStart(2, '0')}` : nextDate;
    insert.run(profileId, r.desc, r.amount, r.type, catId_val, r.freq, r.dom, nextDate_adjusted);
  }
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}



module.exports = db;
module.exports.seedThreeTierProfiles = seedThreeTierProfiles;
module.exports.PROFILES_TO_NUKE = [1, 2, 3];
