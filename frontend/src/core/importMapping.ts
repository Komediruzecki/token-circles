/**
 * Column-mapping config for imports. The definitions moved to shared/ so the Cloudflare Worker
 * (daily cron sheet sync, email-in) and the frontend use the SAME field names, header variants
 * and auto-detection instead of drifting hand-copies. This module re-exports them unchanged, so
 * existing `../core/importMapping` import sites keep working.
 */
import {
  autoDetectMapping,
  FIELD_NAMES,
  HEADER_VARIANTS,
  mappingToHeaderNames,
  resolveHeaderMapping,
} from '../../../shared/importMapping'

export {
  autoDetectMapping,
  FIELD_NAMES,
  HEADER_VARIANTS,
  mappingToHeaderNames,
  resolveHeaderMapping,
}
