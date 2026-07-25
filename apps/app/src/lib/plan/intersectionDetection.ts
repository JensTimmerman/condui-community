import type { Point2 } from '@/types/schema'
import { clamp } from '@/lib/geometry'

function getPointPairs(points: Point2[]): Array<[Point2, Point2]> {
  const pairs: Array<[Point2, Point2]> = []
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]
    const end = points[i + 1]
    if (!start || !end) continue
    pairs.push([start, end])
  }
  return pairs
}

/**
 * Find the intersection point between two line segments.
 * Returns null if the segments don't intersect.
 */
export function findLineIntersection(
  p1: Point2,
  p2: Point2,
  p3: Point2,
  p4: Point2
): Point2 | null {
  const x1 = p1.x
  const y1 = p1.y
  const x2 = p2.x
  const y2 = p2.y
  const x3 = p3.x
  const y3 = p3.y
  const x4 = p4.x
  const y4 = p4.y

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denom) < 1e-10) return null // Lines are parallel

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom

  // Check if intersection is within both segments
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
    }
  }

  return null
}

/**
 * Find the perpendicular intersection point from a point to a line segment.
 * Returns the closest point on the line segment, or null if the perpendicular
 * doesn't fall within the segment.
 */
export function findPerpendicularIntersection(
  point: Point2,
  lineStart: Point2,
  lineEnd: Point2
): { point: Point2; t: number } | null {
  const dx = lineEnd.x - lineStart.x
  const dy = lineEnd.y - lineStart.y
  const lengthSq = dx * dx + dy * dy

  if (lengthSq < 1e-10) return null // Line segment has zero length

  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSq

  // Clamp t to [0, 1] to ensure point is on the segment
  const clampedT = clamp(t, 0, 1)

  return {
    point: {
      x: lineStart.x + clampedT * dx,
      y: lineStart.y + clampedT * dy,
    },
    t: clampedT,
  }
}

/**
 * Find all intersection points between a wall and other walls.
 * Returns an array of intersection points with their t values along the wall.
 */
export function findAllIntersections(
  wallPoints: Point2[],
  otherWalls: Array<{ points: Point2[] }>
): Array<{ point: Point2; t: number; segmentIndex: number }> {
  const intersections: Array<{ point: Point2; t: number; segmentIndex: number }> = []
  const wallSegments = getPointPairs(wallPoints)
  let wallTotalLength = 0
  for (const [p1, p2] of wallSegments) {
    wallTotalLength += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2))
  }
  if (wallTotalLength < 1e-10) return intersections

  // Check each segment of the wall
  for (const [i, [segStart, segEnd]] of wallSegments.entries()) {
    const segLength = Math.sqrt(
      Math.pow(segEnd.x - segStart.x, 2) + Math.pow(segEnd.y - segStart.y, 2)
    )

    // Check against all segments of other walls
    for (const otherWall of otherWalls) {
      for (const [otherStart, otherEnd] of getPointPairs(otherWall.points)) {
        const intersection = findLineIntersection(segStart, segEnd, otherStart, otherEnd)
        if (intersection) {
          // Calculate t value along the wall segment
          const distFromStart = Math.sqrt(
            Math.pow(intersection.x - segStart.x, 2) + Math.pow(intersection.y - segStart.y, 2)
          )
          void (segLength > 0 ? distFromStart / segLength : 0)

          // Calculate overall t value along the entire wall
          let totalLengthBeforeSegment = 0
          for (let k = 0; k < i; k++) {
            const segment = wallSegments[k]
            if (!segment) continue
            const [p1, p2] = segment
            totalLengthBeforeSegment += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2))
          }
          const overallT = (totalLengthBeforeSegment + distFromStart) / wallTotalLength

          intersections.push({
            point: intersection,
            t: overallT,
            segmentIndex: i,
          })
        }
      }
    }
  }

  return intersections
}
