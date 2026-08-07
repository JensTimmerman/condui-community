import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import {
  getBuildingFloorsFromProject,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { generateId } from '@/utils/project'
import { buildAutoSitplanPlacement } from './autoSitplanPlacement'
import { resolveCircuitSitplanTargetFloorId } from './sitplanTargetFloor'

type JunctionBoxSitplanProject = ProjectWithOptionalV2Building &
  ProjectWithOptionalV2Electrical & {
    project?: { lastActiveFloorId?: string | null }
  }

/**
 * Backfills situation-plan placements for junction boxes created before they
 * became situation-plan symbols. Existing placements are left untouched.
 */
export function healJunctionBoxSitplanPlacements(project: JunctionBoxSitplanProject): boolean {
  const floors = getBuildingFloorsFromProject(project)
  const fallbackFloorId = floors[0]?.id
  if (!fallbackFloorId) return false

  let changed = false
  for (const panel of getElectricalPanelsFromProject(project)) {
    for (const circuit of getAllCircuits(panel)) {
      const floorId =
        resolveCircuitSitplanTargetFloorId(project, null, circuit.id) ?? fallbackFloorId

      for (const endpoint of circuit.endpoints) {
        if (endpoint.symbol !== 'junction_box' || endpoint.placements.length > 0) continue
        const placement = buildAutoSitplanPlacement(project, {
          circuitId: circuit.id,
          floorId,
          placementId: generateId(),
        })
        if (!placement) continue
        endpoint.placements.push(placement)
        changed = true
      }

      for (const device of circuit.trunkDevices ?? []) {
        if (device.symbol !== 'junction_box' || (device.placements?.length ?? 0) > 0) continue
        const placement = buildAutoSitplanPlacement(project, {
          circuitId: circuit.id,
          floorId,
          placementId: generateId(),
        })
        if (!placement) continue
        device.placements = [placement]
        changed = true
      }
    }
  }
  return changed
}
