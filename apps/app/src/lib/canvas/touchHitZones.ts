import { ZOOM_100 } from '@/constants/canvasConstants'

/** Minimum drag target on touch — roughly finger size at 100% zoom (screen px). */
export const TOUCH_DRAG_TARGET_PX = 44

/** Extra selection padding at minimum zoom (screen px, applied at edges). */
export const TOUCH_SELECTION_INFLATION_MAX_PX = 16

export type CanvasRect = { x: number; y: number; width: number; height: number }

function safeZoom(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : ZOOM_100
}

/**
 * True on tablets / phones where touch is the primary input — not Mac/Windows desktops
 * (including touch-screen laptops that report a fine pointer).
 */
export function isTouchPrimaryDevice(): boolean {
  if (typeof window === 'undefined') return false

  const ua = navigator.userAgent
  const touchPoints = navigator.maxTouchPoints ?? 0

  if (/iPad/i.test(ua)) return true
  // iPadOS 13+ often reports MacIntel with touch
  if (navigator.platform === 'MacIntel' && touchPoints > 1) return true

  const mm = typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : null
  const coarse = mm?.('(pointer: coarse)').matches ?? false
  const fine = mm?.('(pointer: fine)').matches ?? false

  if (coarse && !fine) return true

  if (touchPoints > 0 && coarse && fine) {
    const desktopUa = /Windows NT|Macintosh|X11.*Linux/i.test(ua) && !/Tablet|iPad/i.test(ua)
    if (desktopUa && window.innerWidth > 1024) return false
  }

  if (touchPoints > 0 && coarse && window.innerWidth <= 1024) return true

  return false
}

/** Selection hit inflation when zoomed out (canvas units per edge). Zero at/above 100% display zoom. */
export function getTouchSelectionPaddingCanvas(zoom: number): number {
  const z = safeZoom(zoom)
  if (z >= ZOOM_100) return 0
  const zoomRatio = z / ZOOM_100
  const t = 1 - zoomRatio
  const screenPx = t * TOUCH_SELECTION_INFLATION_MAX_PX
  return screenPx / z
}

/** Padding so the rect is at least TOUCH_DRAG_TARGET_PX wide/tall on screen (canvas units per edge). */
export function getTouchDragPaddingCanvas(rect: Pick<CanvasRect, 'width' | 'height'>, zoom: number): number {
  const z = safeZoom(zoom)
  const minCanvas = TOUCH_DRAG_TARGET_PX / z
  const padX = Math.max(0, (minCanvas - rect.width) / 2)
  const padY = Math.max(0, (minCanvas - rect.height) / 2)
  return Math.max(padX, padY)
}

/**
 * Combined touch hit padding: mild zoom-out boost for selection; finger-sized minimum when selected.
 */
export function computeTouchHitPadding(
  zoom: number,
  rect: Pick<CanvasRect, 'width' | 'height'>,
  isSelected: boolean,
): number {
  const selectionPad = getTouchSelectionPaddingCanvas(zoom)
  if (!isSelected) return selectionPad
  return Math.max(selectionPad, getTouchDragPaddingCanvas(rect, zoom))
}

export function inflateCanvasRect<T extends CanvasRect>(rect: T, padding: number): T {
  if (padding <= 0) return rect
  return {
    ...rect,
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  }
}

export function applyTouchHitPadding(
  rect: CanvasRect,
  zoom: number,
  isSelected: boolean,
  touchPrimary: boolean,
): CanvasRect {
  if (!touchPrimary) return rect
  const pad = computeTouchHitPadding(zoom, rect, isSelected)
  return inflateCanvasRect(rect, pad)
}

/** Finger-sized minimum hit radius for point handles (canvas units); keeps visual radius unchanged. */
export function getTouchPointHitRadiusCanvas(zoom: number, visualRadiusCanvas: number): number {
  const z = safeZoom(zoom)
  const minCanvas = TOUCH_DRAG_TARGET_PX / 2 / z
  return Math.max(visualRadiusCanvas, minCanvas)
}
