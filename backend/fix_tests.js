const fs = require('fs');
const path = require('path');

const dir = '../test/e2e/backend-api/';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.spec.js'));

const replacements = {
  nextDate: 'next_date',
  dayOfMonth: 'day_of_month',
  totalExpenses: 'total_expenses',
  totalMonthly: 'total_monthly',
  totalIncome: 'total_income',
  totalTransfers: 'total_transfers',
  netSavings: 'net_savings',
  savingsRate: 'savings_rate',
  accountId: 'account_id',
  profileId: 'profile_id',
  categoryId: 'category_id',
  parentId: 'parent_id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  categoryName: 'category_name',
  categoryColor: 'category_color',
  amountLocal: 'amount_local',
  exchangeRate: 'exchange_rate',
  transferAccountId: 'transfer_account_id',
  autoAssigned: 'auto_assigned',
  isSystem: 'is_system',
};

for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  for (const [camel, snake] of Object.entries(replacements)) {
    content = content.replace(
      new RegExp(`toHaveProperty\\('${camel}'\\)`, 'g'),
      `toHaveProperty('${snake}')`
    );
    content = content.replace(new RegExp(`\\.((?:${camel}))(?![A-Za-z0-9_])`, 'g'), `.${snake}`);
    content = content.replace(new RegExp(`tx\\.${camel}`, 'g'), `tx.${snake}`);
    content = content.replace(new RegExp(`cat\\.${camel}`, 'g'), `cat.${snake}`);
  }

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${file}`);
  }
}
