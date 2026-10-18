/**
 * The few Node APIs the scripts here use. The worker has no @types/node: it would put Node's
 * globals into the Worker's own types, where they do not exist. `process` is declared already, as
 * `any`, by @cloudflare/workers-types.
 */
declare module 'node:fs/promises' {
  export function mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  export function writeFile(path: string, data: string): Promise<void>;
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
}

declare module 'node:url' {
  export function pathToFileURL(path: string): URL;
}

/** Node sets it on every ES module. */
interface ImportMeta {
  readonly url: string;
}
