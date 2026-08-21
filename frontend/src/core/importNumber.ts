/**
 * Strict parser for imported financial values.
 *
 * The implementation moved to shared/ so this and the Worker's copy stop drifting — they were
 * byte-identical apart from a doc comment. Re-exported under the old names so existing call sites
 * and tests keep working.
 */
export {
  describeImportNumberFlags,
  parseImportNumber,
  parseImportNumberDetailed,
} from '../../../shared/importNumber'
export type { ImportNumberFlag, ImportNumberResult } from '../../../shared/importNumber'
