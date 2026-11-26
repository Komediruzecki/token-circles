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
 * Banks whose name is commonly the tail of a compound bank name: "Stadtsparkasse",
 * "Kreissparkasse" (round 4). Of the banks the app reads, only Sparkasse. Volksbank and
 * Raiffeisenbank end compounds too, but the app reads neither yet; they go here when it does.
 */
const COMPOUND_TAILS: ReadonlySet<BankId> = new Set<BankId>(['sparkasse']);

/**
 * What joins a bank id into a longer word, on one side of it: a Latin letter, or a mark on one
 * (every bank id is Latin letters and digits), and a digit where the id's own character on that
 * side is a digit. A letter of another script, a space, punctuation, and a digit beside a letter
 * of the id are edges.
 */
const joiner = (idChar: string): string =>
  `\\p{sc=Latin}\\p{M}${/[0-9]/.test(idChar) ? '0-9' : ''}`;

/**
 * Whether an account's name or bank name names the bank `bankId`: the id as a word of its own,
 * compared in NFC. "ING2", "pbz2", "ING-DiBa" and "ING銀行" name their banks; "Main Checking"
 * (ing), "Erstes Konto" (erste), "Otherwise" (wise), "Revolution" (revolut), "éing" (ing) and
 * "N267" (n26) do not. A bank commonly at the tail of a compound (COMPOUND_TAILS) is named by a
 * word that ends in it, letters before it and none after: "Stadtsparkasse Giro", not
 * "Sparkassenbuch" (round 4; whole words alone dropped every German compound).
 */
export function accountNamesBank(account: AccountLike, bankId: BankId): boolean {
  const id = bankId.toLowerCase();
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // No lookbehind: Safari before 16.4 throws on one.
  const before = COMPOUND_TAILS.has(bankId) ? '' : `(?:^|[^${joiner(id[0])}])`;
  const after = `(?![${joiner(id[id.length - 1])}])`;
  const alone = new RegExp(`${before}${escaped}${after}`, 'u');
  const texts = [account.bank_name || '', account.name].map((text) =>
    text.normalize('NFC').toLowerCase()
  );
  return texts.some((text) => alone.test(text));
}
