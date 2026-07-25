import {
  projectPointToWall,
  computeOpeningGeometry,
  getWallTotalLength,
} from '@/handlers/plan/wallDrawing'
import { findAllIntersections } from '@/lib/plan/intersectionDetection'
import type { Point2, Wall } from '@/types/schema'

export type OpeningPositionSnapResult = {
  point: Point2
  position: number
  kind: 'spanCenter' | 'grid' | 'wall'
}

type ResolveOpeningPositionSnapOptions = {
  wall: Wall
  walls: readonly Wall[]
  pointer: Point2
  spanCenterRadius: number
  snapToGrid: boolean
  gridSize: number
}

const dedupeSorted = (values: number[], epsilon = 1e-7): number[] => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.filter(
    (value, index) => index === 0 || Math.abs(value - sorted[index - 1]!) > epsilon
  )
}

/** Overall normalized positions where vertices or other walls divide this wall. */
export function getOpeningSpanBreakPositions(wall: Wall, walls: readonly Wall[]): number[] {
  const totalLength = getWallTotalLength(wall.points)
  if (totalLength <= 1e-10) return [0, 1]

  const positions = [0, 1]
  let distance = 0
  for (let index = 1; index < wall.points.length - 1; index += 1) {
    const previous = wall.points[index - 1]
    const point = wall.points[index]
    if (!previous || !point) continue
    distance += Math.hypot(point.x - previous.x, point.y - previous.y)
    positions.push(distance / totalLength)
  }

  const otherWalls = walls.filter((entry) => entry.id !== wall.id)
  for (const intersection of findAllIntersections(wall.points, otherWalls)) {
    positions.push(intersection.t)
  }

  return dedupeSorted(positions.map((position) => Math.max(0, Math.min(1, position))))
}

/** Resolve a door/window center while keeping it exactly on its owning wall. */
export function resolveOpeningPositionSnap({
  wall,
  walls,
  pointer,
  spanCenterRadius,
  snapToGrid,
  gridSize,
}: ResolveOpeningPositionSnapOptions): OpeningPositionSnapResult {
  const rawProjection = projectPointToWall(wall.points, pointer)
  const rawGeometry = computeOpeningGeometry(wall.points, rawProjection.t)
  if (!rawGeometry) return { point: pointer, position: 0, kind: 'wall' }

  const totalLength = getWallTotalLength(wall.points)
  if (Number.isFinite(spanCenterRadius) && spanCenterRadius > 0 && totalLength > 1e-10) {
    const breaks = getOpeningSpanBreakPositions(wall, walls)
    let nearestCenter: OpeningPositionSnapResult | null = null
    let nearestAlongDistance = Infinity
    for (let index = 0; index < breaks.length - 1; index += 1) {
      const start = breaks[index]
      const end = breaks[index + 1]
      if (start == null || end == null || end - start <= 1e-7) continue
      const position = (start + end) / 2
      const alongDistance = Math.abs(position - rawProjection.t) * totalLength
      if (alongDistance > spanCenterRadius || alongDistance >= nearestAlongDistance) continue
      const geometry = computeOpeningGeometry(wall.points, position)
      if (!geometry) continue
      nearestAlongDistance = alongDistance
      nearestCenter = { point: geometry.center, position, kind: 'spanCenter' }
    }
    if (nearestCenter) return nearestCenter
  }

  if (snapToGrid && Number.isFinite(gridSize) && gridSize > 0) {
    const gridPoint = {
      x: Math.round(pointer.x / gridSize) * gridSize,
      y: Math.round(pointer.y / gridSize) * gridSize,
    }
    const gridProjection = projectPointToWall(wall.points, gridPoint)
    const gridGeometry = computeOpeningGeometry(wall.points, gridProjection.t)
    if (gridGeometry) {
      return { point: gridGeometry.center, position: gridProjection.t, kind: 'grid' }
    }
  }

  return { point: rawGeometry.center, position: rawProjection.t, kind: 'wall' }
}
