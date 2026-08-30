import type { SymbolMetadata } from '@/lib/symbols'

const SUPPLY_TOPOLOGY_LIBRARY_SYMBOL_IDS = new Set(['mains', 'backup_feed', 'source_changeover'])

let supplyTopologyEnabled = false
let dcRailEnabled = false

export interface RuntimeFeatureFlags {
  supplyTopologyEnabled: boolean
  dcRailEnabled: boolean
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

/**
 * Runtime opt-in for creating DC distribution rails. Existing rails remain
 * readable and editable when this is disabled.
 */
export function isDcRailEnabled(): boolean {
  return dcRailEnabled
}

export function setDcRailEnabled(value: unknown): void {
  dcRailEnabled = isEnabledValue(value)
}

export async function initializeRuntimeFeatureFlags(
  fetcher: typeof fetch = fetch
): Promise<RuntimeFeatureFlags> {
  setSupplyTopologyEnabled(false)
  setDcRailEnabled(false)
  try {
    const response = await fetcher(`/api/runtime-config?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return { supplyTopologyEnabled: false, dcRailEnabled: false }
    const config = (await response.json()) as Partial<RuntimeFeatureFlags>
    setSupplyTopologyEnabled(config.supplyTopologyEnabled)
    setDcRailEnabled(config.dcRailEnabled)
  } catch {
    setSupplyTopologyEnabled(false)
    setDcRailEnabled(false)
  }
  return { supplyTopologyEnabled, dcRailEnabled }
}

export function isSupplyTopologyLibrarySymbol(symbol: Pick<SymbolMetadata, 'id'>): boolean {
  return SUPPLY_TOPOLOGY_LIBRARY_SYMBOL_IDS.has(symbol.id)
}

export function isSymbolAvailableInLibrary(symbol: SymbolMetadata): boolean {
  if (symbol.hiddenFromLibrary) return false
  if (symbol.id === 'dc_bus' && !isDcRailEnabled()) return false
  return isSupplyTopologyEnabled() || !isSupplyTopologyLibrarySymbol(symbol)
}

/** Blocks only creation entry points; existing topology remains visible and editable. */
export function canCreateSupplyTopologyFromDrop(
  symbol: Pick<SymbolMetadata, 'id' | 'busFeedKind'>,
  targetType: string | null
): boolean {
  if (symbol.id === 'dc_bus' && !isDcRailEnabled()) return false
  if (isSupplyTopologyEnabled()) return true
  if (symbol.busFeedKind || symbol.id === 'source_changeover') return false
  return !(symbol.id === 'inverter' && targetType === 'supplyWire')
}
