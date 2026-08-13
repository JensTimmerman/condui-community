import { getCompatibilityFloorsFromProject } from '@/lib/projectV2/buildingFloors'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import type { Placement, TrunkDevice } from '@/types/schema'
import { generateId } from '@/utils'
import { getSupplyInverterSerialNumbers } from '@/utils/inverterMultipliers'
import {
  getDefaultSupplyConverterAcPhaseAssignment,
  getSupplyInverterUnitPhaseAssignments,
} from '@/lib/supplyAssembly/supplyConverterPhases'
import { getElectricalInstallationFromProject } from '@/lib/projectV2/electrical'

export interface SyncSupplyInverterMultiplierDeps {
  getDevice: (deviceId: string) => TrunkDevice | undefined
  updateDevice: (deviceId: string, updates: Partial<TrunkDevice>) => void
  getActiveFloorId: () => string | null
  getFallbackFloorId: () => string | undefined
  getInstallationSystem: () => NonNullable<
    ReturnType<typeof getElectricalInstallationFromProject>
  >['nominalVoltage']['system']
}

export function syncSupplyInverterMultiplierCount(
  deps: SyncSupplyInverterMultiplierDeps,
  deviceId: string,
  target: number
): boolean {
  if (!Number.isInteger(target) || target < 1 || target > 3) return false
  const device = deps.getDevice(deviceId)
  if (
    !device ||
    device.symbol !== 'inverter' ||
    (device.supplyPath !== 'converter-branch' && device.supplyPath !== 'backup')
  ) {
    return false
  }

  const placements = [...(device.placements ?? [])]
  const basePlacement = placements[0]
  const floorId = deps.getActiveFloorId() ?? basePlacement?.floorId ?? deps.getFallbackFloorId()
  if (!basePlacement || !floorId) return false

  const nextPlacements: Placement[] = placements.slice(0, target)
  for (let index = nextPlacements.length; index < target; index++) {
    nextPlacements.push({
      ...basePlacement,
      id: generateId(),
      floorId,
      pos: {
        x: basePlacement.pos.x + 24 * index,
        y: basePlacement.pos.y + 24 * index,
      },
    })
  }

  const serialNumbers = getSupplyInverterSerialNumbers(device).slice(0, target)
  while (serialNumbers.length < target) serialNumbers.push('')
  const system = deps.getInstallationSystem()
  const previousUnitAssignments = getSupplyInverterUnitPhaseAssignments(device, system, target)
  const conversionProps = {
    ...(device.conversionProps ?? {}),
    serialNumber: target === 1 ? serialNumbers[0] || undefined : undefined,
    serialNumbers: target > 1 ? serialNumbers : undefined,
    acPhaseAssignment:
      target >= 3
        ? getDefaultSupplyConverterAcPhaseAssignment(system)
        : target === 1
          ? previousUnitAssignments[0]
          : undefined,
    acPhaseAssignments: target === 2 ? previousUnitAssignments : undefined,
  }
  deps.updateDevice(deviceId, { placements: nextPlacements, conversionProps })
  return true
}

export function createSyncSupplyInverterMultiplierDeps(): SyncSupplyInverterMultiplierDeps {
  return {
    getDevice: (deviceId) => useProjectStore.getState().getTrunkDeviceById(deviceId)?.device,
    updateDevice: (deviceId, updates) =>
      useProjectStore.getState().updateSupplyTrunkDevice(deviceId, updates),
    getActiveFloorId: () => useUIStore.getState().activeFloorId,
    getFallbackFloorId: () => {
      const project = useProjectStore.getState().currentProject
      return project ? getCompatibilityFloorsFromProject(project)[0]?.id : undefined
    },
    getInstallationSystem: () => {
      const project = useProjectStore.getState().currentProject
      return getElectricalInstallationFromProject(project ?? {})?.nominalVoltage.system ?? '1N~'
    },
  }
}

export { getSupplyInverterMultiplier } from '@/utils/inverterMultipliers'
