import { groupEndpointsIntoBranches, initializeBranchesIfNeeded } from '@/lib/layout/endpointChains'
import { getMainBusOrder } from '@/lib/eendraad/mainBusOrder'
import { hasCustomPlacement } from '@/lib/plan/customPlacement'
import {
  selectProjectBuildingFloors,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  selectProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { Circuit, Endpoint, Panel, ProtectionDevice, Placement } from '@/types/schema'

export interface QuickPlacerItem {
  endpoint: Endpoint
  placement: Placement
  isCustomPlacement: boolean
  floorName: string
}

export interface QuickPlacerBranch {
  id: string
  label: string
  items: QuickPlacerItem[]
}

export interface QuickPlacerCircuit {
  id: string
  identifier: string
  notes: string
  panelId: string
  panelName: string
  panelPathIds: string[]
  panelPathNames: string[]
  panelPathLabel: string
  panelDepth: number
  protectionId?: string
  branches: QuickPlacerBranch[]
}

type QuickPlacerProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

function appendQuickPlacerCircuits(
  panel: Panel,
  into: Array<{
    circuit: Circuit
    panel: Panel
    panelPath: Panel[]
    protection?: ProtectionDevice
  }>,
  panelPath: Panel[] = []
): void {
  const currentPanelPath = [...panelPath, panel]
  const seenCircuitIds = new Set<string>()
  const expandedCircuitIds = new Set<string>()

  const addCircuit = (circuit: Circuit, protection?: ProtectionDevice) => {
    if (circuit.code === 'PANEL' || seenCircuitIds.has(circuit.id)) return
    seenCircuitIds.add(circuit.id)
    into.push({ circuit, panel, panelPath: currentPanelPath, protection })
  }

  const directCircuitById = new Map(panel.circuits.map((circuit) => [circuit.id, circuit]))
  const protectionById = new Map(
    (panel.protections ?? []).map((protection) => [protection.id, protection])
  )

  const findProtectionOwningCircuit = (circuitId: string): ProtectionDevice | undefined =>
    panel.protections.find((protection) =>
      protection.circuits?.some((circuit) => circuit.id === circuitId)
    )

  const appendSubCircuitRows = (subCircuitIds: string[] | undefined) => {
    for (const subCircuitId of subCircuitIds ?? []) {
      const protection = findProtectionOwningCircuit(subCircuitId)
      if (protection) {
        appendProtectionSubtree(protection)
        continue
      }

      const circuit = directCircuitById.get(subCircuitId)
      if (circuit) appendDirectCircuitSubtree(circuit)
    }
  }

  function appendProtectionSubtree(protection: ProtectionDevice) {
    for (const circuit of protection.circuits ?? []) {
      if (expandedCircuitIds.has(circuit.id)) continue
      expandedCircuitIds.add(circuit.id)
      addCircuit(circuit, protection)
      appendSubCircuitRows(circuit.subCircuitIds)
    }
  }

  function appendDirectCircuitSubtree(circuit: Circuit) {
    if (expandedCircuitIds.has(circuit.id)) return
    expandedCircuitIds.add(circuit.id)
    addCircuit(circuit)
    appendSubCircuitRows(circuit.subCircuitIds)
  }

  for (const item of getMainBusOrder(panel)) {
    if (item.type === 'circuit') {
      const circuit = directCircuitById.get(item.id)
      if (circuit) appendDirectCircuitSubtree(circuit)
    } else {
      const protection = protectionById.get(item.id)
      if (protection) appendProtectionSubtree(protection)
    }
  }

  // Preserve placeable circuits from legacy or partially repaired states that are not on the main bus.
  for (const circuit of panel.circuits) addCircuit(circuit)
  for (const protection of panel.protections ?? []) {
    for (const circuit of protection.circuits ?? []) {
      addCircuit(circuit, protection)
    }
  }
  for (const subPanel of panel.subPanels ?? []) {
    appendQuickPlacerCircuits(subPanel, into, currentPanelPath)
  }
}

function buildQuickPlacerBranches(
  circuit: Circuit,
  itemsByEndpointId: Map<string, QuickPlacerItem[]>,
  getCircuitIdentifier: (circuitId: string) => string
): QuickPlacerBranch[] {
  const branches: QuickPlacerBranch[] = []
  const assignedEndpointIds = new Set<string>()

  for (const branch of initializeBranchesIfNeeded(circuit)) {
    const items = branch.endpointIds.flatMap(
      (endpointId) => itemsByEndpointId.get(endpointId) ?? []
    )

    if (items.length === 0) continue

    for (const item of items) {
      assignedEndpointIds.add(item.endpoint.id)
    }

    branches.push({
      id: branch.id,
      label: branch.label || items[0]?.endpoint.label || getCircuitIdentifier(circuit.id),
      items,
    })
  }

  const unassignedEndpoints = circuit.endpoints.filter(
    (endpoint) => itemsByEndpointId.has(endpoint.id) && !assignedEndpointIds.has(endpoint.id)
  )

  let fallbackBranchIndex = 0
  for (const fallbackEndpoints of groupEndpointsIntoBranches(unassignedEndpoints)) {
    const items = fallbackEndpoints.flatMap((endpoint) => itemsByEndpointId.get(endpoint.id) ?? [])

    if (items.length === 0) continue

    branches.push({
      id: `quick-placer-fallback-${circuit.id}-${fallbackBranchIndex++}`,
      label: items[0]?.endpoint.label || getCircuitIdentifier(circuit.id),
      items,
    })
  }

  return branches.slice().reverse()
}

export function buildQuickPlacerCircuits(
  project: QuickPlacerProject | null,
  getCircuitIdentifier: (circuitId: string) => string
): QuickPlacerCircuit[] {
  if (!project) return []

  const floorNameById = new Map(
    selectProjectBuildingFloors(project).map((floor) => [floor.id, floor.name])
  )

  const orderedCircuits: Array<{
    circuit: Circuit
    panel: Panel
    panelPath: Panel[]
    protection?: ProtectionDevice
  }> = []
  for (const rootPanel of selectProjectElectricalPanels(project)) {
    appendQuickPlacerCircuits(rootPanel, orderedCircuits)
  }

  const circuits: QuickPlacerCircuit[] = []

  for (const { circuit, panel, panelPath, protection } of orderedCircuits) {
    const itemsByEndpointId = new Map<string, QuickPlacerItem[]>()

    for (const endpoint of circuit.endpoints) {
      const items = endpoint.placements.map((placement) => ({
        endpoint,
        placement,
        isCustomPlacement: hasCustomPlacement(placement),
        floorName: floorNameById.get(placement.floorId) ?? placement.floorId,
      }))
      if (items.length === 0) continue
      itemsByEndpointId.set(endpoint.id, items)
    }

    const branches = buildQuickPlacerBranches(circuit, itemsByEndpointId, getCircuitIdentifier)

    if (branches.length === 0) continue

    const panelPathIds = panelPath.map((entry) => entry.id)
    const panelPathNames = panelPath.map((entry) => entry.name)

    circuits.push({
      id: circuit.id,
      identifier: getCircuitIdentifier(circuit.id) || circuit.code,
      notes: protection?.notes?.trim() || circuit.notes?.trim() || '',
      panelId: panel.id,
      panelName: panel.name,
      panelPathIds,
      panelPathNames,
      panelPathLabel: panelPathNames.join(' / '),
      panelDepth: Math.max(0, panelPath.length - 1),
      protectionId: protection?.id,
      branches,
    })
  }

  return circuits
}

export function flattenQuickPlacerCircuit(
  circuit: QuickPlacerCircuit | null | undefined,
  options?: { autoSkipCustom?: boolean }
): QuickPlacerItem[] {
  if (!circuit) return []
  const autoSkipCustom = options?.autoSkipCustom ?? false
  return circuit.branches.flatMap((branch) =>
    branch.items.filter((item) => !autoSkipCustom || !item.isCustomPlacement)
  )
}
