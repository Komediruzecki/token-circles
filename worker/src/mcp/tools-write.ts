import { z } from 'zod';
import { defineTool } from './registry';
import { executeImport } from '../routes/imports';
import { recalcGoalsByCategory } from '../recalc-goals';
import { HttpError } from '../http';
import * as db from '../db';

// Write tools: append plus curate. No arbitrary update or delete -- an agent should be able to
// add rows and to act on its own analysis, and its mistakes should stay additive and reversible
// (undo_import is the one delete, and it is scoped to a batch id).

import { profileArg, DATE } from './args';

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
              .describe('Matched against existing account names; created if new.'),
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
    'Create or update a rule that tags matching transactions automatically, now and in future. Use this to persist a categorization insight instead of only fixing the rows in front of you. The tag is created if it does not exist.',
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
    let tag = await db.first<{ id: number }>(
      c.env.DB,
      'SELECT id FROM tags WHERE profile_id = ? AND lower(name) = lower(?)',
      profileId,
      args.tagName
    );
    if (!tag) {
      const created = await db.insert(c.env.DB, 'tags', {
        name: args.tagName,
        profile_id: profileId,
      });
      tag = { id: Number(created.meta.last_row_id) };
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
  input: z
    .object({
      ...profileArg,
      categoryId: z.number().int(),
      amount: z.number().positive(),
      period: z.enum(['monthly', 'yearly']).default('monthly'),
      startDate: z.string().regex(DATE),
    })
    .strict(),
  handler: async (c, args, profileId) => {
    const owned = await db.first(
      c.env.DB,
      'SELECT 1 AS ok FROM categories WHERE id = ? AND profile_id = ?',
      args.categoryId,
      profileId
    );
    if (!owned) throw new HttpError(403, 'That category does not belong to this profile.');

    const existing = await db.first<{ id: number }>(
      c.env.DB,
      'SELECT id FROM budgets WHERE profile_id = ? AND category_id = ? AND period = ? AND start_date = ?',
      profileId,
      args.categoryId,
      args.period,
      args.startDate
    );
    if (existing) {
      await db.update(
        c.env.DB,
        'budgets',
        { amount: args.amount },
        'id = ? AND profile_id = ?',
        existing.id,
        profileId
      );
      return { id: existing.id, created: false, amount: args.amount };
    }
    const created = await db.insert(c.env.DB, 'budgets', {
      profile_id: profileId,
      category_id: args.categoryId,
      amount: args.amount,
      period: args.period,
      start_date: args.startDate,
    });
    return { id: Number(created.meta.last_row_id), created: true, amount: args.amount };
  },
});
