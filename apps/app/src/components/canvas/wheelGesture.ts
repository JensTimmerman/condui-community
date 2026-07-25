import { clamp } from '@/lib/geometry'
export const TRACKPAD_WHEEL_PAN_MIN_ABS_DELTA_X = 2
export const TRACKPAD_WHEEL_CLASSIFY_DELAY_MS = 40
export const TRACKPAD_WHEEL_GESTURE_RESET_MS = 120

export type WheelGestureMode = 'idle' | 'pending-vertical' | 'pan' | 'zoom'

export function isLikelyMouseWheelEvent(
  deltaMode: number,
  deltaX: number,
  deltaY: number
): boolean {
  if (deltaMode !== 0) return true
  return Math.abs(deltaY) >= 50 && Math.abs(deltaX) === 0
}

export function hasMeaningfulTrackpadHorizontalPan(deltaX: number): boolean {
  return Math.abs(deltaX) > TRACKPAD_WHEEL_PAN_MIN_ABS_DELTA_X
}

export function getTrackpadWheelZoomFactor(deltaY: number): number {
  const pinchDelta = clamp(deltaY, -10, 10)
  return 1 - pinchDelta * 0.01
}
