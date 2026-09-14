import type { SymbolMetadata } from '@/lib/symbols'

const SUPPLY_TOPOLOGY_LIBRARY_SYMBOL_IDS = new Set(['mains', 'backup_feed', 'source_changeover'])

let supplyTopologyEnabled = false

export interface RuntimeFeatureFlags {
  supplyTopologyEnabled: boolean
}

function isEnabledValue(value: unknown): boolean {
  if (value === true) return true
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

/**
 * Runtime opt-in for the supply-topology creation surface.
 * The app hydrates this before rendering; an absent or unavailable runtime config defaults off.
 */
export function isSupplyTopologyEnabled(): boolean {
  return supplyTopologyEnabled
}

export function setSupplyTopologyEnabled(value: unknown): void {
  supplyTopologyEnabled = isEnabledValue(value)
}

export async function initializeRuntimeFeatureFlags(
  fetcher: typeof fetch = fetch
): Promise<RuntimeFeatureFlags> {
  setSupplyTopologyEnabled(false)
  try {
    const response = await fetcher(`/api/runtime-config?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return { supplyTopologyEnabled: false }
    const config = (await response.json()) as Partial<RuntimeFeatureFlags>
    setSupplyTopologyEnabled(config.supplyTopologyEnabled)
  } catch {
    setSupplyTopologyEnabled(false)
  }
  return { supplyTopologyEnabled }
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
