import { generateId } from '@/utils'
import type { Endpoint, Placement } from '@/types/schema'

import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { getCompatibilityFloorsFromProject } from '@/lib/projectV2/buildingFloors'

export interface SyncEndpointMultiplierDeps {
  getEndpointById: (id: string) => Endpoint | undefined
  addPlacement: (endpointId: string, placement: Placement) => void
  deletePlacements: (ids: string[]) => void
  getActiveFloorId: () => string | null
  getFallbackFloorId: () => string | undefined
}

export function syncEndpointMultiplierCount(
  deps: SyncEndpointMultiplierDeps,
  endpointId: string,
  target: number
): boolean {
  if (!Number.isFinite(target) || !Number.isInteger(target) || target < 1) {
    return false
  }

  const latestEndpoint = deps.getEndpointById(endpointId)
  if (!latestEndpoint) return false

  const current = latestEndpoint.placements.length

  if (target < current) {
    const placementIdsToRemove = latestEndpoint.placements
      .slice(target)
      .map((placement) => placement.id)
    if (placementIdsToRemove.length > 0) {
      deps.deletePlacements(placementIdsToRemove)
    }
    return true
  }

  if (target === current) return true

  const floorId =
    deps.getActiveFloorId() ??
    latestEndpoint.placements[0]?.floorId ??
    deps.getFallbackFloorId()
  if (!floorId) return false

  const basePlacement =
    latestEndpoint.placements.find((p) => p.floorId === floorId) ??
    latestEndpoint.placements[0]
  if (!basePlacement) return false

  const start = current
  for (let i = start; i < target; i++) {
    const step = i - start + 1
    deps.addPlacement(latestEndpoint.id, {
      ...basePlacement,
      id: generateId(),
      floorId,
      pos: {
        x: basePlacement.pos.x + 24 * step,
        y: basePlacement.pos.y + 24 * step,
      },
    })
  }
  return true
}

export function createSyncEndpointMultiplierDeps(): SyncEndpointMultiplierDeps {
  const state = useProjectStore.getState()
  return {
    getEndpointById: state.getEndpointById,
    addPlacement: state.addPlacement,
    deletePlacements: state.deletePlacements,
    getActiveFloorId: () => useUIStore.getState().activeFloorId,
    getFallbackFloorId: () =>
      state.currentProject ? getCompatibilityFloorsFromProject(state.currentProject)[0]?.id : undefined,
  }
}
