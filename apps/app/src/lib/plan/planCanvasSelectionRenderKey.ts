import type { Selection } from '@/types/ui'
import { WALL_POINT_ID_PREFIX } from './wallPointSelection'

const GEO_SELECTION_TYPES = new Set<Selection['type']>([
  'wall',
  'wallPoint',
  'door',
  'window',
  'stair',
  'stairPoint',
  'graphicElement',
  'ground',
])

/** Wall ids implicated in a wallPoint selection — vertex index changes are handled in WallRenderer. */
function wallIdsFromWallPointSelection(ids: string[]): string {
  const wallIds = new Set<string>()
  for (const id of ids) {
    if (!id.startsWith(WALL_POINT_ID_PREFIX)) continue
    const parts = id.split('|')
    const wallId = parts[1]
    if (wallId) wallIds.add(wallId)
  }
  return Array.from(wallIds).sort().join(',')
}

/**
 * Coarse key for PlanCanvas re-renders driven by floor-plan geometry selection.
 *
 * Placement/symbol selection chrome (highlights, multi-select frame, breadcrumb) lives in
 * PlacementSymbol, PlanMultiSelectFrame, and PlanCanvasSelectionBreadcrumb.
 *
 * Wall vertex picks use wall-level keys so point-to-point changes on the same wall do not
 * re-render the full PlanCanvas tree (WallRenderer subscribes to selection locally).
 */
export function planCanvasGeometrySelectionRenderKey(selection: Selection): string {
  const type = selection.type
  if (!type || selection.ids.length === 0) return 'none'
  if (!GEO_SELECTION_TYPES.has(type)) return 'none'
  if (type === 'wallPoint') {
    const wallIds = wallIdsFromWallPointSelection(selection.ids)
    return wallIds.length > 0 ? `geo:wallPoint:${wallIds}` : 'none'
  }
  return `geo:${type}:${selection.ids.join(',')}`
}

/** @deprecated Use planCanvasGeometrySelectionRenderKey */
export function planCanvasSelectionRenderKey(selection: Selection): string {
  return planCanvasGeometrySelectionRenderKey(selection)
}
