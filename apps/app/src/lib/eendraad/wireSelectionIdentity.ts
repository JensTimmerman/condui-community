import type { WireSegment } from '@/types/schema'
import type { Selection } from '@/types/ui'

type WireSelectionMetadata = NonNullable<Selection['wireMetadata']>[number]

/** Resolve a regenerated circuit wire from stable electrical identity rather than its transient ID. */
export function resolveCircuitWireSegmentByMetadata(
  wireSegments: WireSegment[],
  metadata: WireSelectionMetadata
): WireSegment | null {
  if (!metadata.circuitId) return null
  const candidates = wireSegments.filter(
    (segment) => segment.circuitId === metadata.circuitId && segment.panelId === metadata.panelId
  )
  const domainMatches = (segment: WireSegment) =>
    metadata.domain == null || segment.domain === metadata.domain
  const endpointsMatch = (segment: WireSegment) =>
    (metadata.fromElementId == null || segment.fromElementId === metadata.fromElementId) &&
    (metadata.toElementId == null || segment.toElementId === metadata.toElementId)
  const hasEndpointIdentity = metadata.fromElementId != null || metadata.toElementId != null

  if (hasEndpointIdentity) {
    const exact = candidates.find(
      (segment) =>
        (metadata.type == null || segment.type === metadata.type) &&
        domainMatches(segment) &&
        endpointsMatch(segment)
    )
    if (exact) return exact
  }

  if (metadata.type != null || metadata.domain != null) {
    const sameKind = candidates.find(
      (segment) =>
        (metadata.type == null || segment.type === metadata.type) && domainMatches(segment)
    )
    if (sameKind) return sameKind
  }

  // Legacy metadata did not retain type/domain; keep its former vertical fallback.
  return candidates.find((segment) => segment.type === 'vertical') ?? null
}
