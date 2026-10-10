import { z } from 'zod';
import { defineTool } from './registry';
import { executeImport } from '../routes/imports';
import { recalcGoalsByCategory } from '../recalc-goals';
import { HttpError, accept, refuse } from '../http';
import * as db from '../db';
import { localMonth } from '../local-date';
import { BUDGET_MESSAGES, checkBudgetCreate } from '../../../shared/budgetSchema';
import { addCalendarMonths } from '../../../shared/calendarMonths';
import { checkTagCreate, clashingTagName, defaultTagColor } from '../../../shared/tagSchema';

// Write tools: append plus curate. No arbitrary update or delete -- an agent should be able to
// add rows and to act on its own analysis, and its mistakes should stay additive and reversible
// (undo_import is the one delete, and it is scoped to a batch id).

import { profileArg, DATE } from './args';

const quoted = (names: readonly string[]) => names.map((name) => `"${name}"`);

/** The refusal for rows that name accounts the profile does not have. */
function unknownAccounts(unknown: readonly string[], existing: readonly string[]): string {
  const missing = quoted(unknown);
  const which =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(', ')} or ${missing[missing.length - 1]}`;
  const have =
    existing.length > 0
      ? `Its accounts are ${quoted(existing).join(', ')}.`
      : 'It has no accounts yet.';
  return `This profile has no account named ${which}. ${have} Create an account with create_account first, or leave accountName out. Nothing was added.`;
}

defineTool({
  name: 'create_transactions',
  title: 'Create transactions',
  description:
    'Add transactions in bulk. Duplicates of rows already present are skipped rather than inserted, so re-sending an overlapping batch is safe. Use this for data you parsed yourself (a PDF statement, a scraped page); for a CSV or XLSX file use prepare_import instead, which does not push the file through your context.',
  scope: 'write',
  input: z
    .object({
      ...profileArg,
      transactions: z
        .array(
          z.object({
            date: z.string().regex(DATE),
            description: z.string().min(1).max(500),
            amount: z.number().describe('Negative for an expense, positive for income.'),
            type: z.enum(['income', 'expense', 'transfer']).default('expense'),
            currency: z.string().length(3).optional(),
            accountName: z
              .string()
              .max(200)
              .optional()
              .describe(
                'The name of an account in the profile (list_reference_data lists them), any case. A name that matches none is refused: create the account with create_account first.'
              ),
            categoryName: z.string().max(200).optional().describe('Existing categories only.'),
            beneficiary: z.string().max(200).optional(),
            notes: z.string().max(1000).optional(),
          })
        )
        .min(1)
        .max(500),
    })
    .strict(),
  handler: async (c, args, profileId) => {
    // Every account a row names must already exist. executeImport creates none here (no
    // categoryTypes), so a row naming an account that was not there landed with no account at
    // all, while this tool's description promised one would be created. The call is refused
    // before anything is written, and says which accounts there are, so an agent can correct it.
    const named = [
      ...new Set(args.transactions.map((t) => t.accountName?.trim() ?? '').filter(Boolean)),
    ];
    if (named.length > 0) {
      const accounts = await db.all<{ name: string }>(
        c.env.DB,
        'SELECT name FROM accounts WHERE profile_id = ? ORDER BY name',
        profileId
      );
      // Matched as executeImport matches them: trimmed, any case.
      const known = new Set(accounts.map((a) => a.name.trim().toLowerCase()));
      const unknown = named.filter((name) => !known.has(name.toLowerCase()));
      if (unknown.length > 0) {
        throw new HttpError(
          400,
          unknownAccounts(
            unknown,
            accounts.map((a) => a.name)
          )
        );
      }
    }

    // Routed through executeImport rather than a hand-written INSERT: that path already owns
    // account resolution, the multiplicity-aware duplicate check, category gating and the
    // balance recompute. A second insert path would drift from the transaction invariants.
    //
    // The account column is `means_of_payment`, NOT `account` -- that is the column
    // executeImport resolves account names from (see offerAccount / mopName in imports.ts).
    const mapping: Record<string, number> = {
      date: 0,
      description: 1,
      amount: 2,
      type: 3,
      currency: 4,
      means_of_payment: 5,
      category: 6,
      beneficiary: 7,
      notes: 8,
    };
    const rows = args.transactions.map((t) => [
      t.date,
      t.description,
      String(t.amount),
      t.type,
      t.currency ?? '',
      t.accountName ?? '',
      t.categoryName ?? '',
      t.beneficiary ?? '',
      t.notes ?? '',
    ]);

    const outcome = await executeImport(c.env.DB, profileId, {
      rows,
      mapping,
      importId: crypto.randomUUID(),
      // Categories must already exist: an agent inventing a taxonomy row by row is exactly
      // what the import gate refuses, and the same reasoning applies here.
      approvedCategories: [],
      // No `today`: MCP answers on the UTC calendar unless the client sends X-Time-Zone
      // (docs/mcp-server.md, "Dates are UTC"). It is never reached here anyway: every row
      // carries its own date, and no categoryTypes means no account is created.
    });
    if (outcome.status >= 400) {
      throw new HttpError(outcome.status, String(outcome.body.error ?? 'Could not create rows'));
    }
    const body = outcome.body;
    return {
      imported: Number(body.imported ?? 0),
      duplicates: Number(body.duplicates ?? 0),
      skipped: Number(body.skipped ?? 0),
      accountsCreated: Number(body.accounts_created ?? 0),
    };
  },
});

defineTool({
  name: 'create_account',
  title: 'Create an account',
  description:
    'Create a bank account, card or cash account in the profile. Returns its id, which create_transactions and list_transactions take.',
  scope: 'write',
  input: z
    .object({
      ...profileArg,
      name: z.string().min(1).max(200),
      type: z.string().max(50).default('giro').describe('e.g. giro, savings, credit, cash.'),
      currency: z.string().length(3).default('EUR'),
      bankName: z.string().max(200).optional(),
      startingBalance: z.number().default(0),
    })
    .strict(),
  handler: async (c, args, profileId) => {
    const existing = await db.first<{ id: number }>(
      c.env.DB,
      'SELECT id FROM accounts WHERE profile_id = ? AND lower(name) = lower(?)',
      profileId,
      args.name
    );
    if (existing) throw new HttpError(409, `An account named "${args.name}" already exists.`);

    const res = await db.insert(c.env.DB, 'accounts', {
      name: args.name,
      type: args.type,
      currency: args.currency.toUpperCase(),
      bank_name: args.bankName ?? '',
      balance: args.startingBalance,
      starting_balance: args.startingBalance,
      profile_id: profileId,
    });
    return { id: Number(res.meta.last_row_id), name: args.name };
  },
});

defineTool({
  name: 'categorize_transactions',
  title: 'Categorize transactions',
  description:
    'Set the category, and optionally add tags, on transactions you name by id. This is how you act on your own analysis. To make the change apply to future transactions too, follow it with upsert_tag_rule.',
  scope: 'write',
  input: z
    .object({
      ...profileArg,
      transactionIds: z.array(z.number().int()).min(1).max(500),
      categoryId: z.number().int().optional(),
      addTagIds: z.array(z.number().int()).max(20).optional(),
    })
    .strict(),
  handler: async (c, args, profileId) => {
    if (args.categoryId === undefined && !args.addTagIds?.length) {
      throw new HttpError(400, 'Provide categoryId, addTagIds, or both.');
    }
    if (args.categoryId !== undefined) {
      const owned = await db.first(
        c.env.DB,
        'SELECT 1 AS ok FROM categories WHERE id = ? AND profile_id = ?',
        args.categoryId,
        profileId
      );
      if (!owned) throw new HttpError(403, 'That category does not belong to this profile.');
    }
    for (const tagId of args.addTagIds ?? []) {
      const owned = await db.first(
        c.env.DB,
        'SELECT 1 AS ok FROM tags WHERE id = ? AND profile_id = ?',
        tagId,
        profileId
      );
      if (!owned) throw new HttpError(403, `Tag ${tagId} does not belong to this profile.`);
    }

    const placeholders = args.transactionIds.map(() => '?').join(',');
    let updated = 0;
    if (args.categoryId !== undefined) {
      const res = await db.run(
        c.env.DB,
        `UPDATE transactions SET category_id = ?
          WHERE profile_id = ? AND id IN (${placeholders})`,
        args.categoryId,
        profileId,
        ...args.transactionIds
      );
      updated = res.meta.changes ?? 0;
      // Savings goals track category totals; the transactions routes recalc after any category
      // change, and skipping it here would leave goals stale in a way nothing surfaces.
      // Argument order is (db, categoryId, profileIds) -- easy to get backwards.
      await recalcGoalsByCategory(c.env.DB, args.categoryId, [profileId]);
    }

    let tagged = 0;
    for (const tagId of args.addTagIds ?? []) {
      const res = await db.run(
        c.env.DB,
        `INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
         SELECT id, ? FROM transactions WHERE profile_id = ? AND id IN (${placeholders})`,
        tagId,
        profileId,
        ...args.transactionIds
      );
      tagged += res.meta.changes ?? 0;
    }
    return { updated, tagged, requested: args.transactionIds.length };
  },
});

defineTool({
  name: 'upsert_tag_rule',
  title: 'Save a tagging rule',
  description:
    'Create or update a rule that tags matching transactions automatically, now and in future. Use this to persist a categorization insight instead of only fixing the rows in front of you. The tag is found by its name in any case, and created, with a name of up to 50 characters, when the profile has none by that name.',
  scope: 'write',
  input: z
    .object({
      ...profileArg,
      tagName: z.string().min(1).max(100),
      name: z.string().min(1).max(200).describe('Human label for the rule.'),
      criteria: z
        .record(z.string(), z.unknown())
        .describe('Rule criteria object as defined by shared/tagRules.ts.'),
      autoApply: z.boolean().default(true),
    })
    .strict(),
  handler: async (c, args, profileId) => {
    // The profile's tag of that name, in any case and with any space around it, as the Tags page
    // finds a name taken; a new one is checked and coloured as the Tags page creates one.
    const own = await db.all<{ id: number; name: string }>(
      c.env.DB,
      'SELECT id, name FROM tags WHERE profile_id = ? ORDER BY id',
      profileId
    );
    const taken = clashingTagName(own, args.tagName);
    let tag = taken === null ? undefined : own.find((row) => row.name === taken);
    if (!tag) {
      const { name, color } = accept(
        checkTagCreate({ name: args.tagName }, defaultTagColor(own.length))
      );
      const created = await db.insert(c.env.DB, 'tags', { name, color, profile_id: profileId });
      tag = { id: Number(created.meta.last_row_id), name };
    }

    const existing = await db.first<{ id: number }>(
      c.env.DB,
      'SELECT id FROM tag_rules WHERE profile_id = ? AND tag_id = ? AND name = ?',
      profileId,
      tag.id,
      args.name
    );
    const criteria = JSON.stringify(args.criteria);
    if (existing) {
      await db.update(
        c.env.DB,
        'tag_rules',
        { criteria, auto_apply: args.autoApply ? 1 : 0 },
        'id = ? AND profile_id = ?',
        existing.id,
        profileId
      );
      return { tagId: tag.id, ruleId: existing.id, created: false };
    }
    const created = await db.insert(c.env.DB, 'tag_rules', {
      profile_id: profileId,
      tag_id: tag.id,
      name: args.name,
      criteria,
      auto_apply: args.autoApply ? 1 : 0,
    });
    return { tagId: tag.id, ruleId: Number(created.meta.last_row_id), created: true };
  },
});

defineTool({
  name: 'upsert_budget',
  title: 'Create or adjust a budget',
  description:
    'Set the budget amount for a category and period, creating it if there is none. Use this to act on a recommendation about spending limits.',
  scope: 'write',
  // The amount and the start date are the app's to check (shared/budgetSchema.ts): zero or more,
  // to the cent, and a real date. The tool took any positive number and any date-shaped text.
  input: z
    .object({
      ...profileArg,
      categoryId: z.number().int(),
      amount: z.number(),
      period: z.enum(['monthly', 'yearly']).default('monthly'),
      startDate: z.string(),
    })
    .strict(),
  handler: async (c, args, profileId) => {
    const budget = accept(
      checkBudgetCreate(
        {
          category_id: args.categoryId,
          amount: args.amount,
          period: args.period,
          start_date: args.startDate,
        },
        { monthStart: `${localMonth(c)}-01` }
      )
    );
    // Another profile's category is refused at the category, as the app's budget routes refuse it.
    if (!(await db.categoryBelongsToProfile(c.env.DB, budget.category_id, profileId))) {
      throw refuse({ category_id: BUDGET_MESSAGES.category });
    }

    // The budget its month (a yearly one, its year) already has, whatever day that one starts, as
    // the app's Allocate finds it: matched on the exact date, a second budget was added.
    const from =
      budget.period === 'yearly'
        ? `${budget.start_date.slice(0, 4)}-01-01`
        : `${budget.start_date.slice(0, 7)}-01`;
    const existing = await db.first<{ id: number }>(
      c.env.DB,
      `SELECT id FROM budgets
        WHERE profile_id = ? AND category_id = ? AND period = ? AND start_date >= ? AND start_date < ?
        ORDER BY start_date, id`,
      profileId,
      budget.category_id,
      budget.period,
      from,
      addCalendarMonths(from, budget.period === 'yearly' ? 12 : 1)
    );
    if (existing) {
      await db.update(
        c.env.DB,
        'budgets',
        { amount: budget.amount },
        'id = ? AND profile_id = ?',
        existing.id,
        profileId
      );
      return { id: existing.id, created: false, amount: budget.amount };
    }
    const created = await db.insert(c.env.DB, 'budgets', {
      profile_id: profileId,
      category_id: budget.category_id,
      amount: budget.amount,
      period: budget.period,
      start_date: budget.start_date,
    });
    return { id: Number(created.meta.last_row_id), created: true, amount: budget.amount };
  },
});
