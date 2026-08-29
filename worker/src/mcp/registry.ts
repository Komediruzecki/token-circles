import { z } from 'zod';
import type { Context } from 'hono';
import type { AppEnv } from '../index';
import type { Scope } from '../apitoken';
import { HttpError } from '../http';

// The tool registry. Each tool declares its input once, in zod: the same schema is advertised
// via tools/list (z.toJSONSchema) and used to validate tools/call. One source of truth, so an
// advertised schema can never drift from what the handler actually accepts.

/** A tool result larger than this is refused rather than shipped into the caller's context. */
export const MAX_TOOL_BYTES = 200_000;

/** The hard row ceiling every list tool applies, whatever limit the caller asks for. */
export const MAX_ROWS = 500;

export interface McpTool<S extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  input: S;
  handler: (c: Context<AppEnv>, args: z.infer<S>, profileId: number) => Promise<unknown>;
}

export const TOOLS: McpTool[] = [];

export function defineTool<S extends z.ZodType>(tool: McpTool<S>): void {
  TOOLS.push(tool as unknown as McpTool);
}

export function findTool(name: string): McpTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function toolListPayload(): {
  tools: { name: string; title: string; description: string; inputSchema: unknown }[];
} {
  return {
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: z.toJSONSchema(t.input, { target: 'draft-7' }),
    })),
  };
}

/**
 * Refuse an oversized result instead of shipping it.
 *
 * An unbounded tool result is the standard way an MCP server ruins its caller: one query
 * returns ten thousand rows, the context fills, and every later turn pays for it. Better to
 * fail loudly and name the way out.
 */
export function guardSize<T>(value: T): T {
  const size = new TextEncoder().encode(JSON.stringify(value ?? null)).length;
  // A tool result goes out twice in one response: once as `structuredContent` and once
  // JSON-serialized into a text block, for clients that don't read structured results. So
  // MAX_TOOL_BYTES -- the budget for what actually crosses the wire -- buys half that per copy.
  if (size * 2 > MAX_TOOL_BYTES) {
    throw new HttpError(
      413,
      `That result is ${Math.round((size * 2) / 1024)}KB on the wire, over the ${Math.round(MAX_TOOL_BYTES / 1024)}KB tool limit. Narrow the filters, lower "limit", or use export_snapshot for a full download.`
    );
  }
  return value;
}
