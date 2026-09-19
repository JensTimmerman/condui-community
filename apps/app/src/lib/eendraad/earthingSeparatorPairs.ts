import type { TrunkDevice } from '@/types/schema'
import { findGroundTrunkDeviceOwner } from '@/lib/eendraad/panelGround'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

/** Resolve the physical pair behind one user-facing earthing separator. */
export function getEarthingSeparatorPairIds(
  devices: readonly TrunkDevice[] | undefined,
  deviceId: string
): string[] {
  const device = devices?.find((candidate) => candidate.id === deviceId)
  if (!device || device.type !== 'earthing_separator') return [deviceId]

  if (device.earthingSeparatorPairId) {
    return (devices ?? [])
      .filter(
        (candidate) =>
          candidate.type === 'earthing_separator' &&
          candidate.earthingSeparatorPairId === device.earthingSeparatorPairId
      )
      .map((candidate) => candidate.id)
  }

  // Older files did not store pair ids; keep consecutive legacy separators paired.
  const unpaired = (devices ?? []).filter(
    (candidate) =>
      candidate.type === 'earthing_separator' && !candidate.earthingSeparatorPairId
  )
  const index = unpaired.findIndex((candidate) => candidate.id === deviceId)
  if (index < 0) return [deviceId]
  const pairStart = index - (index % 2)
  return unpaired.slice(pairStart, pairStart + 2).map((candidate) => candidate.id)
}

/** Resolve a separator pair from installation or panel-owned earth stems. */
export function resolveEarthingSeparatorPairIds(
  project: ProjectWithOptionalV2Electrical | null | undefined,
  deviceId: string
): string[] {
  if (!project) return [deviceId]
  const owner = findGroundTrunkDeviceOwner(
    getProjectElectricalPanels(project),
    getProjectElectricalInstallation(project),
    deviceId
  )
  return getEarthingSeparatorPairIds(owner?.devices, deviceId)
}
