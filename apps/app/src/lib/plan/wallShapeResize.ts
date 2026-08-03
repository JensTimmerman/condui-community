import type { Point2 } from '@/types/schema'
import {
  dragWallRectangleDimension,
  isWallRectangle,
  resizeWallRectangleSegment,
  type WallRectangleResize,
} from './wallRectangle'

const MIN_SEGMENT_LENGTH = 1e-3
const CLOSED_EPSILON = 1e-4
const PARALLEL_DRAG_SENSITIVITY = 0.5
const OPPOSITE_PARALLEL_LENGTH_WEIGHT = 0.05
const OTHER_PARALLEL_LENGTH_WEIGHT = 40
const PERPENDICULAR_LENGTH_WEIGHT = 300
const DIRECTION_WEIGHT = 30
const POSITION_WEIGHT = 0.05
const SOLVER_RIDGE = 1e-8

function add(a: Point2, b: Point2): Point2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

function subtract(a: Point2, b: Point2): Point2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

function scale(vector: Point2, amount: number): Point2 {
  return { x: vector.x * amount, y: vector.y * amount }
}

function dot(a: Point2, b: Point2): number {
  return a.x * b.x + a.y * b.y
}

function length(vector: Point2): number {
  return Math.hypot(vector.x, vector.y)
}

function normalize(vector: Point2): Point2 | null {
  const vectorLength = length(vector)
  return vectorLength > MIN_SEGMENT_LENGTH ? scale(vector, 1 / vectorLength) : null
}

function snapLength(value: number, step: number, minimumLength = MIN_SEGMENT_LENGTH): number {
  const minimum = Math.max(MIN_SEGMENT_LENGTH, minimumLength)
  if (!Number.isFinite(step) || step <= 0) return Math.max(minimum, value)
  const snappedMinimum = Math.ceil(minimum / step) * step
  return Math.max(snappedMinimum, Math.round(value / step) * step)
}

function isClosed(points: readonly Point2[]): boolean {
  const first = points[0]
  const last = points[points.length - 1]
  return !!first && !!last && length(subtract(first, last)) <= CLOSED_EPSILON
}

function wallCentroid(points: readonly Point2[]): Point2 {
  const uniqueCount = isClosed(points) ? points.length - 1 : points.length
  let x = 0
  let y = 0
  for (let index = 0; index < uniqueCount; index++) {
    x += points[index]!.x
    y += points[index]!.y
  }
  return { x: x / Math.max(1, uniqueCount), y: y / Math.max(1, uniqueCount) }
}

interface SegmentTopology {
  startIndex: number
  endIndex: number
  uniqueCount: number
  segmentCount: number
  closed: boolean
}

function getSegmentTopology(
  points: readonly Point2[],
  segmentIndex: number
): SegmentTopology | null {
  const closed = isClosed(points)
  const uniqueCount = closed ? points.length - 1 : points.length
  const segmentCount = closed ? uniqueCount : uniqueCount - 1
  if (uniqueCount < 2 || segmentIndex < 0 || segmentIndex >= segmentCount) return null
  return {
    startIndex: segmentIndex,
    endIndex: closed ? (segmentIndex + 1) % uniqueCount : segmentIndex + 1,
    uniqueCount,
    segmentCount,
    closed,
  }
}

