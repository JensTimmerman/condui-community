import type { Point2 } from '@/types/schema'
import { clamp } from '@/lib/geometry'

export interface SegmentMeasurementGuide {
  measurementId: string
  segmentIndex: number
  start: Point2
  end: Point2
  offsetStart: Point2
  offsetEnd: Point2
  midpoint: Point2
  angleRad: number
  lengthPx: number
  lengthCm: number
  label: string
  distanceInterval?: DistanceMeasurementInterval
}

interface BuildSegmentMeasurementGuidesInput {
  points: Point2[]
  segmentIndices: number[]
  pxPerMeter: number
  extensionOffset: number
}

export interface DistanceMeasurementInterval {
  startDistance: number
  endDistance: number
  /** Opening whose position can be edited through this clear-distance guide. */
  openingId?: string
  /** Which side of the opening the clear distance belongs to. */
  openingSide?: 'start' | 'end'
}

interface BuildDistanceMeasurementGuidesInput {
  points: Point2[]
  intervals: DistanceMeasurementInterval[]
  pxPerMeter: number
  extensionOffset: number
  /** Persists each label's side while its measured geometry changes during a drag. */
  normalSideByKey?: Map<string, -1 | 1>
}

function formatLengthCentimeters(lengthCm: number): string {
  const rounded = Math.round(lengthCm * 10) / 10
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) {
    return `${Math.round(rounded)} cm`
  }
  return `${rounded.toFixed(1)} cm`
}

function getWallCentroid(points: Point2[]): Point2 | null {
  if (points.length === 0) return null
  let sumX = 0
  let sumY = 0
  for (const point of points) {
    sumX += point.x
    sumY += point.y
  }
  return {
    x: sumX / points.length,
    y: sumY / points.length,
  }
}

function cumulativeLengths(points: Point2[]): number[] {
  const lengths = [0]
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const current = points[i]
    if (!prev || !current) {
      lengths.push(lengths[lengths.length - 1] ?? 0)
      continue
    }
    const dx = current.x - prev.x
    const dy = current.y - prev.y
    lengths.push((lengths[lengths.length - 1] ?? 0) + Math.sqrt(dx * dx + dy * dy))
  }
  return lengths
}

function pointAtDistance(points: Point2[], lengths: number[], distance: number): Point2 {
  const total = lengths[lengths.length - 1] ?? 0
  const clamped = clamp(total, 0, distance)
  for (let i = 0; i < points.length - 1; i++) {
    const start = lengths[i] ?? 0
    const end = lengths[i + 1] ?? 0
    if (clamped <= end + 1e-8) {
      const segLen = Math.max(1e-10, end - start)
      const t = Math.max(0, Math.min(1, (clamped - start) / segLen))
      const a = points[i]!
      const b = points[i + 1]!
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      }
    }
  }
  return points[points.length - 1]!
}

export function buildSegmentMeasurementGuides({
  points,
  segmentIndices,
  pxPerMeter,
  extensionOffset,
}: BuildSegmentMeasurementGuidesInput): SegmentMeasurementGuide[] {
  if (points.length < 2 || !Number.isFinite(pxPerMeter) || pxPerMeter <= 0) return []

  const centroid = getWallCentroid(points)
  const uniqueSegmentIndices = Array.from(new Set(segmentIndices))
  const guides: SegmentMeasurementGuide[] = []

  for (const segmentIndex of uniqueSegmentIndices) {
    const start = points[segmentIndex]
    const end = points[segmentIndex + 1]
    if (!start || !end) continue

    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthPx = Math.sqrt(dx * dx + dy * dy)
    if (lengthPx < 1e-6) continue

    const tangent = { x: dx / lengthPx, y: dy / lengthPx }
    const leftNormal = { x: -tangent.y, y: tangent.x }

    const midpoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    }

    // Keep measurement lines on the side opposite of the wall centroid.
    let normal = leftNormal
    if (centroid) {
      const toCentroid = { x: centroid.x - midpoint.x, y: centroid.y - midpoint.y }
      const dot = toCentroid.x * leftNormal.x + toCentroid.y * leftNormal.y
      if (dot > 0) {
        normal = { x: -leftNormal.x, y: -leftNormal.y }
      }
    }

    const offsetStart = {
      x: start.x + normal.x * extensionOffset,
      y: start.y + normal.y * extensionOffset,
    }
    const offsetEnd = {
      x: end.x + normal.x * extensionOffset,
      y: end.y + normal.y * extensionOffset,
    }

    const lengthCm = (lengthPx / pxPerMeter) * 100
    guides.push({
      measurementId: `segment-${segmentIndex}`,
      segmentIndex,
      start,
      end,
      offsetStart,
      offsetEnd,
      midpoint: {
        x: (offsetStart.x + offsetEnd.x) / 2,
        y: (offsetStart.y + offsetEnd.y) / 2,
      },
      angleRad: Math.atan2(dy, dx),
      lengthPx,
      lengthCm,
      label: formatLengthCentimeters(lengthCm),
    })
  }

  return guides
}

