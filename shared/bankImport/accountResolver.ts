/**
 * Bank statement import — target-account resolution.
 *
 * A statement rarely self-identifies which of the user's app accounts it belongs
 * to (e.g. three Revolut accounts look identical). This resolves a best-effort
 * target account and produces a stable signature so the UI can *remember* the
 * user's manual choice and auto-apply it next time. Pure — persistence of the
 * remembered map / per-account identifiers lives in the store layer.
 */
import type { BankId, StatementMeta } from './types';

export interface AccountLike {
  name: string;
  bank_name?: string | null;
}

/** A stable key for a statement source, used to remember the user's account choice. */
export function statementSignature(bankId: BankId, meta: StatementMeta, filename: string): string {
  const parts = [bankId, meta.iban || '', meta.accountLast4 || ''];
  if (!meta.iban && !meta.accountLast4) parts.push(filenameStem(filename));
  return parts.join('|').toLowerCase();
}

/** Strip an Apps Script timestamp prefix, trailing digits and the extension. */
function filenameStem(filename: string): string {
  return filename
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}t[\d-]+z_/i, '')
    .replace(/[_\d]+$/g, '')
    .trim();
}

/**
 * Resolve the app account a statement should import into, best-effort:
 *   1. a remembered choice for this exact signature,
 *   2. an account whose stored import identifiers (IBAN / card last-4) match,
 *   3. an account whose name or bank_name references the bank,
 * else null — the UI asks the user to pick (and then remembers it).
 */
export function resolveTargetAccount(
  bankId: BankId,
  meta: StatementMeta,
  filename: string,
  accounts: AccountLike[],
  remembered: Record<string, string> = {},
  identifiers: Record<string, string[]> = {}
): string | null {
  const sig = statementSignature(bankId, meta, filename);
  const named = (name: string) => accounts.find((a) => a.name === name)?.name ?? null;

  const rememberedName = remembered[sig];
  if (rememberedName && named(rememberedName)) return rememberedName;

  const ibanLc = meta.iban?.toLowerCase();
  const last4 = meta.accountLast4;
  for (const [name, ids] of Object.entries(identifiers)) {
    const idsLc = ids.map((x) => x.toLowerCase());
    if ((ibanLc && idsLc.includes(ibanLc)) || (last4 && idsLc.includes(last4))) {
      const hit = named(name);
      if (hit) return hit;
    }
  }

  const byBank = accounts.find((a) => accountNamesBank(a, bankId));
  return byBank?.name ?? null;
}

/**
 * Whether an account's name or bank name names the bank `bankId`. An id of three characters or
 * fewer ("ing", "dkb", "n26") counts only as a word of its own: inside a word it is English, and
 * an ING statement went into the first account whose name had "ing" in it (Main Checking,
 * Savings). A longer one counts inside a word as well, as German bank names hold it
 * ("Stadtsparkasse").
 */
export function accountNamesBank(account: AccountLike, bankId: BankId): boolean {
  const id = bankId.toLowerCase();
  const texts = [account.bank_name || '', account.name].map((text) => text.toLowerCase());
  if (id.length > 3) return texts.some((text) => text.includes(id));
  const word = new RegExp(`(?:^|[^\\p{L}\\p{N}])${id}(?:$|[^\\p{L}\\p{N}])`, 'u');
  return texts.some((text) => word.test(text));
}
