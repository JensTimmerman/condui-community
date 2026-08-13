import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import {
  getBuildingFloorsFromProject,
  getMutableCompatibilityFloorsForProject,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { SymbolKey } from '@/types/schema'
import { generateId } from '@/utils/project'
import { buildAutoSitplanPlacement } from './autoSitplanPlacement'
import { getSituationPlanPlacementIdsHiddenByPanel } from './panelPlanPlacementVisibility'
import { resolveCircuitSitplanTargetFloorId } from './sitplanTargetFloor'
import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'

type EnergyConversionSitplanProject = ProjectWithOptionalV2Building &
  ProjectWithOptionalV2Electrical & {
    project?: { lastActiveFloorId?: string | null }
  }

const CONVERSION_SYMBOLS = new Set<SymbolKey>([
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
])
const PHYSICAL_SUPPLY_SYMBOLS = new Set<SymbolKey>([
  ...CONVERSION_SYMBOLS,
  'solar_panel',
  'battery',
])

/**
 * Gives legacy conversion and physical supply devices the placement behavior used for new drops.
 * Conversion placements that are not represented in a panel are visible,
 * including placements that older editor versions stored in the hidden-items
 * list. Placements intentionally represented in a panel remain hidden on the
 * situation plan. Missing conversion placements are optional and are never
 * treated as orphaned data.
 */
export function healEnergyConversionSitplanPlacements(
  project: EnergyConversionSitplanProject
): boolean {
  let changed = false

  const floors = getBuildingFloorsFromProject(project)
  const compatibilityFloors = getMutableCompatibilityFloorsForProject(project)
  const fallbackFloorId = floors[0]?.id
  if (!fallbackFloorId) return changed

  const conversionPlacementIds = new Set<string>()
  for (const panel of getElectricalPanelsFromProject(project)) {
    for (const circuit of getAllCircuits(panel)) {
      const floorId =
        resolveCircuitSitplanTargetFloorId(project, null, circuit.id) ?? fallbackFloorId
      const addPlacement = () => {
        const placement = buildAutoSitplanPlacement(project, {
          circuitId: circuit.id,
          floorId,
          placementId: generateId(),
        })
        if (!placement) return null
        changed = true
        return placement
      }

      for (const endpoint of circuit.endpoints) {
        if (!endpoint.symbol || !CONVERSION_SYMBOLS.has(endpoint.symbol)) continue
        if (endpoint.placements.length === 0) {
          const placement = addPlacement()
          if (placement) endpoint.placements.push(placement)
        }
        for (const endpointPlacement of endpoint.placements) {
          conversionPlacementIds.add(endpointPlacement.id)
        }
      }

      for (const device of circuit.trunkDevices ?? []) {
        if (!CONVERSION_SYMBOLS.has(device.symbol)) continue
        if ((device.placements?.length ?? 0) === 0) {
          const placement = addPlacement()
          if (placement) device.placements = [placement]
        }
        for (const devicePlacement of device.placements ?? []) {
          conversionPlacementIds.add(devicePlacement.id)
        }
      }
    }
  }

  const supplyFloorId =
    floors.find((floor) => floor.id === project.project?.lastActiveFloorId)?.id ?? fallbackFloorId
  for (const device of getAllSupplyTrunkDevices(project)) {
    if (!PHYSICAL_SUPPLY_SYMBOLS.has(device.symbol)) continue
    if ((device.placements?.length ?? 0) === 0) {
      const placement = buildAutoSitplanPlacement(project, {
        circuitId: 'panel-supply',
        floorId: supplyFloorId,
        placementId: generateId(),
      })
      if (placement) {
        device.placements = [placement]
        changed = true
      }
    }
    for (const placement of device.placements ?? []) {
      conversionPlacementIds.add(placement.id)
    }
  }

  const placementsHiddenByPanel = getSituationPlanPlacementIdsHiddenByPanel(project)
  for (const floor of compatibilityFloors) {
    const hiddenIds = floor.hiddenSitplanPlacementIds ?? []
    const visibleIds = hiddenIds.filter(
      (id) => !conversionPlacementIds.has(id) || placementsHiddenByPanel.has(id),
    )
    if (visibleIds.length === hiddenIds.length) continue
    floor.hiddenSitplanPlacementIds = visibleIds.length > 0 ? visibleIds : undefined
    changed = true
  }
  return changed
}
