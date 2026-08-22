import {
  computeOpeningGeometry,
  getWallTotalLength,
  projectPointToWall,
  validateOpeningPlacement,
} from '@/handlers/plan/wallDrawing'
import type { Door, Point2, Wall, Window } from '@/types/schema'
import { clamp } from '@/lib/geometry'

export interface OpeningDragPlacementOptions {
  /** Snap opening width to whole centimeters (parallel drag distance and default width). */
  snapWidthToCm?: boolean
  canvasPxPerMeter?: number
  /** Optional drag distance threshold before width scaling starts. */
  dragActivationThresholdPx?: number
  /** Force drag sizing during current gesture even near the anchor. */
  forceDragSizing?: boolean
  /** Optional minimum opening width for drag-created openings. */
  minimumWidthPx?: number
}

/** Convert canvas width to whole centimeters and back to canvas units. */
export function snapOpeningWidthToWholeCentimeters(
  widthPx: number,
  canvasPxPerMeter: number,
): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return widthPx
  if (!Number.isFinite(canvasPxPerMeter) || canvasPxPerMeter <= 0) return widthPx
  const roundedCm = Math.max(1, Math.round((widthPx / canvasPxPerMeter) * 100))
  return (roundedCm / 100) * canvasPxPerMeter
}

/** @deprecated Use {@link snapOpeningWidthToWholeCentimeters}. */
export const snapDoorWidthToWholeCentimeters = snapOpeningWidthToWholeCentimeters

export function openingWidthCentimeters(widthPx: number, canvasPxPerMeter: number): number {
  if (!Number.isFinite(widthPx) || !Number.isFinite(canvasPxPerMeter) || canvasPxPerMeter <= 0) {
    return 0
  }
  return Math.max(1, Math.round((widthPx / canvasPxPerMeter) * 100))
}

/** @deprecated Use {@link openingWidthCentimeters}. */
export const doorWidthCentimeters = openingWidthCentimeters

export interface OpeningDragPlacement {
  width: number
  centerPoint: Point2
  centerPosition: number
  /** Hinge side from parallel drag along the wall; null when not drag-sizing. */
  doorSwing: 'left' | 'right' | null
  isDraggingAlongWall: boolean
}

/** Largest opening width that fits on the anchor segment, centered at position. */
export function maxSymmetricOpeningWidthAtPosition(
  points: Point2[],
  position: number,
): number {
  const geom = computeOpeningGeometry(points, position)
  if (!geom) return Infinity
  const segLen = geom.segmentEndDist - geom.segmentStartDist
  const centerAlong = geom.centerDist - geom.segmentStartDist
  if (segLen < 1e-6) return 0
  return 2 * clamp(segLen - centerAlong, 0, centerAlong)
}

/**
 * Derive opening width, center, and door hinge from drag along the wall tangent.
 * Anchor is the opening center; width grows with twice the signed along-wall offset to the pointer.
 */
export function computeOpeningDragPlacement(
  wall: Wall,
  anchor: Point2,
  current: Point2,
  defaultWidth: number,
  minDragAlongPx = 6,
  options?: OpeningDragPlacementOptions,
): OpeningDragPlacement {
  const snapToCm =
    options?.snapWidthToCm === true &&
    Number.isFinite(options.canvasPxPerMeter) &&
    (options.canvasPxPerMeter ?? 0) > 0
  const pxPerMeter = options?.canvasPxPerMeter ?? 1
  const snapWidth = (widthPx: number) =>
    snapToCm ? snapOpeningWidthToWholeCentimeters(widthPx, pxPerMeter) : widthPx
  const configuredMinWidthPx = options?.minimumWidthPx
  const fallbackMinWidthPx = snapToCm ? pxPerMeter / 100 : 10
  const minWidthPx =
    Number.isFinite(configuredMinWidthPx) && (configuredMinWidthPx ?? 0) > 0
      ? (configuredMinWidthPx as number)
      : fallbackMinWidthPx
  const configuredDragActivationThresholdPx = options?.dragActivationThresholdPx
  const dragActivationThresholdPx =
    Number.isFinite(configuredDragActivationThresholdPx) &&
    (configuredDragActivationThresholdPx ?? 0) >= 0
      ? (configuredDragActivationThresholdPx as number)
      : minDragAlongPx
  const points = wall.points
  const totalLength = getWallTotalLength(points)
  if (totalLength < 1e-10) {
    return {
      width: defaultWidth,
      centerPoint: anchor,
      centerPosition: 0,
      doorSwing: null,
      isDraggingAlongWall: false,
    }
  }

  const anchorProj = projectPointToWall(points, anchor)
  const currentProj = projectPointToWall(points, current)

  const anchorGeom = computeOpeningGeometry(points, anchorProj.t)
  const currentGeom = computeOpeningGeometry(points, currentProj.t)
  const defaultCenter = anchorGeom?.center ?? anchor
  const tangent = anchorGeom?.tangent ?? { x: 1, y: 0 }
  const anchorPoint = anchorGeom?.center ?? anchor
  const currentPoint = currentGeom?.center ?? current
  const along =
    (currentPoint.x - anchorPoint.x) * tangent.x +
    (currentPoint.y - anchorPoint.y) * tangent.y

  const maxWidth = maxSymmetricOpeningWidthAtPosition(points, anchorProj.t)
  const clampWidth = (widthPx: number) => {
    const snapped = snapWidth(widthPx)
    if (!Number.isFinite(maxWidth) || maxWidth <= 0) return snapped
    return Math.min(snapped, maxWidth)
  }

  if (!options?.forceDragSizing && Math.abs(along) <= dragActivationThresholdPx) {
    return {
      width: clampWidth(defaultWidth),
      centerPoint: defaultCenter,
      centerPosition: anchorProj.t,
      doorSwing: null,
      isDraggingAlongWall: false,
    }
  }

  const width = clampWidth(Math.max(minWidthPx, Math.abs(along) * 2))
  const doorSwing: 'left' | 'right' = along > 0 ? 'left' : 'right'

  return {
    width,
    centerPoint: defaultCenter,
    centerPosition: anchorProj.t,
    doorSwing,
    isDraggingAlongWall: true,
  }
}

/**
 * Clamp drag width to the segment maximum and shrink until placement validates.
 * Always returns geometry suitable for preview (never hide mid-drag).
 */
export function fitOpeningPlacementForPreview(
  wall: Wall,
  placement: OpeningDragPlacement,
  doors: Door[],
  windows: Window[],
): { position: number; width: number } {
  const maxWidth = maxSymmetricOpeningWidthAtPosition(wall.points, placement.centerPosition)
  let width =
    Number.isFinite(maxWidth) && maxWidth > 0
      ? Math.min(placement.width, maxWidth)
      : placement.width

  const attempt = (candidateWidth: number) =>
    validateOpeningPlacement(wall, placement.centerPoint, candidateWidth, doors, windows)

  let validation = attempt(width)
  if (validation.valid) {
    return { position: validation.position, width: validation.width }
  }

  const minWidth = 1
  while (width > minWidth) {
    width = Math.max(minWidth, width - 1)
    validation = attempt(width)
    if (validation.valid) {
      return { position: validation.position, width: validation.width }
    }
  }

  return {
    position: validation.position,
    width: Math.max(minWidth, validation.width),
  }
}
