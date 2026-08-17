import type { WireSegment } from '@/types/schema'

function getStableSupplyWireKey(segment: WireSegment): string | undefined {
  if (segment.supplySectionKey) return `section:${segment.panelId}:${segment.supplySectionKey}`
  if (segment.supplyAssemblyId && segment.supplyConnectionId) {
    return `connection:${segment.supplyAssemblyId}:${segment.supplyConnectionId}`
  }
  return undefined
}

function segmentLength(segment: WireSegment): number {
  return Math.hypot(
    segment.endPoint.x - segment.startPoint.x,
    segment.endPoint.y - segment.startPoint.y
  )
}

/**
 * Pick one drawable piece for cable text and route symbols on every stable physical supply wire.
 * Orthogonal pieces and separator slices remain independently selectable, but do not repeat labels.
 */
export function getSupplyWireDecorationOwnerIds(wireSegments: WireSegment[]): Set<string> {
  const owners = new Set<string>()
  const groups = new Map<string, WireSegment[]>()

  for (const segment of wireSegments) {
    const key = getStableSupplyWireKey(segment)
    if (!key) continue
    groups.set(key, [...(groups.get(key) ?? []), segment])
  }

  for (const group of groups.values()) {
    // The net-side W04 section bends at the earthing drop. Its horizontal leg
    // can be much longer, but the vertical rail leg is the intentional label
    // position and keeps both text and route glyphs out of the lower lane.
    const gridBusVerticals = group.filter(
      (segment) => segment.busFeedKind === 'grid' && segment.startPoint.x === segment.endPoint.x
    )
    const candidates = gridBusVerticals.length > 0 ? gridBusVerticals : group
    const owner = candidates.reduce((best, candidate) => {
      const candidateLength = segmentLength(candidate)
      const bestLength = segmentLength(best)
      if (candidateLength !== bestLength) return candidateLength > bestLength ? candidate : best

      // A horizontal tie leaves text readable without rotation.
      const candidateHorizontal = candidate.startPoint.y === candidate.endPoint.y
      const bestHorizontal = best.startPoint.y === best.endPoint.y
      return candidateHorizontal && !bestHorizontal ? candidate : best
    })
    owners.add(owner.id)
  }

  return owners
}

export function hasStableSupplyWireDecorationIdentity(segment: WireSegment): boolean {
  return getStableSupplyWireKey(segment) != null
}
