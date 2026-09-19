import type { SymbolKey } from '@/types/schema'
import { getSymbolsByCategory } from '@/lib/symbols'

export const APPLIANCE_SYMBOLS = [
  ...getSymbolsByCategory('appliances'),
  ...getSymbolsByCategory('hvac'),
  ...getSymbolsByCategory('sound'),
]

/** HVAC-only symbol keys, used to limit the appliance-type dropdown for HVAC-chained units. */
export const HVAC_TYPE_SYMBOLS: SymbolKey[] = getSymbolsByCategory('hvac').map(
  (sym) => sym.id as SymbolKey
)

/** Normalize legacy socket symbol keys for display (old projects may have socket_230v/socket_3phase) */
export function normalizeSocketSymbol(symbol: SymbolKey | string | undefined): SymbolKey {
  if (symbol === 'socket_230v') return 'socket_gnd_child'
  if (symbol === 'socket_3phase') return 'socket'
  return (symbol as SymbolKey) ?? 'socket_gnd_child'
}

/** Normalize switch symbol keys for display (legacy + switch_2p_twoway shown as two-way with 2 poles) */
export function normalizeSwitchSymbol(symbol: SymbolKey | string | undefined): SymbolKey {
  if (symbol === 'switch_single') return 'switch'
  if (symbol === 'switch_double' || symbol === 'switch_2p_twoway') return 'switch_1p_twoway'
  return (symbol as SymbolKey) ?? 'switch'
}
