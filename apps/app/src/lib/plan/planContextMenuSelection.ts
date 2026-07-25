import type { Endpoint, Placement } from '@/types/schema'
import type { Point } from '@/types/ui'
import {
  resolveSelectionToEndpointIds,
  type ResolveSelectionToEndpointIdsDeps,
  type PlanSelection,
} from '@/lib/plan/selectionResolvers'

export type PlacementWorldBounds = {
  left: number
  right: number
  top: number
  bottom: number
}

export type SelectedPlacementItem = {
  endpointId: string
  placementId: string
  pos: { x: number; y: number }
  bounds: PlacementWorldBounds
}

export type PlacementBoundsResolver = (
  pos: Point,
  rotationDeg: number,
  scale: number,
  socketCount: number,
  symbolType?: string
) => PlacementWorldBounds

export type ResolveSelectedPlacementsDeps = ResolveSelectionToEndpointIdsDeps & {
  getEndpointById: (id: string) => Endpoint | undefined
  getPlacementsByFloor: (floorId: string) => Array<
    Placement & {
      endpointId?: string
    }
  >
}

export function getSelectedPlacementsForSelection(
  selection: PlanSelection,
  activeFloorId: string | null,
  deps: ResolveSelectedPlacementsDeps,
  getPlacementWorldBounds: PlacementBoundsResolver
): SelectedPlacementItem[] {
  const result: SelectedPlacementItem[] = []
  if (!activeFloorId) return result

  if (selection.type === 'placement') {
    const floorPlacements = deps.getPlacementsByFloor(activeFloorId)
    selection.ids.forEach((placementId) => {
      const row = floorPlacements.find((p) => p.id === placementId)
      if (!row?.endpointId) return
      const endpoint = deps.getEndpointById(row.endpointId)
      if (!endpoint) return
      result.push(buildSelectedPlacementItem(row.endpointId, row, endpoint, getPlacementWorldBounds))
    })
    return result
  }

  const endpointIds = resolveSelectionToEndpointIds(selection, deps)
  endpointIds.forEach((endpointId) => {
    const endpoint = deps.getEndpointById(endpointId)
    if (!endpoint) return
    const placement = endpoint.placements.find((p) => p.floorId === activeFloorId)
    if (!placement) return
    result.push(buildSelectedPlacementItem(endpointId, placement, endpoint, getPlacementWorldBounds))
  })
  return result
}

function buildSelectedPlacementItem(
  endpointId: string,
  placement: Placement,
  endpoint: Endpoint,
  getPlacementWorldBounds: PlacementBoundsResolver
): SelectedPlacementItem {
  const socketCount = (endpoint.type === 'socket' && endpoint.socketProps?.socketCount) || 1
  const bounds = getPlacementWorldBounds(
    placement.pos,
    placement.rotationDeg,
    placement.scale,
    socketCount,
    endpoint.symbol
  )
  return {
    endpointId,
    placementId: placement.id,
    pos: { x: placement.pos.x, y: placement.pos.y },
    bounds,
  }
}
