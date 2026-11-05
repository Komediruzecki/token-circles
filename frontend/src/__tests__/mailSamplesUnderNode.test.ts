/**
 * The sample mails load under plain Node, as maff sends them for review:
 * `node worker/scripts/send-sample-mails.ts --to ... --dry-run <folder>`. Node strips the types
 * but resolves nothing for it, so every relative import on the way, worker/src/emailTemplates.ts
 * and the shared files it reads included, names its file with the extension. The Worker's tests
 * resolve either form, so they cannot see one that does not: a month count the day-7 mail took
 * from shared/trackedMonths.ts brought in its own `./calendarMonths`, and the script stopped at
 * ERR_MODULE_NOT_FOUND.
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const SAMPLES = join(import.meta.dirname, '..', '..', '..', 'worker', 'scripts', 'mail-samples.ts')

describe('the sample mails under plain Node', () => {
  it('load and render, every one', () => {
    const script = `const { mailSamples } = await import(${JSON.stringify(pathToFileURL(SAMPLES).href)});
const samples = mailSamples();
for (const sample of samples) sample.render();
process.stdout.write(String(samples.length));`
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    })
    expect(Number(out)).toBeGreaterThanOrEqual(19)
  }, 90_000)
})
