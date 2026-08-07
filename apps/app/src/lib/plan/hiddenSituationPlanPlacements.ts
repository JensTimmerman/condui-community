import { getCompatibilityFloorsFromProject } from '@/lib/projectV2/buildingFloors'
import {
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { ProjectWithOptionalV2Building } from '@/lib/projectV2/buildingFloors'
import type { Panel, SymbolKey } from '@/types/schema'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'

export type ProjectWithSituationPlanPlacements = ProjectWithOptionalV2Electrical &
  ProjectWithOptionalV2Building

export interface HiddenSituationPlanPlacement {
  placementId: string
  floorId: string
  floorName: string
  endpointId: string
  endpointLabel: string
  symbol?: SymbolKey
}

/**
 * Returns hidden situation-plan placements that still belong to an endpoint in
 * the one-wire model. Stale hidden IDs and non-endpoint plan items are ignored.
 */
export function getHiddenSituationPlanPlacements(
  project: ProjectWithSituationPlanPlacements
): HiddenSituationPlanPlacement[] {
  const floors = getCompatibilityFloorsFromProject(project)
  const hiddenByFloor = new Map(
    floors.map((floor) => [floor.id, new Set(floor.hiddenSitplanPlacementIds ?? [])])
  )
  const floorNameById = new Map(floors.map((floor) => [floor.id, floor.name]))
  const seenPlacementIds = new Set<string>()
  const hidden: HiddenSituationPlanPlacement[] = []

  const visitPanels = (panels: Panel[]) => {
    for (const panel of panels) {
      const circuits = [
        ...panel.circuits,
        ...panel.protections.flatMap((protection) => protection.circuits ?? []),
      ]
      const seenCircuitIds = new Set<string>()
      for (const circuit of circuits) {
        if (seenCircuitIds.has(circuit.id)) continue
        seenCircuitIds.add(circuit.id)
        for (const endpoint of circuit.endpoints) {
          if (!canSymbolAppearOnSituationPlan(endpoint.symbol)) continue
          for (const placement of endpoint.placements) {
            if (seenPlacementIds.has(placement.id)) continue
            if (!hiddenByFloor.get(placement.floorId)?.has(placement.id)) continue
            seenPlacementIds.add(placement.id)
            hidden.push({
              placementId: placement.id,
              floorId: placement.floorId,
              floorName: floorNameById.get(placement.floorId) ?? placement.floorId,
              endpointId: endpoint.id,
              endpointLabel: endpoint.label,
              symbol: endpoint.symbol,
            })
          }
        }
        for (const device of circuit.trunkDevices ?? []) {
          if (!canSymbolAppearOnSituationPlan(device.symbol)) continue
          for (const placement of device.placements ?? []) {
            if (seenPlacementIds.has(placement.id)) continue
            if (!hiddenByFloor.get(placement.floorId)?.has(placement.id)) continue
            seenPlacementIds.add(placement.id)
            hidden.push({
              placementId: placement.id,
              floorId: placement.floorId,
              floorName: floorNameById.get(placement.floorId) ?? placement.floorId,
              endpointId: device.id,
              endpointLabel: device.label,
              symbol: device.symbol,
            })
          }
        }
      }
      visitPanels(panel.subPanels ?? [])
    }
  }

  visitPanels(getElectricalPanelsFromProject(project))
  return hidden.sort(
    (a, b) =>
      a.floorName.localeCompare(b.floorName) ||
      a.endpointLabel.localeCompare(b.endpointLabel) ||
      a.placementId.localeCompare(b.placementId)
  )
}
