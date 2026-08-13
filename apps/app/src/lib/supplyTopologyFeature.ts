import type { SymbolMetadata } from '@/lib/symbols'

const SUPPLY_TOPOLOGY_LIBRARY_SYMBOL_IDS = new Set(['mains', 'backup_feed', 'source_changeover'])

/**
 * Build-time opt-in for the supply-topology creation surface.
 *
 * Vite replaces this value in production bundles. Reading it through a function keeps
 * tests and local development overrides deterministic while an absent variable remains off.
 */
export function isSupplyTopologyEnabled(): boolean {
  const value = import.meta.env.VITE_SUPPLY_TOPOLOGY_ENABLED?.trim().toLowerCase()
  return value === '1' || value === 'true'
}

export function isSupplyTopologyLibrarySymbol(symbol: Pick<SymbolMetadata, 'id'>): boolean {
  return SUPPLY_TOPOLOGY_LIBRARY_SYMBOL_IDS.has(symbol.id)
}

export function isSymbolAvailableInLibrary(symbol: SymbolMetadata): boolean {
  if (symbol.hiddenFromLibrary) return false
  return isSupplyTopologyEnabled() || !isSupplyTopologyLibrarySymbol(symbol)
}

/** Blocks only creation entry points; existing topology remains visible and editable. */
export function canCreateSupplyTopologyFromDrop(
  symbol: Pick<SymbolMetadata, 'id' | 'busFeedKind'>,
  targetType: string | null
): boolean {
  if (isSupplyTopologyEnabled()) return true
  if (symbol.busFeedKind || symbol.id === 'source_changeover') return false
  return !(symbol.id === 'inverter' && targetType === 'supplyWire')
}

