import type { Point2 } from '@/types/schema'
import { distance } from '@/lib/geometry'
import type { SegmentInfo } from './types'
import { SEGMENT_LENGTH_SQ_EPS, POINT_EPS } from './constants'

/**
 * Cumulative distances from wall start to each vertex.
 * lengths[i] = distance from points[0] to points[i].
 */
export function cumulativeLengths(points: Point2[]): number[] {
  const out: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1]! + distance(points[i - 1]!, points[i]!))
  }
  return out
}

export function getWallTotalLengthFromPoints(points: Point2[]): number {
  if (points.length < 2) return 0
  const lengths = cumulativeLengths(points)
  return lengths[lengths.length - 1] ?? 0
}

/**
 * Segment info for each segment of the wall polyline.
 */
export function getSegmentInfos(points: Point2[]): SegmentInfo[] {
  const lengths = cumulativeLengths(points)
  const infos: SegmentInfo[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const startDist = lengths[i] ?? 0
    const endDist = lengths[i + 1] ?? 0
    infos.push({
      index: i,
      startDist,
      endDist,
      length: Math.max(0, endDist - startDist),
    })
  }
  return infos
}

/**
 * Clamp a point to the line segment so the segment length is at least minLength
 * from neighbor toward candidate. Returns the clamped point (neighbor + direction * minLength).
 */
export function enforcePointMinSegmentLength(
  neighbor: Point2,
  candidate: Point2,
  minLength: number
): Point2 {
  const dx = candidate.x - neighbor.x
  const dy = candidate.y - neighbor.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < SEGMENT_LENGTH_SQ_EPS) {
    return neighbor
  }
  const len = Math.sqrt(lenSq)
  if (len >= minLength) return candidate
  const scale = minLength / len
  return {
    x: neighbor.x + dx * scale,
    y: neighbor.y + dy * scale,
  }
}

/**
 * Distance between two points (for segment length checks).
 */
export function segmentLength(p0: Point2, p1: Point2): number {
  return distance(p0, p1)
}

/**
 * True when newPoints is a rigid translation of oldPoints (same count, same delta for every point).
 */
export function isRigidTranslation(oldPoints: Point2[], newPoints: Point2[]): boolean {
  if (oldPoints.length !== newPoints.length || oldPoints.length === 0) return false
  const dx = newPoints[0]!.x - oldPoints[0]!.x
  const dy = newPoints[0]!.y - oldPoints[0]!.y
  for (let i = 1; i < oldPoints.length; i++) {
    const pOld = oldPoints[i]!
    const pNew = newPoints[i]!
    if (Math.abs((pNew.x - pOld.x) - dx) > POINT_EPS || Math.abs((pNew.y - pOld.y) - dy) > POINT_EPS) {
      return false
    }
  }
  return true
}
