import type { Point } from '@/types/ui'

/** CSS positioning for a touch drag ghost whose visual center follows the finger. */
export function getCenteredTouchDragPreviewStyle(point: Point): {
  left: number
  top: number
  transform: string
} {
  return {
    left: point.x,
    top: point.y,
    transform: 'translate(-50%, -50%)',
  }
}
