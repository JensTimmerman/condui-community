import type { Point2 } from '@/types/schema'

const RECTANGLE_EPSILON = 1e-4
const RECTANGLE_ANGLE_EPSILON = 1e-4
const MIN_RECTANGLE_SIDE_PX = 1e-3
const PARALLEL_DIMENSION_DRAG_SENSITIVITY = 0.5

export interface WallRectangleGeometry {
  center: Point2
  width: number
  height: number
  widthAxis: Point2
  heightAxis: Point2
}

export interface WallRectangleResize {
  points: Point2[]
  movedPointIndices: number[]
}

function subtract(a: Point2, b: Point2): Point2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

function length(vector: Point2): number {
  return Math.hypot(vector.x, vector.y)
}

function dot(a: Point2, b: Point2): number {
  return a.x * b.x + a.y * b.y
}

function scale(vector: Point2, amount: number): Point2 {
  return { x: vector.x * amount, y: vector.y * amount }
}

function add(...vectors: Point2[]): Point2 {
  return vectors.reduce(
    (result, vector) => ({ x: result.x + vector.x, y: result.y + vector.y }),
    { x: 0, y: 0 }
  )
}

function pointsMatch(a: Point2, b: Point2, epsilon = RECTANGLE_EPSILON): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= epsilon
}

function buildRectanglePoints(geometry: WallRectangleGeometry): Point2[] {
  const halfWidth = scale(geometry.widthAxis, geometry.width / 2)
  const halfHeight = scale(geometry.heightAxis, geometry.height / 2)
  const p0 = add(geometry.center, scale(halfWidth, -1), scale(halfHeight, -1))
  const p1 = add(geometry.center, halfWidth, scale(halfHeight, -1))
  const p2 = add(geometry.center, halfWidth, halfHeight)
  const p3 = add(geometry.center, scale(halfWidth, -1), halfHeight)
  return [p0, p1, p2, p3, { ...p0 }]
}

/** Resolve a closed four-sided rectangle at any rotation from its current wall geometry. */
export function getWallRectangleGeometry(
  points: readonly Point2[]
): WallRectangleGeometry | null {
  if (points.length !== 5) return null
  const p0 = points[0]
  const p1 = points[1]
  const p2 = points[2]
  const p3 = points[3]
  const closing = points[4]
  if (!p0 || !p1 || !p2 || !p3 || !closing || !pointsMatch(p0, closing)) return null

  const widthVector = subtract(p1, p0)
  const heightVector = subtract(p3, p0)
  const width = length(widthVector)
  const height = length(heightVector)
  if (width <= MIN_RECTANGLE_SIDE_PX || height <= MIN_RECTANGLE_SIDE_PX) return null

  const widthAxis = scale(widthVector, 1 / width)
  const heightAxis = scale(heightVector, 1 / height)
  if (Math.abs(dot(widthAxis, heightAxis)) > RECTANGLE_ANGLE_EPSILON) return null

  const expectedP2 = add(p0, widthVector, heightVector)
  const geometryTolerance = Math.max(RECTANGLE_EPSILON, Math.max(width, height) * 1e-6)
  if (!pointsMatch(p2, expectedP2, geometryTolerance)) return null

  return {
    center: scale(add(p0, p2), 0.5),
    width,
    height,
    widthAxis,
    heightAxis,
  }
}

export function isWallRectangle(points: readonly Point2[]): boolean {
  return getWallRectangleGeometry(points) != null
}

/** Resize one measured dimension around the rectangle center while preserving rotation. */
export function resizeWallRectangleSegment(
  points: readonly Point2[],
  segmentIndex: number,
  targetLengthPx: number
): WallRectangleResize | null {
  const geometry = getWallRectangleGeometry(points)
  if (
    !geometry ||
    segmentIndex < 0 ||
    segmentIndex > 3 ||
    !Number.isFinite(targetLengthPx) ||
    targetLengthPx <= MIN_RECTANGLE_SIDE_PX
  ) {
    return null
  }

  const nextGeometry = {
    ...geometry,
    width: segmentIndex % 2 === 0 ? targetLengthPx : geometry.width,
    height: segmentIndex % 2 === 1 ? targetLengthPx : geometry.height,
  }
  return {
    points: buildRectanglePoints(nextGeometry),
    movedPointIndices: [0, 1, 2, 3, 4],
  }
}

/**
 * Dimension-box drag gesture in rectangle-local axes.
 * Parallel motion keeps the endpoint selected by the initial direction active:
 * it grows outward, returns to the original length at zero, then shrinks after
 * crossing zero. Outward normal motion resizes only the measured edge length,
 * symmetrically around the rectangle center.
 */
export function dragWallRectangleDimension(
  points: readonly Point2[],
  segmentIndex: number,
  pointerDelta: Point2,
  sensitivity = 1,
  lengthSnapStep = 0,
  minimumLength = MIN_RECTANGLE_SIDE_PX,
  parallelDragDirection?: -1 | 1
): WallRectangleResize | null {
  const geometry = getWallRectangleGeometry(points)
  if (!geometry || segmentIndex < 0 || segmentIndex > 3) return null

  const safeSensitivity = Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : 1
  const segmentStart = points[segmentIndex]!
  const segmentEnd = points[segmentIndex + 1]!
  const segmentVector = subtract(segmentEnd, segmentStart)
  const segmentLength = length(segmentVector)
  if (segmentLength <= MIN_RECTANGLE_SIDE_PX) return null
  const tangent = scale(segmentVector, 1 / segmentLength)
  const midpoint = scale(add(segmentStart, segmentEnd), 0.5)
  const outwardVector = subtract(midpoint, geometry.center)
  const outwardLength = length(outwardVector)
  if (outwardLength <= MIN_RECTANGLE_SIDE_PX) return null
  const outwardNormal = scale(outwardVector, 1 / outwardLength)

  const parallelDelta =
    dot(pointerDelta, tangent) * safeSensitivity * PARALLEL_DIMENSION_DRAG_SENSITIVITY
  const outwardDelta = dot(pointerDelta, outwardNormal) * safeSensitivity
  const parallelMode = Math.abs(parallelDelta) > Math.abs(outwardDelta)
  const currentDimension = segmentIndex % 2 === 0 ? geometry.width : geometry.height
  const effectiveParallelDirection = parallelDragDirection ?? (parallelDelta < 0 ? -1 : 1)
  const rawDimension = parallelMode
    ? currentDimension + parallelDelta * effectiveParallelDirection * 2
    : currentDimension + outwardDelta * 2
  const effectiveMinimum = Number.isFinite(lengthSnapStep) && lengthSnapStep > 0
    ? Math.ceil(Math.max(MIN_RECTANGLE_SIDE_PX, minimumLength) / lengthSnapStep) * lengthSnapStep
    : Math.max(MIN_RECTANGLE_SIDE_PX, minimumLength)
  const snappedDimension = Math.max(
    effectiveMinimum,
    Number.isFinite(lengthSnapStep) && lengthSnapStep > 0
      ? Math.round(rawDimension / lengthSnapStep) * lengthSnapStep
      : rawDimension
  )
  const effectiveParallelDelta = parallelMode
    ? effectiveParallelDirection * (snappedDimension - currentDimension) / 2
    : 0
  let width = geometry.width
  let height = geometry.height
  if (segmentIndex % 2 === 0) {
    width = snappedDimension
  } else {
    height = snappedDimension
  }
  const center = add(geometry.center, scale(tangent, effectiveParallelDelta))

  return {
    points: buildRectanglePoints({ ...geometry, center, width, height }),
    movedPointIndices: [0, 1, 2, 3, 4],
  }
}