function findOppositeParallelSegment(
  points: readonly Point2[],
  topology: SegmentTopology,
  selectedTangent: Point2
): number | null {
  const selectedStart = points[topology.startIndex]!
  const selectedEnd = points[topology.endIndex]!
  const selectedMidpoint = scale(add(selectedStart, selectedEnd), 0.5)
  const selectedLength = length(subtract(selectedEnd, selectedStart))
  const centroidDirection = subtract(wallCentroid(points), selectedMidpoint)
  const leftNormal = { x: -selectedTangent.y, y: selectedTangent.x }
  const inwardNormal = dot(centroidDirection, leftNormal) >= 0
    ? leftNormal
    : scale(leftNormal, -1)

  let bestSegment: number | null = null
  let bestScore = 0
  for (let segment = 0; segment < topology.segmentCount; segment++) {
    if (segment === topology.startIndex) continue
    const startIndex = segment
    const endIndex = topology.closed ? (segment + 1) % topology.uniqueCount : segment + 1
    const start = points[startIndex]!
    const end = points[endIndex]!
    const edge = subtract(end, start)
    const edgeLength = length(edge)
    const tangent = normalize(edge)
    if (!tangent || edgeLength <= MIN_SEGMENT_LENGTH) continue
    const parallelness = Math.abs(dot(tangent, selectedTangent))
    if (parallelness < 0.9) continue

    const midpoint = scale(add(start, end), 0.5)
    const inwardDistance = dot(subtract(midpoint, selectedMidpoint), inwardNormal)
    if (inwardDistance <= CLOSED_EPSILON) continue
    const startProjection = dot(subtract(start, selectedMidpoint), selectedTangent)
    const endProjection = dot(subtract(end, selectedMidpoint), selectedTangent)
    const low = Math.min(startProjection, endProjection)
    const high = Math.max(startProjection, endProjection)
    const overlap = Math.max(0, Math.min(selectedLength / 2, high) - Math.max(-selectedLength / 2, low))
    const overlapRatio = overlap / Math.max(MIN_SEGMENT_LENGTH, Math.min(selectedLength, edgeLength))
    const score = inwardDistance * (0.2 + overlapRatio * 0.8) * parallelness ** 4
    if (score > bestScore) {
      bestScore = score
      bestSegment = segment
    }
  }
  return bestSegment
}

function orientation(a: Point2, b: Point2, c: Point2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function pointOnSegment(point: Point2, start: Point2, end: Point2): boolean {
  return (
    point.x >= Math.min(start.x, end.x) - CLOSED_EPSILON &&
    point.x <= Math.max(start.x, end.x) + CLOSED_EPSILON &&
    point.y >= Math.min(start.y, end.y) - CLOSED_EPSILON &&
    point.y <= Math.max(start.y, end.y) + CLOSED_EPSILON
  )
}

function segmentsIntersect(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const first = orientation(a, b, c)
  const second = orientation(a, b, d)
  const third = orientation(c, d, a)
  const fourth = orientation(c, d, b)
  if (
    ((first > CLOSED_EPSILON && second < -CLOSED_EPSILON) ||
      (first < -CLOSED_EPSILON && second > CLOSED_EPSILON)) &&
    ((third > CLOSED_EPSILON && fourth < -CLOSED_EPSILON) ||
      (third < -CLOSED_EPSILON && fourth > CLOSED_EPSILON))
  ) {
    return true
  }
  return (
    (Math.abs(first) <= CLOSED_EPSILON && pointOnSegment(c, a, b)) ||
    (Math.abs(second) <= CLOSED_EPSILON && pointOnSegment(d, a, b)) ||
    (Math.abs(third) <= CLOSED_EPSILON && pointOnSegment(a, c, d)) ||
    (Math.abs(fourth) <= CLOSED_EPSILON && pointOnSegment(b, c, d))
  )
}

function intersectionPairs(points: readonly Point2[], topology: SegmentTopology): Set<string> {
  const pairs = new Set<string>()
  for (let first = 0; first < topology.segmentCount; first++) {
    const firstEnd = topology.closed ? (first + 1) % topology.uniqueCount : first + 1
    for (let second = first + 1; second < topology.segmentCount; second++) {
      const secondEnd = topology.closed ? (second + 1) % topology.uniqueCount : second + 1
      if (first === second || firstEnd === second || secondEnd === first) continue
      if (
        segmentsIntersect(
          points[first]!,
          points[firstEnd]!,
          points[second]!,
          points[secondEnd]!
        )
      ) {
        pairs.add(`${first}:${second}`)
      }
    }
  }
  return pairs
}

function deformationIsValid(
  original: readonly Point2[],
  candidate: readonly Point2[],
  topology: SegmentTopology,
  originalIntersections: Set<string>
): boolean {
  for (let segment = 0; segment < topology.segmentCount; segment++) {
    const endIndex = topology.closed ? (segment + 1) % topology.uniqueCount : segment + 1
    const originalEdge = subtract(original[endIndex]!, original[segment]!)
    const candidateEdge = subtract(candidate[endIndex]!, candidate[segment]!)
    if (length(candidateEdge) <= MIN_SEGMENT_LENGTH) return false
    if (segment !== topology.startIndex && dot(originalEdge, candidateEdge) <= 0) return false
  }
  for (const pair of intersectionPairs(candidate, topology)) {
    if (!originalIntersections.has(pair)) return false
  }
  return true
}

function clampDeformation(
  original: readonly Point2[],
  candidate: Point2[],
  topology: SegmentTopology,
  lengthSnapStep: number
): Point2[] {
  const originalIntersections = intersectionPairs(original, topology)
  if (deformationIsValid(original, candidate, topology, originalIntersections)) return candidate

  const interpolate = (amount: number) =>
    original.map((point, index) => ({
      x: point.x + (candidate[index]!.x - point.x) * amount,
      y: point.y + (candidate[index]!.y - point.y) * amount,
    }))
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 30; iteration++) {
    const middle = (low + high) / 2
    if (deformationIsValid(original, interpolate(middle), topology, originalIntersections)) {
      low = middle
    } else {
      high = middle
    }
  }

  if (Number.isFinite(lengthSnapStep) && lengthSnapStep > 0) {
    const originalLength = length(
      subtract(original[topology.endIndex]!, original[topology.startIndex]!)
    )
    const targetLength = length(
      subtract(candidate[topology.endIndex]!, candidate[topology.startIndex]!)
    )
    const limitedLength = originalLength + (targetLength - originalLength) * low
    const snappedLength = targetLength >= originalLength
      ? Math.floor(limitedLength / lengthSnapStep) * lengthSnapStep
      : Math.ceil(limitedLength / lengthSnapStep) * lengthSnapStep
    const snappedAmount = (snappedLength - originalLength) / (targetLength - originalLength)
    if (Number.isFinite(snappedAmount) && snappedAmount >= 0 && snappedAmount <= low) {
      low = snappedAmount
    }
  }
  const clamped = interpolate(low)
  if (topology.closed) clamped[clamped.length - 1] = { ...clamped[0]! }
  return clamped
}

