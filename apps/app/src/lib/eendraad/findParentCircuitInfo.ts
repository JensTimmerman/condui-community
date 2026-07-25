import type { Circuit, Panel, ProtectionDevice } from '@/types/schema'

/**
 * Find the parent circuit (and its protection) for a given circuit ID.
 * Returns null if the circuit is not a subcircuit.
 */
export function findParentCircuitInfo(
  circuitId: string,
  panels: Panel[],
): { parentCircuit: Circuit; parentProtection: ProtectionDevice | null } | null {
  let parentCircuit: Circuit | null = null
  let parentProtection: ProtectionDevice | null = null

  const search = (panel: Panel): boolean => {
    for (const c of panel.circuits) {
      if (c.subCircuitIds?.includes(circuitId)) {
        parentCircuit = c
        return true
      }
    }
    for (const prot of panel.protections) {
      if (prot.circuits) {
        for (const c of prot.circuits) {
          if (c.subCircuitIds?.includes(circuitId)) {
            parentCircuit = c
            parentProtection = prot
            return true
          }
        }
      }
    }
    for (const subPanel of panel.subPanels) {
      if (search(subPanel)) return true
    }
    return false
  }

  for (const panel of panels) {
    if (search(panel)) break
  }

  return parentCircuit ? { parentCircuit, parentProtection } : null
}
