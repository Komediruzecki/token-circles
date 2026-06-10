/**
 * Repository Index — initializes all repositories with the db instance
 * and exports a middleware that attaches them to every request.
 */

const { ProfilesRepository } = require('./profilesRepo');
const { TransactionsRepository } = require('./transactionsRepo');
const { CategoriesRepository } = require('./categoriesRepo');
const { AccountsRepository } = require('./accountsRepo');
const { BudgetsRepository } = require('./budgetsRepo');
const { GoalsRepository } = require('./goalsRepo');
const { LoansRepository } = require('./loansRepo');
const { BillsRepository } = require('./billsRepo');
const { TagsRepository } = require('./tagsRepo');
const { HousingRepository } = require('./housingRepo');
const { PortfolioRepository } = require('./portfolioRepo');
const { ReceiptsRepository } = require('./receiptsRepo');
const { RecurringRepository } = require('./recurringRepo');

/**
 * @param {import('better-sqlite3').Database} db
 */
function initRepositories(db) {
  return {
    profiles: new ProfilesRepository(db),
    transactions: new TransactionsRepository(db),
    categories: new CategoriesRepository(db),
    accounts: new AccountsRepository(db),
    budgets: new BudgetsRepository(db),
    goals: new GoalsRepository(db),
    loans: new LoansRepository(db),
    bills: new BillsRepository(db),
    tags: new TagsRepository(db),
    housing: new HousingRepository(db),
    portfolio: new PortfolioRepository(db),
    receipts: new ReceiptsRepository(db),
    recurring: new RecurringRepository(db),
  };
}

/**
 * Express middleware — attaches repos to req.repos
 */
function reposMiddleware(db) {
  const repos = initRepositories(db);
  return (req, _res, next) => {
    req.repos = repos;
    next();
  };
}

module.exports = { initRepositories, reposMiddleware };
