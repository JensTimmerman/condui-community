import type { SelectedPlacementItem } from '@/lib/plan/planContextMenuSelection'

export type PlacementMove = {
  placementId: string
  pos: { x: number; y: number }
}

export type PlanPlacementAlignment =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'center'
  | 'distributeHorizontal'
  | 'distributeVertical'

export function buildPlacementAlignmentMoves(
  items: readonly SelectedPlacementItem[],
  alignment: PlanPlacementAlignment
): PlacementMove[] {
  if (items.length < 2) return []

  switch (alignment) {
    case 'left': {
      const targetLeft = Math.min(...items.map((item) => item.bounds.left))
      return items.map((item) => moveBy(item, targetLeft - item.bounds.left, 0))
    }
    case 'right': {
      const targetRight = Math.max(...items.map((item) => item.bounds.right))
      return items.map((item) => moveBy(item, targetRight - item.bounds.right, 0))
    }
    case 'top': {
      const targetTop = Math.min(...items.map((item) => item.bounds.top))
      return items.map((item) => moveBy(item, 0, targetTop - item.bounds.top))
    }
    case 'bottom': {
      const targetBottom = Math.max(...items.map((item) => item.bounds.bottom))
      return items.map((item) => moveBy(item, 0, targetBottom - item.bounds.bottom))
    }
    case 'center': {
      const overallLeft = Math.min(...items.map((item) => item.bounds.left))
      const overallRight = Math.max(...items.map((item) => item.bounds.right))
      const targetCenterX = (overallLeft + overallRight) / 2
      return items.map((item) => {
        const currentCenterX = (item.bounds.left + item.bounds.right) / 2
        return moveBy(item, targetCenterX - currentCenterX, 0)
      })
    }
    case 'distributeHorizontal':
      return buildHorizontalDistributionMoves(items)
    case 'distributeVertical':
      return buildVerticalDistributionMoves(items)
  }
}

function buildHorizontalDistributionMoves(items: readonly SelectedPlacementItem[]): PlacementMove[] {
  if (items.length < 3) return []
  const sorted = [...items].sort((a, b) => a.bounds.left - b.bounds.left)
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  const totalSpan = last.bounds.right - first.bounds.left
  const totalItemWidth = sorted.reduce((sum, item) => sum + (item.bounds.right - item.bounds.left), 0)
  const gap = (totalSpan - totalItemWidth) / (sorted.length - 1)
  const moves: PlacementMove[] = []
  let nextLeft = first.bounds.left + (first.bounds.right - first.bounds.left) + gap
  for (let idx = 1; idx < sorted.length - 1; idx++) {
    const item = sorted[idx]!
    const itemWidth = item.bounds.right - item.bounds.left
    moves.push(moveBy(item, nextLeft - item.bounds.left, 0))
    nextLeft += itemWidth + gap
  }
  return moves
}

function buildVerticalDistributionMoves(items: readonly SelectedPlacementItem[]): PlacementMove[] {
  if (items.length < 3) return []
  const sorted = [...items].sort((a, b) => a.bounds.top - b.bounds.top)
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  const totalSpan = last.bounds.bottom - first.bounds.top
  const totalItemHeight = sorted.reduce((sum, item) => sum + (item.bounds.bottom - item.bounds.top), 0)
  const gap = (totalSpan - totalItemHeight) / (sorted.length - 1)
  const moves: PlacementMove[] = []
  let nextTop = first.bounds.top + (first.bounds.bottom - first.bounds.top) + gap
  for (let idx = 1; idx < sorted.length - 1; idx++) {
    const item = sorted[idx]!
    const itemHeight = item.bounds.bottom - item.bounds.top
    moves.push(moveBy(item, 0, nextTop - item.bounds.top))
    nextTop += itemHeight + gap
  }
  return moves
}

function moveBy(item: SelectedPlacementItem, dx: number, dy: number): PlacementMove {
  return {
    placementId: item.placementId,
    pos: { x: item.pos.x + dx, y: item.pos.y + dy },
  }
}
