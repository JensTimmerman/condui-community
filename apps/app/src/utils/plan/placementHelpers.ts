import type { Panel } from '@/types/schema'
import { getMainBusOrder } from '@/lib/eendraad/mainBusOrder'

/**
 * Count rows attached directly to this panel's main bus.
 * Nested downstream circuits do not add indicators to the panel symbol.
 */
export function countPanelCircuits(panel: Panel): number {
  return getMainBusOrder(panel).length
}