interface LinearTerm {
  variable: number
  coefficient: number
}

interface CoordinateTerm {
  coordinate: number
  coefficient: number
}

interface ResidualRow {
  terms: LinearTerm[]
  target: number
  weight: number
}

function solveDeformationSystem(variableCount: number, residuals: ResidualRow[]): number[] {
  const rightHandSide = Array.from({ length: variableCount }, () => 0)
  for (const residual of residuals) {
    for (const term of residual.terms) {
      rightHandSide[term.variable]! += residual.weight * term.coefficient * residual.target
    }
  }

  const multiply = (vector: number[]): number[] => {
    const result = vector.map((value) => value * SOLVER_RIDGE)
    for (const residual of residuals) {
      let projection = 0
      for (const term of residual.terms) projection += term.coefficient * vector[term.variable]!
      for (const term of residual.terms) {
        result[term.variable]! += residual.weight * term.coefficient * projection
      }
    }
    return result
  }
  const vectorDot = (left: number[], right: number[]) =>
    left.reduce((sum, value, index) => sum + value * right[index]!, 0)

  const solution = Array.from({ length: variableCount }, () => 0)
  const residualVector = [...rightHandSide]
  const direction = [...residualVector]
  let residualSquared = vectorDot(residualVector, residualVector)
  const toleranceSquared = Math.max(1e-18, residualSquared * 1e-18)
  const maxIterations = Math.min(300, Math.max(40, variableCount * 4))
  for (let iteration = 0; iteration < maxIterations && residualSquared > toleranceSquared; iteration++) {
    const multipliedDirection = multiply(direction)
    const denominator = vectorDot(direction, multipliedDirection)
    if (Math.abs(denominator) < 1e-20) break
    const amount = residualSquared / denominator
    for (let index = 0; index < variableCount; index++) {
      solution[index]! += amount * direction[index]!
      residualVector[index]! -= amount * multipliedDirection[index]!
    }
    const nextResidualSquared = vectorDot(residualVector, residualVector)
    if (nextResidualSquared <= toleranceSquared) break
    const ratio = nextResidualSquared / residualSquared
    for (let index = 0; index < variableCount; index++) {
      direction[index] = residualVector[index]! + ratio * direction[index]!
    }
    residualSquared = nextResidualSquared
  }
  return solution
}

/**
 * Deform the complete path around a hard, axis-locked segment edit.
 *
 * For every other segment, relative displacement along its tangent changes
 * length while relative displacement along its normal changes direction. The
 * length penalty rises steeply as an edge becomes perpendicular to the edited
 * segment, so parallel edges absorb extension before cross edges do.
 */
