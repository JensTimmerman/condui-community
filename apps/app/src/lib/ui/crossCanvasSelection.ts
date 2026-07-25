import type { Endpoint, Placement } from '@/types/schema'
import type { Selection } from '@/types/ui'

/**
 * Whether a 1‑wire endpoint should render as selected for the global selection.
 * Sitplan uses `type: 'placement'` with placement ids for multiplied symbols; 1‑wire uses endpoint ids.
 */
export function endpointSelectionMatches(selection: Selection, endpoint: Endpoint): boolean {
  if (!selection.ids.length) return false
  if (selection.ids.includes(endpoint.id)) return true
  if (selection.type !== 'placement') return false
  const wanted = new Set(selection.ids)
  return (endpoint.placements ?? []).some((p) => wanted.has(p.id))
}

/** Map sitplan placement selection to endpoint ids for layout bounds / hit testing. */
export function endpointIdsForPlacementSelection(
  getAllEndpoints: () => Endpoint[],
  placementIds: string[],
): Set<string> {
  if (placementIds.length === 0) return new Set()
  const wanted = new Set(placementIds)
  const out = new Set<string>()
  for (const ep of getAllEndpoints()) {
    if ((ep.placements ?? []).some((p) => wanted.has(p.id))) out.add(ep.id)
  }
  return out
}

/**
 * Sitplan drag should use the multi-placement path when a selected endpoint has
 * multiple unlocked placements on the same floor, even if the selection is a
 * single endpoint id. Otherwise dragging one selected symbol moves only that
 * placement while the other selected placements snap back.
 */
export function endpointSelectionShouldDragAllPlacements(
  selection: Selection,
  endpoint: Endpoint | null | undefined,
  draggedPlacement: Placement,
): boolean {
  if (!endpoint || selection.type !== 'endpoint') return false
  if (!selection.ids.includes(endpoint.id)) return false
  const unlockedOnSameFloor = (endpoint.placements ?? []).filter(
    (placement) =>
      placement.floorId === draggedPlacement.floorId &&
      !(placement.locked ?? false),
  )
  return unlockedOnSameFloor.length > 1
}
