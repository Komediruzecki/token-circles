/**
 * Lookups that are sent as POST because they take a body. They change nothing on the server.
 *
 * Two things listen for writes, and both must skip these: data invalidation (`dataVersions.ts`),
 * because each lookup is called from a page that follows the entity its URL names, so counting a
 * price quote as a portfolio write reloaded the holdings after every quote refresh; and the
 * achievements announcement (`dataChangedEvent.ts`), because an import preview counted as a write
 * set off a full badge evaluation, eight reads, after a request that wrote nothing.
 *
 * `/api/import/execute` is the import route that writes; the upload and sheet routes only parse a
 * file for the preview, and the preview's dry run of the import says so in its URL. The flag the
 * server reads is in the body, which neither listener sees.
 *
 * A leaf module with no imports, so that `dataChangedEvent.ts` can stay one as well.
 */
const READS_SENT_AS_POST: readonly RegExp[] = [
  /^\/api\/portfolio\/prices(?:[/?]|$)/,
  /^\/api\/loans\/[^/?]+\/calculate(?:[/?]|$)/,
  /^\/api\/tags\/rules\/preview(?:[/?]|$)/,
  /^\/api\/import\/(?:upload|googlesheet)(?:[/?]|$)/,
  /^\/api\/import\/execute\?dry_run=1(?:&|$)/,
]

/** True for a POST to one of the lookups above: a read, whatever its method says. */
export function isReadSentAsPost(path: string): boolean {
  return READS_SENT_AS_POST.some((read) => read.test(path))
}
