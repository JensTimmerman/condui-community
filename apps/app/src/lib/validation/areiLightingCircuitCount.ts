import type { Circuit } from '@/types/schema'
import type { InstallationQueryAPI } from '@/lib/validation/core/query-api'

function circuitFeedsLighting(circuit: Circuit, query: InstallationQueryAPI): boolean {
  if (circuit.kind === 'lighting' || circuit.kind === 'mixed') return true
  const derived = query.getCircuitKind(circuit.id)
  return derived === 'lighting' || derived === 'mixed'
}

/**
 * Leaf circuits that feed lighting per AREI 5.3.5.2 (verlichtingsstroombanen).
 * Counts explicit or derived `lighting` and `mixed` kinds; container circuits with
 * subCircuitIds are skipped.
 */
export function listLightingFeedCircuits(query: InstallationQueryAPI): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const circuit of query.getCircuits()) {
    if (seen.has(circuit.id)) continue
    seen.add(circuit.id)
    if (circuit.subCircuitIds && circuit.subCircuitIds.length > 0) continue
    if (circuitFeedsLighting(circuit, query)) {
      ids.push(circuit.id)
    }
  }
  return ids
}

export function countLightingFeedCircuits(query: InstallationQueryAPI): number {
  return listLightingFeedCircuits(query).length
}