export function buildDistanceMeasurementGuides({
  points,
  intervals,
  pxPerMeter,
  extensionOffset,
  normalSideByKey,
}: BuildDistanceMeasurementGuidesInput): SegmentMeasurementGuide[] {
  if (
    points.length < 2 ||
    !Number.isFinite(pxPerMeter) ||
    pxPerMeter <= 0 ||
    intervals.length === 0
  )
    return []

  const centroid = getWallCentroid(points)
  const lengths = cumulativeLengths(points)
  const totalLength = lengths[lengths.length - 1] ?? 0
  if (totalLength < 1e-6) return []

  const guides: SegmentMeasurementGuide[] = []
  intervals.forEach((interval, index) => {
    const startDistance = clamp(totalLength, 0, interval.startDistance)
    const endDistance = clamp(totalLength, 0, interval.endDistance)
    if (endDistance - startDistance < 1e-6) return

    const start = pointAtDistance(points, lengths, startDistance)
    const end = pointAtDistance(points, lengths, endDistance)
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthPx = Math.sqrt(dx * dx + dy * dy)
    if (lengthPx < 1e-6) return

    const tangent = { x: dx / lengthPx, y: dy / lengthPx }
    const leftNormal = { x: -tangent.y, y: tangent.x }
    const midpoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    }

    let normalSide: -1 | 1 = 1
    const sideKey =
      interval.openingId && interval.openingSide
        ? `${interval.openingId}:${interval.openingSide}`
        : `distance:${index}`
    const cachedNormalSide = normalSideByKey?.get(sideKey)
    if (cachedNormalSide != null) {
      normalSide = cachedNormalSide
    } else if (centroid) {
      const toCentroid = { x: centroid.x - midpoint.x, y: centroid.y - midpoint.y }
      const dot = toCentroid.x * leftNormal.x + toCentroid.y * leftNormal.y
      if (dot > 0) {
        normalSide = -1
      }
      normalSideByKey?.set(sideKey, normalSide)
    }
    const normal = { x: leftNormal.x * normalSide, y: leftNormal.y * normalSide }

    const offsetStart = {
      x: start.x + normal.x * extensionOffset,
      y: start.y + normal.y * extensionOffset,
    }
    const offsetEnd = {
      x: end.x + normal.x * extensionOffset,
      y: end.y + normal.y * extensionOffset,
    }
    const lengthCm = (lengthPx / pxPerMeter) * 100

    guides.push({
      measurementId: `distance-${index}`,
      segmentIndex: -100000 - index,
      start,
      end,
      offsetStart,
      offsetEnd,
      midpoint: {
        x: (offsetStart.x + offsetEnd.x) / 2,
        y: (offsetStart.y + offsetEnd.y) / 2,
      },
      angleRad: Math.atan2(dy, dx),
      lengthPx,
      lengthCm,
      label: formatLengthCentimeters(lengthCm),
      distanceInterval: interval,
    })
  })

  return guides
}
