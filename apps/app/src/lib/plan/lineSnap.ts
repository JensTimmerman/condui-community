import type { Point2 } from '@/types/schema'
import { projectPointToSegment } from '@/lib/geometry'

export interface LineSnapSegment {
  a: Point2
  b: Point2
}

export interface NearbyLineSnap {
  point: Point2
  segment: LineSnapSegment
  segmentIndex: number
  distanceSq: number
}

/** Project a point onto the closest finite segment when it is inside the attraction radius. */
export function snapPointToNearbyLine(
  point: Point2,
  segments: LineSnapSegment[],
  radius: number,
): NearbyLineSnap | null {
  if (!Number.isFinite(radius) || radius <= 0) return null
  const radiusSq = radius * radius
  let best: NearbyLineSnap | null = null

  segments.forEach((segment, segmentIndex) => {
    const dx = segment.b.x - segment.a.x
    const dy = segment.b.y - segment.a.y
    if (dx * dx + dy * dy <= 1e-10) return
    const projected = projectPointToSegment(point, segment.a, segment.b)
    if (projected.distanceSq > radiusSq) return
    if (!best || projected.distanceSq < best.distanceSq) {
      best = {
        point: projected.point,
        segment,
        segmentIndex,
        distanceSq: projected.distanceSq,
      }
    }
  })

  return best
}

/**
 * Snap along a single-axis movement rail. The locked coordinate is never
 * changed; candidates are intersections between that rail and a segment.
 */
export function snapPointToNearbyLineOnAxis(
  point: Point2,
  segments: LineSnapSegment[],
  radius: number,
  axis: 'x' | 'y',
): NearbyLineSnap | null {
  if (!Number.isFinite(radius) || radius <= 0) return null
  const radiusSq = radius * radius
  let best: NearbyLineSnap | null = null

  segments.forEach((segment, segmentIndex) => {
    const dx = segment.b.x - segment.a.x
    const dy = segment.b.y - segment.a.y
    const crossingDelta = axis === 'x' ? dy : dx
    if (Math.abs(crossingDelta) <= 1e-10) return

    const lockedCoordinate = axis === 'x' ? point.y : point.x
    const segmentStartCoordinate = axis === 'x' ? segment.a.y : segment.a.x
    const t = (lockedCoordinate - segmentStartCoordinate) / crossingDelta
    if (t < 0 || t > 1) return

    const candidate = {
      x: segment.a.x + dx * t,
      y: segment.a.y + dy * t,
    }
    const movableOffset = axis === 'x' ? candidate.x - point.x : candidate.y - point.y
    const distanceSq = movableOffset * movableOffset
    if (distanceSq > radiusSq) return
    if (!best || distanceSq < best.distanceSq) {
      best = { point: candidate, segment, segmentIndex, distanceSq }
    }
  })

  return best
}

/**
 * Preserve the line constraint while allowing grid snap on the segment's
 * dominant travel axis. The line therefore wins on the perpendicular axis.
 */
export function snapNearbyLineToGrid(
  snap: NearbyLineSnap,
  gridSize: number,
  enabled: boolean,
): NearbyLineSnap {
  if (!enabled || !Number.isFinite(gridSize) || gridSize <= 0) return snap

  const { a, b } = snap.segment
  const dx = b.x - a.x
  const dy = b.y - a.y
  const horizontalDominant = Math.abs(dx) >= Math.abs(dy)
  const dominantDelta = horizontalDominant ? dx : dy
  if (Math.abs(dominantDelta) <= 1e-10) return snap

  const projectedAxis = horizontalDominant ? snap.point.x : snap.point.y
  const gridAxis = Math.round(projectedAxis / gridSize) * gridSize
  const startAxis = horizontalDominant ? a.x : a.y
  const t = (gridAxis - startAxis) / dominantDelta
  if (t < 0 || t > 1) return snap

  return {
    ...snap,
    point: {
      x: a.x + dx * t,
      y: a.y + dy * t,
    },
  }
}
