import { getSymbolById } from '@/lib/symbols'
import type { Endpoint } from '@/types/schema'

/** Whether an endpoint's symbol is shown on the situation plan (not one-wire-only). */
export function endpointSymbolVisibleOnSitplan(endpoint: Endpoint): boolean {
  if (!endpoint.symbol) return false
  if (endpoint.symbol === 'domotica') return false
  const symbol = getSymbolById(endpoint.symbol)
  if (!symbol) return false
  return symbol.scope === 'situatieplan' || symbol.scope === 'both'
}
