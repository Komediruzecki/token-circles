/** wrangler.jsonc as data, for the tests that check what a deployment is configured with. */
import wranglerConfig from '../../wrangler.jsonc?raw';

export interface WranglerEnv {
  triggers?: { crons?: string[] };
  vars?: Record<string, string>;
}

/** wrangler.jsonc as data: JSON once its comments and trailing commas are taken out. */
export function wrangler(): { vars?: Record<string, string>; env: Record<string, WranglerEnv> } {
  let json = '';
  let inString = false;
  for (let i = 0; i < wranglerConfig.length; i++) {
    const ch = wranglerConfig[i]!;
    if (inString) {
      json += ch;
      if (ch === '\\') json += wranglerConfig[++i] ?? '';
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      json += ch;
    } else if (ch === '/' && wranglerConfig[i + 1] === '/') {
      while (i < wranglerConfig.length && wranglerConfig[i] !== '\n') i++;
      json += '\n';
    } else {
      json += ch;
    }
  }
  return JSON.parse(json.replace(/,(\s*[}\]])/g, '$1'));
}
