import type { Endpoint, Placement } from '@/types/schema'

/**
 * Which placement to retarget when moving an endpoint to another floor.
 * Matches plan context menu behaviour (active floor placement, else sole placement).
 */
export function resolvePlacementForFloorMove(
  endpoint: Endpoint,
  activeFloorId: string | null
): Placement | undefined {
  if (activeFloorId) {
    const onActive = endpoint.placements.find((p) => p.floorId === activeFloorId)
    if (onActive) return onActive
  }
  if (endpoint.placements.length === 1) return endpoint.placements[0]
  return undefined
}
