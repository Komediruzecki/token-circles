import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireToken } from '../apitoken';
import { enforce } from '../ratelimit';
import { dispatch } from './rpc';
// Registering the tool modules is a side effect of importing them.
import './tools-read';
import './tools-import';
import './tools-write';

export const mcpRoutes = new Hono<AppEnv>();

// Nothing here is server-initiated, so there is no SSE stream to open.
mcpRoutes.get('/mcp', (c) => c.json({ error: 'Method not allowed' }, 405));

mcpRoutes.post('/mcp', requireToken, async (c) => {
  const limited = await enforce(c, `mcp:${c.get('token')?.tokenId ?? c.get('userId')}`, 240, 60);
  if (limited) return limited;

  const message = await c.req.json().catch(() => null);
  if (!message || typeof message !== 'object') {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  // Batches are not supported: a batch is only useful to a stateful client, and this server has
  // no state to amortise across one.
  if (Array.isArray(message)) {
    return c.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Batched requests are not supported.' },
    });
  }

  const response = await dispatch(c, message as Record<string, unknown>);
  if (response === null) return c.body(null, 202);
  return c.json(response);
});
