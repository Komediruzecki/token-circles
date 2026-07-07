/**
 * Bank statement import — adapter registry + detection.
 *
 * The single place that knows the set of supported banks. Add a bank by
 * importing its adapter and appending it here; everything else (detection, the
 * UI's bank dropdown, processing) is driven off this list.
 */
import { ersteAdapter } from './adapters/erste'
import { pbzAdapter } from './adapters/pbz'
import { revolutAdapter } from './adapters/revolut'
import type { BankAdapter, BankId, DetectInput } from './types'

export const ADAPTERS: readonly BankAdapter[] = [revolutAdapter, ersteAdapter, pbzAdapter]

export function listAdapters(): readonly BankAdapter[] {
  return ADAPTERS
}

export function getAdapter(id: BankId): BankAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id)
}

export interface DetectResult {
  adapter: BankAdapter
  confidence: number
}

/** Highest-confidence adapter for a file, or null if none clears `threshold`. */
export function detectBank(input: DetectInput, threshold = 0.3): DetectResult | null {
  let best: DetectResult | null = null
  for (const adapter of ADAPTERS) {
    const confidence = adapter.detect(input)
    if (confidence > (best?.confidence ?? 0)) best = { adapter, confidence }
  }
  return best && best.confidence >= threshold ? best : null
}
