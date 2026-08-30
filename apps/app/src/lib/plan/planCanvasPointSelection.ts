import type { Point2, Stair, Wall } from '@/types/schema'
import type { Selection } from '@/types/ui'

export const WALL_POINT_ID_PREFIX = 'v|'
export const STAIR_POINT_ID_PREFIX = 's|'

export type PlanSelectionBounds = { x: number; y: number; width: number; height: number }

export function parseWallPointIds(ids: string[]): Map<string, number[]> {
  return parseIndexedPointIds(ids, WALL_POINT_ID_PREFIX)
}

export function parseStairPointIds(ids: string[]): Map<string, number[]> {
  return parseIndexedPointIds(ids, STAIR_POINT_ID_PREFIX)
}

function parseIndexedPointIds(ids: string[], prefix: string): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue
    const parts = id.split('|')
    if (parts.length < 3) continue
    const entityId = parts[1]!
    const pointIndex = Number.parseInt(parts[2]!, 10)
    if (Number.isNaN(pointIndex)) continue
    const indices = map.get(entityId) ?? []
    if (!indices.includes(pointIndex)) indices.push(pointIndex)
    map.set(entityId, indices)
  }
  return map
}

export function encodeWallPointId(wallId: string, pointIndex: number): string {
  return `${WALL_POINT_ID_PREFIX}${wallId}|${pointIndex}`
}

export function encodeStairPointId(stairId: string, pointIndex: number): string {
  return `${STAIR_POINT_ID_PREFIX}${stairId}|${pointIndex}`
}

export function cloneIndexedPointMap(source: Map<string, number[]>): Map<string, number[]> {
  return new Map(Array.from(source.entries(), ([id, indices]) => [id, [...indices]]))
}

function pointMapForIds<T extends { id: string; points: Point2[] }>(
  ids: string[],
  entities: T[]
): Map<string, number[]> {
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]))
  const result = new Map<string, number[]>()
  for (const id of ids) {
    const entity = entitiesById.get(id)
    if (entity)
      result.set(
        id,
        entity.points.map((_, index) => index)
      )
  }
  return result
}

export function resolvePlanCanvasPointSelection({
  selection,
  selectedWallPointIndices,
  selectedStairPointIndices,
  walls,
  stairs,
}: {
  selection: Selection
  selectedWallPointIndices: Map<string, number[]>
  selectedStairPointIndices: Map<string, number[]>
  walls: Wall[]
  stairs: Stair[]
}): { wallPoints: Map<string, number[]>; stairPoints: Map<string, number[]> } {
  if (selection.type === 'wallPoint') {
    return {
      wallPoints: parseWallPointIds(selection.ids),
      stairPoints: parseStairPointIds(selection.ids),
    }
  }

  let wallPoints = cloneIndexedPointMap(selectedWallPointIndices)
  if (wallPoints.size === 0 && selection.type === 'wall') {
    wallPoints = pointMapForIds(selection.ids, walls)
  }

  let stairPoints = cloneIndexedPointMap(selectedStairPointIndices)
  if (stairPoints.size === 0 && selection.type === 'stair') {
    stairPoints = pointMapForIds(selection.ids, stairs)
  } else if (
    stairPoints.size === 0 &&
    selection.type === 'stairPoint' &&
    selection.ids.length > 1
  ) {
    const [stairId, rawPointIndex] = selection.ids
    const pointIndex = Number(rawPointIndex)
    if (stairId && Number.isFinite(pointIndex)) stairPoints = new Map([[stairId, [pointIndex]]])
  }

  return { wallPoints, stairPoints }
}

export function getPlanCanvasPointSelectionBounds({
  wallPointIndices,
  stairPointIndices,
  walls,
  stairs,
}: {
  wallPointIndices: Map<string, number[]>
  stairPointIndices: Map<string, number[]>
  walls: Wall[]
  stairs: Stair[]
}): PlanSelectionBounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false

  const include = (point: Point2 | undefined) => {
    if (!point) return
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
    found = true
  }
  const includeSelectedPoints = <T extends { id: string; points: Point2[] }>(
    pointIndices: Map<string, number[]>,
    entities: T[],
    includeAllWhenEmpty: boolean
  ) => {
    const entitiesById = new Map(entities.map((entity) => [entity.id, entity]))
    for (const [id, indices] of pointIndices) {
      const entity = entitiesById.get(id)
      if (!entity) continue
      for (const index of includeAllWhenEmpty && indices.length === 0
        ? entity.points.map((_, i) => i)
        : indices) {
        include(entity.points[index])
      }
    }
  }

  includeSelectedPoints(wallPointIndices, walls, true)
  includeSelectedPoints(stairPointIndices, stairs, false)
  return found ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null
}
