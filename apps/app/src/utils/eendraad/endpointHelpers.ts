import { getSymbolById } from '@/lib/symbols'
import type { Endpoint, Panel } from '@/types/schema'
import { collectCircuits } from './panelHelpers'

/**
 * Get all endpoints from all circuits in a project, filtered by symbol scope
 * Only returns endpoints whose symbol scope is 'eendraad' or 'both'
 */
export function getAllEndpoints(panels: Panel[]): Endpoint[] {
  const endpoints: Endpoint[] = []
  
  for (const panel of panels) {
    const circuits = collectCircuits(panel)
    for (const circuit of circuits) {
      endpoints.push(...circuit.endpoints)
    }
  }
  
  return endpoints.filter((endpoint) => {
    if (!endpoint.symbol) return false
    const symbol = getSymbolById(endpoint.symbol)
    if (!symbol) return false
    // Only show endpoints whose symbol scope is 'eendraad' or 'both'
    return symbol.scope === 'eendraad' || symbol.scope === 'both'
  })
}
