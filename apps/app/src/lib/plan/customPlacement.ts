import type { Placement } from '@/types/schema'

type PlacementStyle = Placement['style'] & {
  customPosition?: boolean
}

function resolvePlacementStyle(style: Placement['style'] | undefined): PlacementStyle | undefined {
  if (!style || typeof style !== 'object') return undefined
  return style as PlacementStyle
}

export function hasCustomPlacement(placement: Placement): boolean {
  return resolvePlacementStyle(placement.style)?.customPosition === true
}

export function withCustomPlacementFlag(
  placement: Placement,
  updates: Partial<Placement>
): Partial<Placement> {
  const nextPos = updates.pos
  if (!nextPos) return updates

  const moved =
    Math.abs(nextPos.x - placement.pos.x) > 1e-6 || Math.abs(nextPos.y - placement.pos.y) > 1e-6
  if (!moved) return updates

  const nextStyle: PlacementStyle = {
    ...(resolvePlacementStyle(placement.style) ?? {}),
    ...(resolvePlacementStyle(updates.style) ?? {}),
    customPosition: true,
  }

  return {
    ...updates,
    style: nextStyle,
  }
}
