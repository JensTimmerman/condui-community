import type { Point2, Wall } from '@/types/schema'

export type WallSelectionDeletionPlan = {
  wholeWallIds: string[]
  pointIndicesByWall: Map<string, number[]>
  segmentIndicesByWall: Map<string, number[]>
}

type BuildWallSelectionDeletionPlanOptions = {
  walls: readonly Wall[]
  selectedWallIds: readonly string[]
  selectedPointIndices: ReadonlyMap<string, readonly number[]>
  selectedSegmentIndices: ReadonlyMap<string, readonly number[]>
}

/** Resolve canvas-local wall point/segment state into one shared deletion plan. */
export function buildWallSelectionDeletionPlan({
  walls,
  selectedWallIds,
  selectedPointIndices,
  selectedSegmentIndices,
}: BuildWallSelectionDeletionPlanOptions): WallSelectionDeletionPlan {
  const wallById = new Map(walls.map((wall) => [wall.id, wall]))
  const candidateIds = new Set([
    ...selectedWallIds,
    ...selectedPointIndices.keys(),
    ...selectedSegmentIndices.keys(),
  ])
  const wholeWallIds: string[] = []
  const pointIndicesByWall = new Map<string, number[]>()
  const segmentIndicesByWall = new Map<string, number[]>()

  for (const wallId of candidateIds) {
    const wall = wallById.get(wallId)
    if (!wall) continue
    const segmentIndices = Array.from(new Set(selectedSegmentIndices.get(wallId) ?? []))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < wall.points.length - 1)
      .sort((a, b) => a - b)
    const pointIndices = Array.from(new Set(selectedPointIndices.get(wallId) ?? []))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < wall.points.length)
      .sort((a, b) => a - b)

    if (segmentIndices.length > 0) {
      segmentIndicesByWall.set(wallId, segmentIndices)
    } else if (pointIndices.length >= wall.points.length) {
      wholeWallIds.push(wallId)
    } else if (pointIndices.length > 0) {
      pointIndicesByWall.set(wallId, pointIndices)
    } else if (selectedWallIds.includes(wallId)) {
      wholeWallIds.push(wallId)
    }
  }

  return { wholeWallIds, pointIndicesByWall, segmentIndicesByWall }
}

function pointsMatch(a: Point2, b: Point2, epsilon = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
}

/** Remove existing wall edges and return each remaining connected point run. */
export function splitWallPointsAtDeletedSegments(
  points: readonly Point2[],
  segmentIndices: readonly number[]
): Point2[][] {
  if (points.length < 2) return []
  const segmentCount = points.length - 1
  const deleted = new Set(
    segmentIndices.filter(
      (index) => Number.isInteger(index) && index >= 0 && index < segmentCount
    )
  )
  if (deleted.size === 0) return [[...points]]
  if (deleted.size === segmentCount) return []

  const isClosed = points.length >= 4 && pointsMatch(points[0]!, points[points.length - 1]!)
  const paths: Point2[][] = []

  if (!isClosed) {
    let path: Point2[] = [points[0]!]
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const nextPoint = points[segmentIndex + 1]!
      if (deleted.has(segmentIndex)) {
        if (path.length >= 2) paths.push(path)
        path = [nextPoint]
      } else {
        path.push(nextPoint)
      }
    }
    if (path.length >= 2) paths.push(path)
    return paths
  }

  // A closed wall has the first vertex repeated at the end. Start immediately after a
  // removed edge so the remaining cyclic runs are returned as open splines.
  const uniquePoints = points.slice(0, -1)
  const firstDeleted = [...deleted][0]!
  const startVertex = (firstDeleted + 1) % segmentCount
  let path: Point2[] = [uniquePoints[startVertex]!]
  for (let offset = 0; offset < segmentCount; offset += 1) {
    const segmentIndex = (startVertex + offset) % segmentCount
    const nextVertex = (segmentIndex + 1) % segmentCount
    const nextPoint = uniquePoints[nextVertex]!
    if (deleted.has(segmentIndex)) {
      if (path.length >= 2) paths.push(path)
      path = [nextPoint]
    } else {
      path.push(nextPoint)
    }
  }
  if (path.length >= 2) paths.push(path)
  return paths
}
