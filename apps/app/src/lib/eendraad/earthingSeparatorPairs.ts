import type { TrunkDevice } from '@/types/schema'

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
