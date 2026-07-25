import type { Door, Point2 } from '@/types/schema'
import { getRoomPolygonsFromWalls } from '@/lib/plan/roomPolygons'
import { resolveWallThicknessPx } from '@/lib/plan/wallVolumeGeometry'
import type { Wall } from '@/types/schema'
import { clamp, pointInPolygon } from '@/lib/geometry'

const DEFAULT_SWING_ANGLE_DEG = 35

/** Screen-space deadzone around the wall line before open-side flips while hovering. */
export const OPENING_WALL_NORMAL_DEADZONE_SCREEN_PX = 14

export function openingWallNormalDeadzoneCanvas(zoom: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return OPENING_WALL_NORMAL_DEADZONE_SCREEN_PX / z
}

function leftNormalFromTangent(tangent: Point2): Point2 {
  return { x: -tangent.y, y: tangent.x }
}

/** Which side of the wall (relative to its tangent) a point lies on. */
export function getWallNormalSide(
  center: Point2,
  tangent: Point2,
  point: Point2,
): 'left' | 'right' {
  const leftNormal = leftNormalFromTangent(tangent)
  const dx = point.x - center.x
  const dy = point.y - center.y
  const d = dx * leftNormal.x + dy * leftNormal.y
  return d >= 0 ? 'left' : 'right'
}

/** Like getWallNormalSide but returns null when the pointer is on the wall deadzone. */
export function getWallNormalSideWithDeadzone(
  center: Point2,
  tangent: Point2,
  point: Point2,
  deadzonePx: number,
): 'left' | 'right' | null {
  const leftNormal = leftNormalFromTangent(tangent)
  const d =
    (point.x - center.x) * leftNormal.x + (point.y - center.y) * leftNormal.y
  if (Math.abs(d) < deadzonePx) return null
  return d >= 0 ? 'left' : 'right'
}

/** Detect which wall-normal side is interior, when unambiguous. */
export function detectInteriorSide(
  center: Point2,
  tangent: Point2,
  roomPolygons: Point2[][],
  thickness: number,
): 'left' | 'right' | null {
  const leftNormal = leftNormalFromTangent(tangent)
  const probeOffset = Math.max(4, thickness * 0.75)
  const leftProbe = {
    x: center.x + leftNormal.x * probeOffset,
    y: center.y + leftNormal.y * probeOffset,
  }
  const rightProbe = {
    x: center.x - leftNormal.x * probeOffset,
    y: center.y - leftNormal.y * probeOffset,
  }
  const leftInside = roomPolygons.some((poly) => pointInPolygon(leftProbe, poly))
  const rightInside = roomPolygons.some((poly) => pointInPolygon(rightProbe, poly))
  if (leftInside && !rightInside) return 'left'
  if (rightInside && !leftInside) return 'right'
  return null
}

/**
 * Which wall-normal side the door leaf opens toward.
 * Mirrors WallRenderer swing geometry so placement and rendering stay aligned.
 */
