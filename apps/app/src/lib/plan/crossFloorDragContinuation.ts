import type { Point } from '@/types/ui'

export type ClientPoint = { x: number; y: number }

export function captureCrossFloorDragClientOffsets(
  positions: ReadonlyMap<string, Point>,
  cursorClient: ClientPoint,
  planToClient: (point: Point) => ClientPoint,
): Map<string, ClientPoint> {
  const offsets = new Map<string, ClientPoint>()
  positions.forEach((position, placementId) => {
    const clientPosition = planToClient(position)
    offsets.set(placementId, {
      x: clientPosition.x - cursorClient.x,
      y: clientPosition.y - cursorClient.y,
    })
  })
  return offsets
}

export function resolveCrossFloorDragPositions(
  clientOffsets: ReadonlyMap<string, ClientPoint>,
  cursorClient: ClientPoint,
  clientToPlan: (clientX: number, clientY: number) => Point | null,
  snapPosition: (point: Point) => Point,
): Map<string, Point> | null {
  const positions = new Map<string, Point>()
  for (const [placementId, offset] of clientOffsets) {
    const point = clientToPlan(cursorClient.x + offset.x, cursorClient.y + offset.y)
    if (!point) return null
    positions.set(placementId, snapPosition(point))
  }
  return positions
}
