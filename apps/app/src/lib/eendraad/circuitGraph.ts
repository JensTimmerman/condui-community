import type { Circuit, Panel, ProtectionDevice } from '@/types/schema'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

export interface CircuitCanonicalOwner {
  panel: Panel
  protection?: ProtectionDevice
}

export interface CircuitGraphIndex {
  panelsById: Map<string, Panel>
  protectionsById: Map<string, ProtectionDevice>
  circuitsById: Map<string, Circuit>
  canonicalOwnerByCircuitId: Map<string, CircuitCanonicalOwner>
  protectedCircuitIds: Set<string>
  subCircuitIds: Set<string>
}

export type CircuitReferenceTarget =
  | { kind: 'protection'; protection: ProtectionDevice; circuit: Circuit }
  | { kind: 'circuit'; circuit: Circuit }
  | { kind: 'missing'; circuitId: string }

export function buildCircuitGraphIndex(project: ProjectWithOptionalV2Electrical): CircuitGraphIndex {
  const index: CircuitGraphIndex = {
    panelsById: new Map(),
    protectionsById: new Map(),
    circuitsById: new Map(),
    canonicalOwnerByCircuitId: new Map(),
    protectedCircuitIds: new Set(),
    subCircuitIds: new Set(),
  }

  const indexCircuit = (panel: Panel, circuit: Circuit, protection?: ProtectionDevice) => {
    if (!index.circuitsById.has(circuit.id)) index.circuitsById.set(circuit.id, circuit)
    if (protection) {
      index.protectedCircuitIds.add(circuit.id)
      index.canonicalOwnerByCircuitId.set(circuit.id, { panel, protection })
    } else if (!index.canonicalOwnerByCircuitId.has(circuit.id)) {
      index.canonicalOwnerByCircuitId.set(circuit.id, { panel })
    }
    for (const subCircuitId of circuit.subCircuitIds ?? []) {
      index.subCircuitIds.add(subCircuitId)
    }
  }

  const visitPanels = (panels: Panel[]) => {
    for (const panel of panels) {
      index.panelsById.set(panel.id, panel)
      for (const protection of panel.protections) {
        index.protectionsById.set(protection.id, protection)
        for (const circuit of protection.circuits ?? []) {
          indexCircuit(panel, circuit, protection)
        }
      }
      for (const circuit of panel.circuits) {
        indexCircuit(panel, circuit)
      }
      visitPanels(panel.subPanels)
    }
  }

  visitPanels(getProjectElectricalPanels(project))
  return index
}

export function resolveCircuitReference(
  index: CircuitGraphIndex,
  circuitId: string
): CircuitReferenceTarget {
  const circuit = index.circuitsById.get(circuitId)
  const owner = index.canonicalOwnerByCircuitId.get(circuitId)
  if (circuit && owner?.protection) {
    return { kind: 'protection', protection: owner.protection, circuit }
  }
  if (circuit) return { kind: 'circuit', circuit }
  return { kind: 'missing', circuitId }
}

export function collectPanelTreeSubCircuitIds(panel: Panel): Set<string> {
  const subCircuitIds = new Set<string>()

  const visitCircuit = (circuit: Circuit) => {
    for (const subCircuitId of circuit.subCircuitIds ?? []) {
      subCircuitIds.add(subCircuitId)
    }
  }

  const visitPanel = (currentPanel: Panel) => {
    for (const protection of currentPanel.protections) {
      for (const circuit of protection.circuits ?? []) visitCircuit(circuit)
    }
    for (const circuit of currentPanel.circuits) visitCircuit(circuit)
    for (const subPanel of currentPanel.subPanels) visitPanel(subPanel)
  }

  visitPanel(panel)
  return subCircuitIds
}
