import { screenPxToCanvasUnits } from '@/constants/canvasConstants'
import { normalizeDimensionRotationDeg } from '@/lib/plan/dimensionDragGesture'
import type { Door, Point2 } from '@/types/schema'

type OpeningWidthEditorOpening = {
  center: Point2
  tangent: Point2
  doorDirection: Door['direction'] | null
  doorSwing: Door['swing'] | null
  kind: 'door' | 'window'
}

export function getOpeningWidthEditorGeometry(
  opening: OpeningWidthEditorOpening,
  zoom: number
): { anchor: Point2; outwardNormal: Point2; rotationDeg: number } {
  const { center, tangent } = opening
  const offsetDistance = screenPxToCanvasUnits(zoom, 24, 14, 44)
  const normal = { x: -tangent.y, y: tangent.x }
  const anchorOffset = getOpeningWidthEditorAnchorOffset(opening, normal, tangent, offsetDistance)
  const anchor: Point2 = {
    x: center.x + anchorOffset.x,
    y: center.y + anchorOffset.y,
  }
  const anchorLength = Math.hypot(anchorOffset.x, anchorOffset.y)

  return {
    anchor,
    outwardNormal:
      anchorLength > 1e-8
        ? { x: anchorOffset.x / anchorLength, y: anchorOffset.y / anchorLength }
        : normal,
    rotationDeg: normalizeDimensionRotationDeg(
      (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI
    ),
  }
}

function getOpeningWidthEditorAnchorOffset(
  opening: OpeningWidthEditorOpening,
  normal: Point2,
  tangent: Point2,
  offsetDistance: number
): Point2 {
  if (opening.kind === 'door') {
    const swing = opening.doorSwing ?? 'right'
    const baseDirection = opening.doorDirection ?? 'in'
    const effectiveDirection =
      swing === 'left' ? (baseDirection === 'in' ? 'out' : 'in') : baseDirection
    const sideSign = effectiveDirection === 'in' ? -1 : 1
    return {
      x: normal.x * offsetDistance * sideSign,
      y: normal.y * offsetDistance * sideSign,
    }
  }

  const isMostlyHorizontal = Math.abs(tangent.x) >= Math.abs(tangent.y)
  return isMostlyHorizontal
    ? { x: 0, y: tangent.x >= 0 ? -offsetDistance : offsetDistance }
    : { x: tangent.y >= 0 ? offsetDistance : -offsetDistance, y: 0 }
}
