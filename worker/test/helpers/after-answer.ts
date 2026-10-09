/**
 * Requests to the Worker that also wait for the work a route does after its answer: the mail, the
 * code or the link it hands to ctx.waitUntil. SELF.fetch comes back with the answer alone, so a
 * test that reads what that work wrote sends its request through here instead.
 */
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import worker, { type Env } from '../../src/index';

/** Send a request, and come back once its answer and everything it left running are done. */
export async function fetchSettled(input: string, init?: RequestInit): Promise<Response> {
  const sent = fetchUnsettled(input, init);
  const answer = await sent.answer;
  await sent.settled();
  return answer;
}

/**
 * Send a request. `answer` is its answer, as SELF.fetch gives it; `settled` waits for the work it
 * left running after the answer, for a test that holds that work (a held mail) and lets it go.
 */
export function fetchUnsettled(
  input: string,
  init?: RequestInit
): { answer: Promise<Response>; settled: () => Promise<void> } {
  const ctx = createExecutionContext();
  const answer = Promise.resolve(
    worker.fetch(new Request(input, init), env as unknown as Env, ctx)
  );
  return { answer, settled: () => waitOnExecutionContext(ctx) };
}
