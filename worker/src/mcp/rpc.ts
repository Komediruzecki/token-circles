import type { Context } from 'hono';
import type { AppEnv } from '../index';
import { assertScope } from '../apitoken';
import { ensureProfile } from '../profile';
import { HttpError } from '../http';
import { findTool, guardSize, toolListPayload } from './registry';
import * as db from '../db';

// Stateless streamable HTTP. Every POST carries everything the server needs, so there is no
// session to negotiate, nothing to resume, and no Durable Object to hold it -- which is what
// makes this fit a plain Worker.

export const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'token-circles', version: '1.0.0' };

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const ok = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: unknown, code: number, message: string) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

/** Resolve the profile a call acts on: explicit arg, then the token default, then the first. */
async function resolveProfile(c: Context<AppEnv>, requested: unknown): Promise<number> {
  const userId = c.get('userId');
  const candidate =
    typeof requested === 'number' ? requested : (c.get('token')?.defaultProfileId ?? null);
  if (candidate != null) {
    const owned = await db.first(
      c.env.DB,
      'SELECT 1 AS ok FROM profiles WHERE id = ? AND user_id = ?',
      candidate,
      userId
    );
    if (owned) return candidate;
    // An explicitly named profile that is not theirs is an error, not something to paper over.
    if (typeof requested === 'number') {
      throw new HttpError(403, 'That profile does not belong to this user.');
    }
  }
  return ensureProfile(c);
}

/** Returns null for a notification (no id) -- the caller answers 202 with no body. */
export async function dispatch(
  c: Context<AppEnv>,
  message: RpcRequest
): Promise<Record<string, unknown> | null> {
  const { id, method } = message;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, toolListPayload());

    case 'tools/call': {
      const name = String(message.params?.name ?? '');
      const tool = findTool(name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${name}`);

      // A tool-level failure is a RESULT with isError, not a protocol error: the model needs to
      // read it and try something else, and a protocol error would just abort the turn.
      try {
        assertScope(c, tool.scope);
        const parsed = tool.input.safeParse(message.params?.arguments ?? {});
        if (!parsed.success) {
          const detail = parsed.error.issues
            .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('; ');
          return ok(id, {
            isError: true,
            content: [{ type: 'text', text: `Invalid argument -- ${detail}` }],
          });
        }
        const profileId = await resolveProfile(
          c,
          (parsed.data as { profileId?: unknown })?.profileId
        );
        const result = guardSize(await tool.handler(c, parsed.data, profileId));
        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        });
      } catch (err) {
        const text = err instanceof Error ? err.message : 'Tool failed';
        return ok(id, { isError: true, content: [{ type: 'text', text }] });
      }
    }

    default:
      if (isNotification) return null;
      return fail(id, -32601, `Method not found: ${method}`);
  }
}
