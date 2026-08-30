import type { Panel } from '@/types/schema'

/** True when this circuit belongs to a secondary bus, rather than the main bus. */
export function isCircuitNestedUnderPanelBus(panel: Panel, circuitId: string): boolean {
  for (const directCircuit of panel.circuits ?? []) {
    if (directCircuit.code === 'PANEL') continue
    if (directCircuit.subCircuitIds?.includes(circuitId)) return true
  }
  for (const protection of panel.protections ?? []) {
    for (const circuit of protection.circuits ?? []) {
      if (circuit.subCircuitIds?.includes(circuitId)) return true
    }
  }
  return false
}

/** Main-bus item order, matching diagram layout and drag order. */
export function getMainBusOrder(panel: Panel): Array<{ type: 'circuit' | 'protection'; id: string }> {
  const items: Array<{ type: 'circuit' | 'protection'; id: string; index: number }> = []
  const seenProtectionIds = new Set<string>()
  panel.circuits.forEach((circuit, index) => {
    if (circuit.code !== 'PANEL' && !isCircuitNestedUnderPanelBus(panel, circuit.id)) {
      items.push({ type: 'circuit', id: circuit.id, index })
    }
  })
  panel.protections?.forEach((protection, index) => {
    if (!(protection.circuits ?? []).some((circuit) => !isCircuitNestedUnderPanelBus(panel, circuit.id))) {
      return
    }
    if (seenProtectionIds.has(protection.id)) return
    seenProtectionIds.add(protection.id)
    items.push({ type: 'protection', id: protection.id, index })
  })
  items.sort((left, right) => left.index - right.index)
  return items.map(({ type, id }) => ({ type, id }))
}
