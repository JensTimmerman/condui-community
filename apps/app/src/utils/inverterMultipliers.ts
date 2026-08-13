import type { TrunkDevice } from '@/types/schema'

export function supportsSupplyInverterMultiplier(
  device: TrunkDevice | undefined
): boolean {
  if (!device || device.symbol !== 'inverter') return false
  return device.supplyPath === 'backup' || device.supplyPath === 'converter-branch'
}

export function getSupplyInverterMultiplier(
  device: Pick<TrunkDevice, 'symbol' | 'placements' | 'conversionProps'>
): number {
  if (device.symbol !== 'inverter') return 1
  return Math.max(
    1,
    device.placements?.length ?? 0,
    device.conversionProps?.serialNumbers?.length ?? 0
  )
}

export function getSupplyInverterSerialNumbers(device: TrunkDevice): string[] {
  const count = getSupplyInverterMultiplier(device)
  const stored = device.conversionProps?.serialNumbers ?? []
  return Array.from({ length: count }, (_, index) =>
    index === 0
      ? (stored[index] ?? device.conversionProps?.serialNumber ?? '')
      : (stored[index] ?? '')
  )
}

/** Keeps ordered per-unit serials aligned when situation-plan placements are removed. */
export function removeSupplyInverterPlacements(
  device: TrunkDevice,
  removedPlacementIds: ReadonlySet<string>
): boolean {
  if (device.symbol !== 'inverter' || !device.placements?.length) return false
  const serialNumbers = getSupplyInverterSerialNumbers(device)
  const phaseAssignments = device.conversionProps?.acPhaseAssignments ?? []
  const retainedIndexes = device.placements.flatMap((placement, index) =>
    removedPlacementIds.has(placement.id) ? [] : [index]
  )
  if (retainedIndexes.length === device.placements.length) return false

  device.placements = retainedIndexes.flatMap((index) => {
    const placement = device.placements?.[index]
    return placement ? [placement] : []
  })
  const retainedSerialNumbers = retainedIndexes.map((index) => serialNumbers[index] ?? '')
  const retainedPhaseAssignments = retainedIndexes.flatMap((index) => {
    const assignment = phaseAssignments[index]
    return assignment ? [assignment] : []
  })
  device.conversionProps = {
    ...(device.conversionProps ?? {}),
    serialNumber:
      retainedSerialNumbers.length === 1 ? retainedSerialNumbers[0] || undefined : undefined,
    serialNumbers: retainedSerialNumbers.length > 1 ? retainedSerialNumbers : undefined,
    acPhaseAssignment:
      retainedIndexes.length === 1
        ? retainedPhaseAssignments[0] ?? device.conversionProps?.acPhaseAssignment
        : undefined,
    acPhaseAssignments:
      retainedIndexes.length === 2 && retainedPhaseAssignments.length === 2
        ? retainedPhaseAssignments
        : undefined,
  }
  return true
}
