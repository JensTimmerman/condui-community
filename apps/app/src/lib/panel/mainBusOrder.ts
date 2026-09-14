import type { Panel } from '@/types/schema'

const nestedCircuitIdsByPanel = new WeakMap<Panel, ReadonlySet<string>>()

function collectNestedCircuitIds(panel: Panel): ReadonlySet<string> {
  const cached = nestedCircuitIdsByPanel.get(panel)
  if (cached) return cached

  const nestedIds = new Set<string>()
  for (const circuit of panel.circuits ?? []) {
    for (const id of circuit.subCircuitIds ?? []) nestedIds.add(id)
  }
  for (const protection of panel.protections ?? []) {
    for (const circuit of protection.circuits ?? []) {
      for (const id of circuit.subCircuitIds ?? []) nestedIds.add(id)
    }
  }

  // Plain fixtures and Immer drafts can still be mutated in place. Cache only
  // finalized project panels, whose identity changes with an electrical edit.
  if (Object.isFrozen(panel)) nestedCircuitIdsByPanel.set(panel, nestedIds)
  return nestedIds
}

/** True when this circuit belongs to a secondary bus, rather than the main bus. */
export function isCircuitNestedUnderPanelBus(panel: Panel, circuitId: string): boolean {
  return collectNestedCircuitIds(panel).has(circuitId)
}

/** Main-bus item order, matching diagram layout and drag order. */
export function getMainBusOrder(
  panel: Panel
): Array<{ type: 'circuit' | 'protection'; id: string }> {
  const items: Array<{ type: 'circuit' | 'protection'; id: string; index: number }> = []
  const seenProtectionIds = new Set<string>()
  panel.circuits.forEach((circuit, index) => {
    if (circuit.code !== 'PANEL' && !isCircuitNestedUnderPanelBus(panel, circuit.id)) {
      items.push({ type: 'circuit', id: circuit.id, index })
    }
  })
  panel.protections?.forEach((protection, index) => {
    if (
      !(protection.circuits ?? []).some(
        (circuit) => !isCircuitNestedUnderPanelBus(panel, circuit.id)
      )
    ) {
      return
    }
    if (seenProtectionIds.has(protection.id)) return
    seenProtectionIds.add(protection.id)
    items.push({ type: 'protection', id: protection.id, index })
  })
  items.sort((left, right) => left.index - right.index)
  return items.map(({ type, id }) => ({ type, id }))
}
