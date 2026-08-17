import type { Point2, Wall, WallCurve } from '@/types/schema'

export const QUARTER_CIRCLE_CURVE_WEIGHT = Math.SQRT1_2
export const CURVE_RENDER_SEGMENT_PX = 2
/** Stable model-space tessellation used for offsetting and boolean wall-volume operations. */
export const CURVE_WALL_VOLUME_MAX_SEGMENT_LENGTH = 0.25

export type CurvedWallToolHoverFeedback = 'default' | 'invalid' | 'suppressed'

/**
 * Curved walls reject topology edits and openings with explicit feedback.
 * Clip hover stays quiet because red is reserved for the segment that will be removed.
 */
export function getCurvedWallToolHoverFeedback(tool: string): CurvedWallToolHoverFeedback {
  if (tool === 'clipWall') return 'suppressed'
  if (tool === 'insertPoint' || tool === 'insertDoor' || tool === 'insertWindow') {
    return 'invalid'
  }
  return 'default'
}

export function isCurvedWall(wall: Pick<Wall, 'points' | 'curve'>): boolean {
  return wall.curve?.kind === 'rationalQuadratic' && wall.points.length === 3
}

export function createQuarterCircleWallCurve(): WallCurve {
  return {
    kind: 'rationalQuadratic',
    weight: QUARTER_CIRCLE_CURVE_WEIGHT,
  }
}

export function evaluateRationalQuadratic(
  start: Point2,
  control: Point2,
  end: Point2,
  weight: number,
  t: number
): Point2 {
  const clampedT = Math.max(0, Math.min(1, t))
  const inverse = 1 - clampedT
  const startFactor = inverse * inverse
  const controlFactor = 2 * weight * inverse * clampedT
  const endFactor = clampedT * clampedT
  const denominator = startFactor + controlFactor + endFactor
  if (Math.abs(denominator) < 1e-10) return { ...start }
  return {
    x: (startFactor * start.x + controlFactor * control.x + endFactor * end.x) / denominator,
    y: (startFactor * start.y + controlFactor * control.y + endFactor * end.y) / denominator,
  }
}

/** Exact tangent of the rational-quadratic centerline at parameter t. */
export function evaluateRationalQuadraticTangent(
  start: Point2,
  control: Point2,
  end: Point2,
  weight: number,
  t: number
): Point2 {
  const clampedT = Math.max(0, Math.min(1, t))
  const inverse = 1 - clampedT
  const factors = [inverse * inverse, 2 * weight * inverse * clampedT, clampedT * clampedT]
  const derivatives = [-2 * inverse, 2 * weight * (1 - 2 * clampedT), 2 * clampedT]
  const points = [start, control, end]
  const denominator = factors[0]! + factors[1]! + factors[2]!
  const denominatorDerivative = derivatives[0]! + derivatives[1]! + derivatives[2]!
  if (Math.abs(denominator) < 1e-10) return { x: 0, y: 0 }

  let numeratorX = 0
  let numeratorY = 0
  let numeratorDerivativeX = 0
  let numeratorDerivativeY = 0
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!
    numeratorX += factors[index]! * point.x
    numeratorY += factors[index]! * point.y
    numeratorDerivativeX += derivatives[index]! * point.x
    numeratorDerivativeY += derivatives[index]! * point.y
  }

  const denominatorSquared = denominator * denominator
  return {
    x: (numeratorDerivativeX * denominator - numeratorX * denominatorDerivative) / denominatorSquared,
    y: (numeratorDerivativeY * denominator - numeratorY * denominatorDerivative) / denominatorSquared,
  }
}

export type CurvedWallClosestPoint = {
  point: Point2
  tangent: Point2
  t: number
  distance: number
}

/** Find the closest centerline point while retaining the exact curve tangent there. */
export function getClosestPointOnCurvedWall(
  wall: Pick<Wall, 'points' | 'curve'>,
  target: Point2
): CurvedWallClosestPoint | null {
  if (!isCurvedWall(wall)) return null
  const [start, control, end] = wall.points
  if (!start || !control || !end) return null
  const weight =
    Number.isFinite(wall.curve!.weight) && wall.curve!.weight > 0
      ? wall.curve!.weight
      : QUARTER_CIRCLE_CURVE_WEIGHT
  const distanceSquaredAt = (t: number) => {
    const point = evaluateRationalQuadratic(start, control, end, weight, t)
    return (point.x - target.x) ** 2 + (point.y - target.y) ** 2
  }

  // First bracket the global minimum, then refine that small interval. Rational
  // quadratic wall arcs are simple, but sampling avoids fragile Newton steps at endpoints.
  const sampleCount = 48
  let bestIndex = 0
  let bestDistanceSquared = Infinity
  for (let index = 0; index <= sampleCount; index++) {
    const distanceSquared = distanceSquaredAt(index / sampleCount)
    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared
      bestIndex = index
    }
  }

  let low = Math.max(0, (bestIndex - 1) / sampleCount)
  let high = Math.min(1, (bestIndex + 1) / sampleCount)
  const goldenRatio = (Math.sqrt(5) - 1) / 2
  for (let iteration = 0; iteration < 32; iteration++) {
    const left = high - (high - low) * goldenRatio
    const right = low + (high - low) * goldenRatio
    if (distanceSquaredAt(left) <= distanceSquaredAt(right)) high = right
    else low = left
  }

  const t = (low + high) / 2
  const point = evaluateRationalQuadratic(start, control, end, weight, t)
  return {
    point,
    tangent: evaluateRationalQuadraticTangent(start, control, end, weight, t),
    t,
    distance: Math.hypot(point.x - target.x, point.y - target.y),
  }
}

/**
 * Returns the derived centerline used by rendering, hit testing, and polygon expansion.
 * The three stored source points remain the only editable points.
 */
export function getWallPathPoints(
  wall: Pick<Wall, 'points' | 'curve'>,
  maxSegmentLength = 4
): Point2[] {
  if (!isCurvedWall(wall)) return wall.points
  const [start, control, end] = wall.points
  if (!start || !control || !end) return wall.points

  const controlPolygonLength =
    Math.hypot(control.x - start.x, control.y - start.y) +
    Math.hypot(end.x - control.x, end.y - control.y)
  const safeSegmentLength = Math.max(0.01, maxSegmentLength)
  const segmentCount = Math.max(
    8,
    Math.min(1024, Math.ceil(controlPolygonLength / safeSegmentLength))
  )
  const weight =
    Number.isFinite(wall.curve!.weight) && wall.curve!.weight > 0
      ? wall.curve!.weight
      : QUARTER_CIRCLE_CURVE_WEIGHT

  return Array.from({ length: segmentCount + 1 }, (_unused, index) =>
    evaluateRationalQuadratic(start, control, end, weight, index / segmentCount)
  )
}

/** Keeps the flattened curve's chords close to a fixed size on screen at any canvas zoom. */
export function getCurveRenderMaxSegmentLength(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return CURVE_RENDER_SEGMENT_PX / safeZoom
}

export function wallWithDerivedPath(wall: Wall, maxSegmentLength = 4): Wall {
  if (!isCurvedWall(wall)) return wall
  return { ...wall, points: getWallPathPoints(wall, maxSegmentLength) }
}
