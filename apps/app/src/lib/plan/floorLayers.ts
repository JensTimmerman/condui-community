import { getBuildingFloorsFromProject } from '@/lib/projectV2/buildingFloors'
import type { ProjectWithOptionalV2Building } from '@/lib/projectV2/buildingFloors'
import type { Floor } from '@/types/schema'

const ELECTRICAL = 'electrical'

/** Ensure the floor has at least the electrical plan layer (mutates floor). */
export function ensureElectricalLayerOnFloor(floor: Floor): void {
  if (!floor.layers || floor.layers.length === 0) {
    floor.layers = [ELECTRICAL]
    return
  }
  if (!floor.layers.includes(ELECTRICAL)) {
    floor.layers = [ELECTRICAL, ...floor.layers]
  }
}

/** Auto-heal all floors in a project (mutates). Call on load and when adding/updating floors. */
export function healProjectFloorsElectricalLayers(project: ProjectWithOptionalV2Building): void {
  for (const floor of getBuildingFloorsFromProject(project)) {
    if (!('layers' in floor)) continue
    ensureElectricalLayerOnFloor(floor)
  }
}
