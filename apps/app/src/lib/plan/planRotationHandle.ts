import type { Point2 } from '@/types/schema'

export function getPlanHandleSize(zoom: number): number {
  return Math.max(11 / zoom, 8)
}

export function getPlanHandleStrokeWidth(zoom: number): number {
  return Math.max(2 / zoom, 1.5)
}

export const PLAN_ROTATION_HANDLE_FILL = '#ffffff'
export const PLAN_ROTATION_HANDLE_STROKE = '#0284c7'

export function getPlanRotationHandleDistance(
  anchorRadius: number,
  zoom: number,
): number {
  const handleOffset = 16 / zoom
  const handleSize = getPlanHandleSize(zoom)
  return anchorRadius + handleOffset + handleSize * 4.6
}

export function snapPlanRotationAngle(
  angleDeg: number,
  event: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
): number {
  const step = event.ctrlKey || event.metaKey ? 90 : event.shiftKey ? 45 : 0
  if (!step) return angleDeg
  return Math.round(angleDeg / step) * step
}

export function rotationDegFromPlanPointer(pointer: Point2, center: Point2): number {
  return (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90
}

export function getRotationHandlePosition(
  center: Point2,
  rotationDeg: number,
  handleDistance: number,
): Point2 {
  const angleRad = ((rotationDeg - 90) * Math.PI) / 180
  return {
    x: center.x + Math.cos(angleRad) * handleDistance,
    y: center.y + Math.sin(angleRad) * handleDistance,
  }
}

export function normalizePlanRotationDeg(rotationDeg: number): number {
  let normalized = rotationDeg % 360
  if (normalized < 0) normalized += 360
  return normalized
}
