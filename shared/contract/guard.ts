/**
 * Which contract routes the scenarios sent, and which they missed. Each runner records every
 * request its scenarios make, then checks the record against shared/contract/routes.ts at the end
 * of the run, so a route nobody sends cannot pass unnoticed in either runtime.
 */
import type { Method } from './types';

export interface Hit {
  method: Method;
  path: string;
  status: number;
}

/** A route as both runtimes name it: `GET /api/loans/:id`. */
export type RouteKey = `${Method} /api/${string}`;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function patternOf(key: RouteKey): { method: Method; path: string } {
  const space = key.indexOf(' ');
  return { method: key.slice(0, space) as Method, path: key.slice(space + 1) };
}

/** Whether a concrete path, query string aside, is an instance of a Hono route pattern. */
export function pathMatches(pattern: string, path: string): boolean {
  const source = pattern
    .split('/')
    .map((segment) => {
      const typed = /^:\w+\{(.+)\}$/.exec(segment);
      if (typed) return `(?:${typed[1]})`;
      if (segment.startsWith(':')) return '[^/]+';
      if (segment === '*') return '.*';
      return escape(segment);
    })
    .join('/');
  return new RegExp(`^${source}$`).test(path.split('?')[0]);
}

const staticSegments = (key: RouteKey) =>
  patternOf(key)
    .path.split('/')
    .filter((s) => s && !s.startsWith(':') && s !== '*').length;

/**
 * The route a request reached. `/api/categories/mappings` fits both `/api/categories/mappings`
 * and `/api/categories/:id`; like the routers, the one with more fixed segments wins.
 */
export function routeOf(keys: readonly RouteKey[], method: Method, path: string): RouteKey | null {
  const fits = keys.filter((key) => {
    const route = patternOf(key);
    return route.method === method && pathMatches(route.path, path);
  });
  fits.sort((a, b) => staticSegments(b) - staticSegments(a));
  return fits[0] ?? null;
}

/** The routes no scenario reached with a 2xx answer. */
export function unsent(keys: readonly RouteKey[], hits: readonly Hit[]): RouteKey[] {
  const sent = new Set<RouteKey>();
  for (const hit of hits) {
    if (hit.status < 200 || hit.status >= 300) continue;
    const key = routeOf(keys, hit.method, hit.path);
    if (key) sent.add(key);
  }
  return keys.filter((key) => !sent.has(key));
}

/**
 * Concrete paths for a route pattern, for checking it against local-first's regular expressions:
 * an id there is `(\d+)`, an export kind `([a-z-]+)`, a currency `([A-Z]{3})`.
 */
export function samplePaths(key: RouteKey): string[] {
  const samples = ['1', 'monthly', 'EUR'];
  let paths = [''];
  for (const segment of patternOf(key).path.split('/').slice(1)) {
    const options = segment.startsWith(':') ? samples : [segment];
    paths = paths.flatMap((p) => options.map((o) => `${p}/${o}`));
  }
  return paths;
}

export function methodOf(key: RouteKey): Method {
  return patternOf(key).method;
}

/** The ids a source file's `DIFFERENCE <id>` comments name (shared/contract/differences.ts). */
export function namedDifferences(source: string): string[] {
  return [...source.matchAll(/DIFFERENCE ([a-z0-9][a-z0-9-]*)/g)].map((m) => m[1]);
}
