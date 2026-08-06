import type { Point2 } from '@/types/schema'

export type DimensionDragMode = 'centered' | 'start' | 'end'

export interface DimensionDragResolution {
  mode: DimensionDragMode | null
  alongDelta: number
  normalDelta: number
}

/**
 * Latch a dimension-label drag to centered resizing (away/toward the object)
 * or to one end (along the measured axis). The latched mode stays stable when
 * the pointer returns past its origin, allowing an end resize to shrink.
 */
export function resolveDimensionDrag(
  start: Point2,
  current: Point2,
  tangent: Point2,
  outwardNormal: Point2,
  latchedMode: DimensionDragMode | null,
  activationDistance: number
): DimensionDragResolution {
  const delta = { x: current.x - start.x, y: current.y - start.y }
  const alongDelta = delta.x * tangent.x + delta.y * tangent.y
  const normalDelta = delta.x * outwardNormal.x + delta.y * outwardNormal.y
  let mode = latchedMode
  if (!mode && Math.hypot(alongDelta, normalDelta) >= activationDistance) {
    mode =
      Math.abs(normalDelta) >= Math.abs(alongDelta) ? 'centered' : alongDelta >= 0 ? 'end' : 'start'
  }
  return { mode, alongDelta, normalDelta }
}

export function resizeDimensionFromDrag(
  baseWidth: number,
  resolution: DimensionDragResolution,
  minimumWidth: number
): { width: number; centerDelta: number } {
  const mode = resolution.mode
  if (!mode) return { width: baseWidth, centerDelta: 0 }

  if (mode === 'centered') {
    return {
      width: Math.max(minimumWidth, baseWidth + resolution.normalDelta * 2),
      centerDelta: 0,
    }
  }

  const requestedWidth =
    mode === 'end' ? baseWidth + resolution.alongDelta : baseWidth - resolution.alongDelta
  const width = Math.max(minimumWidth, requestedWidth)
  return {
    width,
    centerDelta: mode === 'end' ? (width - baseWidth) / 2 : (baseWidth - width) / 2,
  }
}

export interface DimensionObstacleSpan {
  start: number
  end: number
}

/** Clamp a one-ended resize without ever moving the opposite, fixed edge. */
export function clampAnchoredDimensionResize(
  baseCenter: number,
  baseWidth: number,
  requestedWidth: number,
  mode: 'start' | 'end',
  minimumWidth: number,
  segmentStart: number,
  segmentEnd: number,
  obstacles: DimensionObstacleSpan[]
): { width: number; center: number } {
  const fixedEdge = mode === 'end' ? baseCenter - baseWidth / 2 : baseCenter + baseWidth / 2
  let availableWidth = mode === 'end' ? segmentEnd - fixedEdge : fixedEdge - segmentStart

  for (const obstacle of obstacles) {
    if (mode === 'end' && obstacle.start >= fixedEdge - 1e-6) {
      availableWidth = Math.min(availableWidth, obstacle.start - fixedEdge)
    } else if (mode === 'start' && obstacle.end <= fixedEdge + 1e-6) {
      availableWidth = Math.min(availableWidth, fixedEdge - obstacle.end)
    }
  }

  const maximumWidth = Math.max(minimumWidth, availableWidth)
  const width = Math.min(Math.max(minimumWidth, requestedWidth), maximumWidth)
  return {
    width,
    center: mode === 'end' ? fixedEdge + width / 2 : fixedEdge - width / 2,
  }
}