function deformShapeAroundSegment(
  points: readonly Point2[],
  topology: SegmentTopology,
  desiredStart: Point2,
  desiredEnd: Point2,
  selectedTangent: Point2,
  lengthSnapStep = 0
): WallRectangleResize {
  const fixedDisplacements = new Map<number, Point2>([
    [topology.startIndex, subtract(desiredStart, points[topology.startIndex]!)],
    [topology.endIndex, subtract(desiredEnd, points[topology.endIndex]!)],
  ])
  const freeCoordinates = new Map<number, number>()
  let variableCount = 0
  for (let vertex = 0; vertex < topology.uniqueCount; vertex++) {
    if (fixedDisplacements.has(vertex)) continue
    freeCoordinates.set(vertex * 2, variableCount++)
    freeCoordinates.set(vertex * 2 + 1, variableCount++)
  }

  if (variableCount === 0) {
    const direct = points.map((point) => ({ ...point }))
    direct[topology.startIndex] = desiredStart
    direct[topology.endIndex] = desiredEnd
    if (topology.closed) direct[direct.length - 1] = { ...direct[0]! }
    return {
      points: direct,
      movedPointIndices: direct
        .map((point, index) => ({ point, index }))
        .filter(({ point, index }) => length(subtract(point, points[index]!)) > CLOSED_EPSILON)
        .map(({ index }) => index),
    }
  }

  const residuals: ResidualRow[] = []
  const oppositeParallelSegment = findOppositeParallelSegment(points, topology, selectedTangent)

  const addResidual = (terms: CoordinateTerm[], weight: number) => {
    const freeTerms: LinearTerm[] = []
    let fixedValue = 0
    for (const term of terms) {
      const vertex = Math.floor(term.coordinate / 2)
      const axis = term.coordinate % 2
      const fixed = fixedDisplacements.get(vertex)
      if (fixed) {
        fixedValue += term.coefficient * (axis === 0 ? fixed.x : fixed.y)
      } else {
        const variable = freeCoordinates.get(term.coordinate)
        if (variable != null) freeTerms.push({ variable, coefficient: term.coefficient })
      }
    }
    if (freeTerms.length > 0) residuals.push({ terms: freeTerms, target: -fixedValue, weight })
  }

  for (let segment = 0; segment < topology.segmentCount; segment++) {
    if (segment === topology.startIndex) continue
    const startIndex = segment
    const endIndex = topology.closed ? (segment + 1) % topology.uniqueCount : segment + 1
    const edge = subtract(points[endIndex]!, points[startIndex]!)
    const tangent = normalize(edge)
    if (!tangent) continue
    const normal = { x: -tangent.y, y: tangent.x }
    const parallelness = Math.abs(dot(tangent, selectedTangent))
    const lengthWeight = segment === oppositeParallelSegment
      ? OPPOSITE_PARALLEL_LENGTH_WEIGHT
      : OTHER_PARALLEL_LENGTH_WEIGHT +
        (PERPENDICULAR_LENGTH_WEIGHT - OTHER_PARALLEL_LENGTH_WEIGHT) *
          (1 - parallelness) ** 4
    const relativeDisplacement = (axis: Point2): CoordinateTerm[] => [
      { coordinate: endIndex * 2, coefficient: axis.x },
      { coordinate: endIndex * 2 + 1, coefficient: axis.y },
      { coordinate: startIndex * 2, coefficient: -axis.x },
      { coordinate: startIndex * 2 + 1, coefficient: -axis.y },
    ]
    addResidual(relativeDisplacement(tangent), lengthWeight)
    addResidual(relativeDisplacement(normal), DIRECTION_WEIGHT)
  }

  for (const [coordinate] of freeCoordinates) {
    addResidual([{ coordinate, coefficient: 1 }], POSITION_WEIGHT)
  }
  const solution = solveDeformationSystem(variableCount, residuals)
  const resized = points.map((point) => ({ ...point }))
  for (let vertex = 0; vertex < topology.uniqueCount; vertex++) {
    const fixed = fixedDisplacements.get(vertex)
    const xVariable = freeCoordinates.get(vertex * 2)
    const yVariable = freeCoordinates.get(vertex * 2 + 1)
    const displacement = fixed ?? {
      x: solution[xVariable!] ?? 0,
      y: solution[yVariable!] ?? 0,
    }
    resized[vertex] = add(points[vertex]!, displacement)
  }
  // Reassert the hard constraint after the numerical solve.
  resized[topology.startIndex] = desiredStart
  resized[topology.endIndex] = desiredEnd
  if (topology.closed) {
    resized[resized.length - 1] = { ...resized[0]! }
  }
  const clamped = clampDeformation(points, resized, topology, lengthSnapStep)
  const clampedMoved = clamped
    .map((point, index) => ({ point, index }))
    .filter(({ point, index }) => length(subtract(point, points[index]!)) > CLOSED_EPSILON)
    .map(({ index }) => index)
  return { points: clamped, movedPointIndices: clampedMoved }
}

