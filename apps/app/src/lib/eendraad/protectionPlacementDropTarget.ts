import type { DropTarget } from '@/lib/layout/findDropTarget'
import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import type { SymbolMetadata } from '@/lib/symbols'

const PROTECTION_PLACEMENT_SYMBOL_IDS = new Set<string>(PROTECTION_SYMBOL_IDS)

/** Treat a new protection dropped on another protection as nesting on its output circuit. */
export function normalizeProtectionPlacementDropTarget(
  symbol: SymbolMetadata,
  target: DropTarget,
): DropTarget {
  if (
    PROTECTION_PLACEMENT_SYMBOL_IDS.has(symbol.id) &&
    target.type === 'protection' &&
    target.circuitId
  ) {
    return { ...target, type: 'circuit' }
  }
  return target
}
