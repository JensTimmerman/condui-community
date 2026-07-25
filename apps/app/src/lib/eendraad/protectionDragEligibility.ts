import { walkPanels } from '@/lib/panel/panelTree'
import type { Panel } from '@/types/schema'

/**
 * Returns the sibling order for a protection circuit placed on a secondary bus.
 * The owning panel may itself be nested, so the complete panel tree must be searched.
 */
export function getSecondaryBusOrderForCircuit(
  panels: Panel[],
  circuitId: string
): string | null {
  for (const panel of walkPanels(panels)) {
    const localCircuits = panel.circuits.concat(
      panel.protections.flatMap((protection) => protection.circuits ?? [])
    )
    const parentCircuit = localCircuits.find((circuit) =>
      circuit.subCircuitIds?.includes(circuitId)
    )
    if (parentCircuit?.subCircuitIds) return parentCircuit.subCircuitIds.join(',')
  }
  return null
}
