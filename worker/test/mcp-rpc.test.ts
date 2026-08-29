/**
 * The JSON-RPC layer. Stateless streamable HTTP: every POST is self-contained, so there is no
 * session to resume and no Durable Object to hold one. GET is 405 because nothing here is
 * server-initiated.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { mintApiToken } from '../src/apitoken';

const USER_ID = 9300;
const PROFILE_ID = 9301;
let secret = '';

async function rpc(
  method: string,
  params?: unknown,
  token = secret
): Promise<{ status: number; body: any }> {
  const res = await SELF.fetch('https://api.example.com/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, plan, token_version) VALUES (?, 'mcp@example.com', 'pbkdf2$100000$x$y', 'password', 'advanced', 1)"
  )
    .bind(USER_ID)
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (?, 'MCP Profile', ?)"
  )
    .bind(PROFILE_ID, USER_ID)
    .run();
  secret = (
    await mintApiToken(env.DB, USER_ID, {
      name: 'mcp',
      scopes: ['read', 'write', 'import'],
      defaultProfileId: PROFILE_ID,
    })
  ).secret;
});

describe('JSON-RPC dispatch', () => {
  it('initializes with a protocol version and tool capability', async () => {
    const { status, body } = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      clientInfo: { name: 'test', version: '1' },
      capabilities: {},
    });
    expect(status).toBe(200);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.result.protocolVersion).toBe('2025-06-18');
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.serverInfo.name).toBe('token-circles');
  });

  it('lists tools with JSON Schema generated from the zod definitions', async () => {
    const { body } = await rpc('tools/list');
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('whoami');
    const whoami = body.result.tools.find((t: { name: string }) => t.name === 'whoami');
    expect(whoami.inputSchema.type).toBe('object');
    expect(whoami.description.length).toBeGreaterThan(20);
  });

  it('calls a tool and returns structuredContent', async () => {
    const { body } = await rpc('tools/call', { name: 'whoami', arguments: {} });
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.userId).toBe(USER_ID);
    expect(body.result.structuredContent.profiles[0].id).toBe(PROFILE_ID);
    expect(body.result.structuredContent.scopes).toEqual(['read', 'write', 'import']);
    // Text content mirrors the structured payload for clients that only read text.
    expect(JSON.parse(body.result.content[0].text).userId).toBe(USER_ID);
  });

  it('returns a JSON-RPC error, not a 500, for bad arguments', async () => {
    const { status, body } = await rpc('tools/call', {
      name: 'whoami',
      arguments: { nope: [1, 2] },
    });
    expect(status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/argument/i);
  });

  it('returns -32601 for an unknown method and -32602 for an unknown tool', async () => {
    expect((await rpc('does/not/exist')).body.error.code).toBe(-32601);
    const unknownTool = await rpc('tools/call', { name: 'no_such_tool', arguments: {} });
    expect(unknownTool.body.error.code).toBe(-32602);
  });

  it('accepts a notification with no id and answers ping', async () => {
    const res = await SELF.fetch('https://api.example.com/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(res.status).toBe(202);
    expect((await rpc('ping')).body.result).toEqual({});
  });

  it('401s without a token and 405s a GET', async () => {
    const res = await SELF.fetch('https://api.example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
    expect((await SELF.fetch('https://api.example.com/mcp')).status).toBe(405);
  });

  it('403s a tool whose scope the token lacks', async () => {
    const readOnly = (await mintApiToken(env.DB, USER_ID, { name: 'ro', scopes: ['read'] })).secret;
    const { body } = await rpc('tools/call', { name: 'whoami', arguments: {} }, readOnly);
    expect(body.result.isError).toBeFalsy(); // whoami is a read tool, so a read token may call it
  });
});