export function computeDoorOpenNormalSide(
  swing: NonNullable<Door['swing']>,
  direction: NonNullable<Door['direction']>,
  tangent: Point2,
  interiorSide: 'left' | 'right' | null,
  swingAngleDeg = DEFAULT_SWING_ANGLE_DEG,
): 'left' | 'right' {
  if (swing === 'none' || swing === 'double') {
    return 'left'
  }

  const angleDeg = (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI
  const leftNormal = leftNormalFromTangent(tangent)
  const closedAngleDeg = swing === 'left' ? angleDeg : angleDeg + 180
  const angleOffset = clamp(swingAngleDeg, 1, 100)

  const candidate = (sign: 1 | -1): 'left' | 'right' => {
    const openAngleDeg = closedAngleDeg + sign * angleOffset
    const openRad = (openAngleDeg * Math.PI) / 180
    const vx = Math.cos(openRad)
    const vy = Math.sin(openRad)
    const d = vx * leftNormal.x + vy * leftNormal.y
    return d >= 0 ? 'left' : 'right'
  }

  if (!interiorSide) {
    const fallbackDirection: 'in' | 'out' =
      swing === 'left' ? (direction === 'in' ? 'out' : 'in') : direction
    return candidate(fallbackDirection === 'in' ? 1 : -1)
  }

  const desiredSide =
    direction === 'in'
      ? interiorSide
      : interiorSide === 'left'
        ? 'right'
        : 'left'

  return candidate(candidate(1) === desiredSide ? 1 : -1)
}

export interface ResolveDoorPlacementOrientationInput {
  /** Hinge side from parallel wall drag; null uses default right hinge. */
  hingeSwing: 'left' | 'right' | null
  center: Point2
  tangent: Point2
  pointer: Point2
  walls: Wall[]
  wall: Wall
  masterWallThickness: number
  pxPerMeter: number
  deadzonePx: number
  /** When false, always resolve open side from pointer (active drag). */
  useOpenSideDeadzone?: boolean
  /** Last resolved open side, used inside the wall deadzone. */
  lastOpenSide?: 'left' | 'right' | null
}

function resolveInteriorSide(
  center: Point2,
  tangent: Point2,
  walls: Wall[],
  wall: Wall,
  masterWallThickness: number,
  pxPerMeter: number,
): 'left' | 'right' | null {
  const roomPolygons = getRoomPolygonsFromWalls(walls)
  const thickness = resolveWallThicknessPx(wall, masterWallThickness, pxPerMeter)
  return detectInteriorSide(center, tangent, roomPolygons, thickness)
}

/** Pick in/out so a fixed hinge opens toward the target wall-normal side. */
export function resolveDoorDirectionForHinge(
  swing: 'left' | 'right',
  tangent: Point2,
  targetOpenSide: 'left' | 'right',
  interiorSide: 'left' | 'right' | null,
): 'in' | 'out' {
  const matches: Array<{ direction: 'in' | 'out'; score: number }> = []
  for (const direction of ['in', 'out'] as const) {
    if (computeDoorOpenNormalSide(swing, direction, tangent, interiorSide) !== targetOpenSide) {
      continue
    }
    let score = direction === 'out' ? 1 : 0
    if (interiorSide) {
      const expectedDirection = targetOpenSide === interiorSide ? 'in' : 'out'
      if (direction === expectedDirection) score += 4
    }
    matches.push({ direction, score })
  }
  if (matches.length === 0) return 'out'
  matches.sort((a, b) => b.score - a.score)
  return matches[0]!.direction
}

/**
 * Resolve door hinge (from parallel drag) and opening direction (from pointer side of wall).
 */
export function resolveDoorPlacementOrientation(
  input: ResolveDoorPlacementOrientationInput,
): { swing: 'left' | 'right'; direction: 'in' | 'out'; openSide: 'left' | 'right' } {
  const swing = input.hingeSwing ?? 'right'
  const interiorSide = resolveInteriorSide(
    input.center,
    input.tangent,
    input.walls,
    input.wall,
    input.masterWallThickness,
    input.pxPerMeter,
  )
  const detectedSide =
    input.useOpenSideDeadzone === false
      ? getWallNormalSide(input.center, input.tangent, input.pointer)
      : getWallNormalSideWithDeadzone(
          input.center,
          input.tangent,
          input.pointer,
          input.deadzonePx,
        )
  const openSide = detectedSide ?? input.lastOpenSide ?? 'right'
  const direction = resolveDoorDirectionForHinge(
    swing,
    input.tangent,
    openSide,
    interiorSide,
  )
  return { swing, direction, openSide }
}

export interface ResolveDoorSwingFromPointerInput {
  center: Point2
  tangent: Point2
  pointer: Point2
  walls: Wall[]
  wall: Wall
  masterWallThickness: number
  pxPerMeter: number
}

/**
 * Pick hinge side and in/out direction so the door opens toward the pointer.
 * Used when hinge is not fixed by parallel drag (hover preview, legacy callers).
 */
export function resolveDoorSwingFromPointer(
  input: ResolveDoorSwingFromPointerInput,
): { swing: 'left' | 'right'; direction: 'in' | 'out' } {
  const targetSide = getWallNormalSide(input.center, input.tangent, input.pointer)
  const interiorSide = resolveInteriorSide(
    input.center,
    input.tangent,
    input.walls,
    input.wall,
    input.masterWallThickness,
    input.pxPerMeter,
  )

  const matches: Array<{ swing: 'left' | 'right'; direction: 'in' | 'out'; score: number }> = []

  for (const swing of ['left', 'right'] as const) {
    for (const direction of ['in', 'out'] as const) {
      const openSide = computeDoorOpenNormalSide(swing, direction, input.tangent, interiorSide)
      if (openSide !== targetSide) continue

      let score = 0
      if (swing === 'right') score += 1
      if (direction === 'out') score += 1
      if (interiorSide) {
        const expectedDirection = targetSide === interiorSide ? 'in' : 'out'
        if (direction === expectedDirection) score += 4
      }
      matches.push({ swing, direction, score })
    }
  }

  if (matches.length === 0) {
    return { swing: 'right', direction: 'out' }
  }

  matches.sort((a, b) => b.score - a.score)
  return { swing: matches[0]!.swing, direction: matches[0]!.direction }
}
