import type { Stair } from '@/types/schema'

export type StairUpArrowDirection = 'none' | 'left' | 'right'

export function getStairUpArrowDirection(
  stair: Pick<Stair, 'showUpArrow' | 'invertUpArrow'>,
  spiralStair: boolean
): StairUpArrowDirection {
  if (!stair.showUpArrow) return 'none'
  const inverted = spiralStair ? stair.invertUpArrow ?? true : !!stair.invertUpArrow
  return inverted ? 'left' : 'right'
}

export function stairUpArrowDirectionPatch(
  direction: StairUpArrowDirection
): Pick<Stair, 'showUpArrow' | 'invertUpArrow'> {
  if (direction === 'none') return { showUpArrow: false }
  if (direction === 'left') return { showUpArrow: true, invertUpArrow: true }
  return { showUpArrow: true, invertUpArrow: false }
}
