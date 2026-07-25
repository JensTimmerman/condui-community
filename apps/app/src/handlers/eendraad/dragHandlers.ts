import type { Point } from '@/types/ui'

/**
 * Handle element drag - update layout override position
 */
export function createElementDragHandler(
  setEendraadLayoutOverride: (key: string, position: Point) => void
) {
  return (elementId: string, elementType: string, newPos: Point) => {
    const key = `${elementType}-${elementId}`
    setEendraadLayoutOverride(key, newPos)
  }
}