/** Resize any wall segment without allowing the edited segment axis to rotate. */
export function resizeWallShapeSegment(
  points: readonly Point2[],
  segmentIndex: number,
  targetLength: number,
  lengthSnapStep = 0
): WallRectangleResize | null {
  if (isWallRectangle(points)) return resizeWallRectangleSegment(points, segmentIndex, targetLength)
  const topology = getSegmentTopology(points, segmentIndex)
  if (!topology || !Number.isFinite(targetLength) || targetLength <= MIN_SEGMENT_LENGTH) return null
  const start = points[topology.startIndex]!
  const end = points[topology.endIndex]!
  const tangent = normalize(subtract(end, start))
  if (!tangent) return null
  const midpoint = scale(add(start, end), 0.5)
  const halfTarget = scale(tangent, targetLength / 2)
  return deformShapeAroundSegment(
    points,
    topology,
    subtract(midpoint, halfTarget),
    add(midpoint, halfTarget),
    tangent,
    lengthSnapStep
  )
}

/** Drag any wall dimension using the exact rectangle path or weighted shape deformation. */
export function dragWallShapeDimension(
  points: readonly Point2[],
  segmentIndex: number,
  pointerDelta: Point2,
  lengthSnapStep = 0,
  minimumLength = MIN_SEGMENT_LENGTH,
  parallelDragDirection?: -1 | 1
): WallRectangleResize | null {
  if (isWallRectangle(points)) {
    return dragWallRectangleDimension(
      points,
      segmentIndex,
      pointerDelta,
      1,
      lengthSnapStep,
      minimumLength,
      parallelDragDirection
    )
  }
  const topology = getSegmentTopology(points, segmentIndex)
  if (!topology) return null
  const start = points[topology.startIndex]!
  const end = points[topology.endIndex]!
  const segmentVector = subtract(end, start)
  const segmentLength = length(segmentVector)
  const tangent = normalize(segmentVector)
  if (!tangent) return null

  const midpoint = scale(add(start, end), 0.5)
  const centroid = wallCentroid(points)
  const leftNormal = { x: -tangent.y, y: tangent.x }
  const normal = dot(subtract(centroid, midpoint), leftNormal) > 0
    ? scale(leftNormal, -1)
    : leftNormal
  const parallelDelta = dot(pointerDelta, tangent) * PARALLEL_DRAG_SENSITIVITY
  const outwardDelta = dot(pointerDelta, normal)
  const parallelMode = Math.abs(parallelDelta) > Math.abs(outwardDelta)

  let desiredStart: Point2
  let desiredEnd: Point2
  if (parallelMode) {
    const effectiveParallelDirection = parallelDragDirection ?? (parallelDelta < 0 ? -1 : 1)
    const targetLength = snapLength(
      segmentLength + parallelDelta * effectiveParallelDirection * 2,
      lengthSnapStep,
      minimumLength
    )
    desiredStart = effectiveParallelDirection < 0
      ? add(end, scale(tangent, -targetLength))
      : start
    desiredEnd = effectiveParallelDirection > 0
      ? add(start, scale(tangent, targetLength))
      : end
  } else {
    const targetLength = snapLength(
      segmentLength + outwardDelta * 2,
      lengthSnapStep,
      minimumLength
    )
    const halfTarget = scale(tangent, targetLength / 2)
    desiredStart = subtract(midpoint, halfTarget)
    desiredEnd = add(midpoint, halfTarget)
  }
  return deformShapeAroundSegment(
    points,
    topology,
    desiredStart,
    desiredEnd,
    tangent,
    lengthSnapStep
  )
}
