import {
  getBuildingFloorsFromProject,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { Circuit, Panel } from '@/types/schema'

type SitplanTargetFloorProject = ProjectWithOptionalV2Building & {
  project?: { lastActiveFloorId?: string | null }
}

/**
 * Floor for auto sitplan placement (one-wire drops, orphan "missing placement" fix).
 *
 * 1. `activeFloorId` from UI when it exists on this project (floor picker / plan tab).
 * 2. Else `project.lastActiveFloorId` when valid (persisted last plan floor for this project).
 *
 * Never uses `floors[0]` — that was wrong when the user worked on another floor.
 */
export function resolveSitplanTargetFloorId(
  project: SitplanTargetFloorProject,
  uiActiveFloorId: string | null
): string | null {
  const floors = getBuildingFloorsFromProject(project)
  if (!floors.length) return null

  if (uiActiveFloorId && floors.some((f) => f.id === uiActiveFloorId)) {
    return uiActiveFloorId
  }

  const last = project.project?.lastActiveFloorId
  if (last && floors.some((f) => f.id === last)) {
    return last
  }

  return null
}

type CircuitSitplanTargetProject = SitplanTargetFloorProject & ProjectWithOptionalV2Electrical

function findOwningPanelAndCircuit(
  panels: Panel[],
  circuitId: string
): { panel: Panel; circuit: Circuit } | null {
  for (const panel of panels) {
    const circuits = [
      ...(panel.circuits ?? []),
      ...(panel.protections ?? []).flatMap((protection) => protection.circuits ?? []),
    ]
    const circuit = circuits.find((candidate) => candidate.id === circuitId)
    if (circuit) return { panel, circuit }
    const nested = findOwningPanelAndCircuit(panel.subPanels ?? [], circuitId)
    if (nested) return nested
  }
  return null
}

/**
 * Resolve a floor for a newly-created endpoint when the remembered UI floor is stale.
 * Prefer an existing circuit mate, then the owning panel's own plan symbol. Both are
 * stronger signals than guessing the first floor in a multi-floor project.
 */
export function resolveCircuitSitplanTargetFloorId(
  project: CircuitSitplanTargetProject,
  uiActiveFloorId: string | null,
  circuitId: string
): string | null {
  const preferred = resolveSitplanTargetFloorId(project, uiActiveFloorId)
  if (preferred) return preferred

  const validFloorIds = new Set(getBuildingFloorsFromProject(project).map((floor) => floor.id))
  const owner = findOwningPanelAndCircuit(getElectricalPanelsFromProject(project), circuitId)
  if (!owner) return null

  for (const endpoint of owner.circuit.endpoints) {
    const floorId = endpoint.placements?.[0]?.floorId
    if (floorId && validFloorIds.has(floorId)) return floorId
  }

  for (const panelCircuit of owner.panel.circuits ?? []) {
    const panelEndpoint = panelCircuit.endpoints.find(
      (endpoint) => endpoint.symbol === 'panel_distribution' && endpoint.panelId === owner.panel.id
    )
    const floorId = panelEndpoint?.placements?.[0]?.floorId
    if (floorId && validFloorIds.has(floorId)) return floorId
  }

  return null
}
