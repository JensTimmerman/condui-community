import { createContext, useContext, useRef } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useSettingsStore } from '@/stores/settingsStore'

const CLICK_SLOP = 5

export type BeginCanvasPan = (clientX: number, clientY: number) => void

export const CanvasPanContext = createContext<BeginCanvasPan | null>(null)

/**
 * Gives an interactive child inside a draggable one-wire symbol click-versus-
 * canvas-pan behaviour. The child owns the gesture, so its parent cannot move.
 */
export function useCanvasPanOrClickGesture(
  onActivate: (event: KonvaEventObject<MouseEvent | TouchEvent>) => void
) {
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null)
  const beginPan = useContext(CanvasPanContext)
  const leftDragPansCanvas = useSettingsStore((state) => state.leftDragPansCanvas)

  const handlePointerDown = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const native = event.evt
    if ('button' in native && native.button !== 0) return
    const point =
      'clientX' in native
        ? { x: native.clientX, y: native.clientY }
        : native.touches[0]
          ? { x: native.touches[0].clientX, y: native.touches[0].clientY }
          : null
    pointerDownRef.current = point
    event.cancelBubble = true
    if (point && 'button' in native && leftDragPansCanvas) {
      beginPan?.(point.x, point.y)
    }
  }

  const handlePointerUp = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const start = pointerDownRef.current
    pointerDownRef.current = null
    event.cancelBubble = true
    if (!start) return
    const native = event.evt
    const point =
      'clientX' in native
        ? { x: native.clientX, y: native.clientY }
        : native.changedTouches[0]
          ? { x: native.changedTouches[0].clientX, y: native.changedTouches[0].clientY }
          : null
    if (!point || Math.hypot(point.x - start.x, point.y - start.y) > CLICK_SLOP) return
    onActivate(event)
  }

  return {
    onMouseDown: handlePointerDown,
    onMouseUp: handlePointerUp,
    onTouchStart: handlePointerDown,
    onTouchEnd: handlePointerUp,
  }
}
