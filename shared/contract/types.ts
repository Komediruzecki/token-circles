/**
 * The CRUD contract: scenarios written once and run against both runtimes, the Worker on a real
 * D1 (worker/test/contract.test.ts) and local-first on IndexedDB
 * (frontend/src/core/storage/__tests__/contract.test.ts). A scenario writes through the API and
 * reads the result back, so a route that answers 200 and stores nothing fails here, in the runtime
 * that does it.
 *
 * Test-only: nothing in the app imports shared/contract. It cannot import vitest either (pnpm puts
 * no vitest at the repository root), so each runner hands its own `expect` in.
 */

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Runtime = 'worker' | 'local';

/** An answer's parsed JSON. Scenarios read whatever came back, so it is not typed further. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface Reply {
  status: number;
  /** The answer's JSON, or its text when it is not JSON. */
  body: Json;
  /** The answer's media type, as its Content-Type header names it ('' when it names none). */
  type: string;
}

/**
 * The API as one profile of one person sees it. A body goes as JSON, except a FormData, which goes
 * as the multipart form a file upload sends.
 */
export interface ContractApi {
  readonly runtime: Runtime;
  /** The id of the profile this API acts as. */
  readonly profile: number;
  get(path: string): Promise<Reply>;
  post(path: string, body?: unknown): Promise<Reply>;
  put(path: string, body?: unknown): Promise<Reply>;
  patch(path: string, body?: unknown): Promise<Reply>;
  delete(path: string): Promise<Reply>;
  /** The same person, acting as their second profile. */
  readonly other: ContractApi;
  /** The same person, acting as another profile of theirs: one a scenario made, or a restore gave. */
  as(profile: number): ContractApi;
  /** This profile sending no profile header, as the app sends a whole-account backup or restore. */
  readonly unscoped: ContractApi;
  /**
   * This profile with the second one selected too, reading across both as the household switcher
   * has the app read (`apiHouseholdGet`).
   */
  readonly household: ContractApi;
  /**
   * What storage holds for a profile, read below the API, so a deleted profile can still be looked
   * at: the rows of each kind that carry its id, and the rows that hang off the loans, accounts and
   * transactions given (an extra payment belongs to a loan, not to a profile).
   */
  stored(profile: number, owned?: Owned): Promise<Record<StoredKind, number>>;
}

/** The kinds of row `ContractApi.stored` counts. */
export const STORED_KINDS = [
  'accounts',
  'balance history',
  'bills',
  'budgets',
  'categories',
  'category mappings',
  'goals',
  'holdings',
  'housing',
  'import logs',
  'import sources',
  'loan extra payments',
  'loan rate periods',
  'loans',
  'receipts',
  'recurring',
  'retirement goals',
  'retirement settings',
  'tag rules',
  'tags',
  'transaction tags',
  'transactions',
] as const;
export type StoredKind = (typeof STORED_KINDS)[number];

/** The rows a profile's own rows own in turn, by their ids. */
export interface Owned {
  loans?: readonly number[];
  accounts?: readonly number[];
  transactions?: readonly number[];
}

/** The part of vitest's `expect` the scenarios use. Each runner passes vitest's own. */
export interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toMatchObject(expected: object): void;
  toContainEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toHaveLength(length: number): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeGreaterThan(n: number): void;
  toBeGreaterThanOrEqual(n: number): void;
  toBeLessThan(n: number): void;
  toBeCloseTo(n: number, digits?: number): void;
  readonly not: Matchers;
}

export interface Expect {
  (actual: unknown, message?: string): Matchers;
  objectContaining(expected: Record<string, unknown>): Json;
  arrayContaining(expected: unknown[]): Json;
  any(constructor: unknown): Json;
}

export interface Scenario {
  name: string;
  run(api: ContractApi, expect: Expect): Promise<void>;
}

export function scenario(name: string, run: Scenario['run']): Scenario {
  return { name, run };
}

/** A write that worked: any 2xx. The message carries the answer, so a refusal says why. */
export function expectOk(expect: Expect, reply: Reply, what: string): void {
  const said = `${what} answered ${reply.status}: ${JSON.stringify(reply.body)}`;
  expect(reply.status, said).toBeGreaterThanOrEqual(200);
  expect(reply.status, said).toBeLessThan(300);
}

/** Adds a row and answers its id, which both runtimes return as `id`. */
export async function added(
  api: ContractApi,
  expect: Expect,
  path: string,
  body: unknown
): Promise<number> {
  const reply = await api.post(path, body);
  expectOk(expect, reply, `POST ${path}`);
  expect(reply.body?.id, `POST ${path} answered ${JSON.stringify(reply.body)}`).toEqual(
    expect.any(Number)
  );
  return reply.body.id as number;
}
