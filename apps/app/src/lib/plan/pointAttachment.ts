import type { Point2, Wall, AttachedPoint } from '@/types/schema'
import { clamp } from '@/lib/geometry'

const ATTACHMENT_THRESHOLD = 5 // pixels

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
 * Calculate the distance from a point to a line segment.
 */
function pointToLineDistance(point: Point2, lineStart: Point2, lineEnd: Point2): number {
  const dx = lineEnd.x - lineStart.x
  const dy = lineEnd.y - lineStart.y
  const lengthSq = dx * dx + dy * dy

  if (lengthSq < 1e-10) {
    // Line segment has zero length, return distance to start point
    return Math.sqrt(
      Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2)
    )
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSq)
  )

  const projX = lineStart.x + t * dx
  const projY = lineStart.y + t * dy

  return Math.sqrt(Math.pow(point.x - projX, 2) + Math.pow(point.y - projY, 2))
}

/**
 * Calculate the t value (0-1) along a wall segment for a given point.
 */
function calculateTValue(point: Point2, lineStart: Point2, lineEnd: Point2): number {
  const dx = lineEnd.x - lineStart.x
  const dy = lineEnd.y - lineStart.y
  const lengthSq = dx * dx + dy * dy

  if (lengthSq < 1e-10) return 0

  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSq
  return clamp(t, 0, 1)
}

/**
 * Detect if a point should be attached to a wall.
 * Returns attachment info if the point is within threshold, null otherwise.
 */
export function detectAttachment(
  point: Point2,
  wall: Wall,
  threshold: number = ATTACHMENT_THRESHOLD
): { wallId: string; pointIndex: number; t: number } | null {
  // Check each segment of the wall
  const wallSegments = getPointPairs(wall.points)
  for (const [i, [segmentStart, segmentEnd]] of wallSegments.entries()) {
    const lineDistance = pointToLineDistance(point, segmentStart, segmentEnd)

    if (lineDistance <= threshold) {
      const t = calculateTValue(point, segmentStart, segmentEnd)

      // Calculate overall t value along the entire wall
      let totalLength = 0
      let segmentLength = 0
      for (const [j, [p1, p2]] of wallSegments.entries()) {
        const segLen = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2))
        if (j < i) {
          totalLength += segLen
        } else if (j === i) {
          segmentLength = segLen
        }
      }

      const overallT =
        segmentLength > 0 ? (totalLength + t * segmentLength) / (totalLength + segmentLength) : 0

      return {
        wallId: wall.id,
        pointIndex: i,
        t: overallT,
      }
    }
  }

  return null
}

/**
 * Calculate the position of an attached point when the parent wall moves.
 */
export function calculateAttachedPosition(
  attachment: AttachedPoint,
  parentWall: Wall
): Point2 {
  let totalLength = 0
  const wallSegments = getPointPairs(parentWall.points)

  // Calculate total wall length
  for (const [p1, p2] of wallSegments) {
    totalLength += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2))
  }

  if (totalLength < 1e-10) {
    // Wall has zero length, return first point
    return parentWall.points[0] || { x: 0, y: 0 }
  }

  // Find the segment where the attachment is located
  const targetLength = attachment.t * totalLength
  let currentLength = 0

  for (const [p1, p2] of wallSegments) {
    const segLength = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2))

    if (currentLength + segLength >= targetLength) {
      // This segment contains the attachment point
      const t = segLength > 0 ? (targetLength - currentLength) / segLength : 0
      return {
        x: p1.x + t * (p2.x - p1.x),
        y: p1.y + t * (p2.y - p1.y),
      }
    }

    currentLength += segLength
  }

  // Fallback to last point
  return parentWall.points[parentWall.points.length - 1] || { x: 0, y: 0 }
}

/**
 * Update all attached points when a wall is modified.
 * This should be called after moving or modifying wall points.
 */
export function updateAttachments(
  modifiedWall: Wall,
  allWalls: Wall[]
): void {
  // Find all walls that have points attached to the modified wall
  for (const wall of allWalls) {
    if (wall.id === modifiedWall.id) continue

    if (wall.attachedPoints) {
      for (const attachment of wall.attachedPoints) {
        if (attachment.wallId === modifiedWall.id) {
          // This point is attached to the modified wall
          const newPosition = calculateAttachedPosition(attachment, modifiedWall)
          const pointIndex = attachment.pointIndex

          if (pointIndex >= 0 && pointIndex < wall.points.length) {
            wall.points[pointIndex] = newPosition
          }
        }
      }
    }
  }
}

/**
 * Remove an attachment relationship.
 */
export function detachPoint(wall: Wall, pointIndex: number): void {
  if (wall.attachedPoints) {
    wall.attachedPoints = wall.attachedPoints.filter((ap) => ap.pointIndex !== pointIndex)
  }
}
