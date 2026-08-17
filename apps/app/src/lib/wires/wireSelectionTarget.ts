import type { WireSegment } from '@/types/schema'

/**
 * A bus-section association describes which rail feeds a conductor; it does not turn that
 * conductor into the rail's selection surface. Only the rendered busbar itself selects the rail.
 */
export function wireSegmentSelectsBusSection(segment: WireSegment): boolean {
  return segment.type === 'mainBus' && Boolean(segment.busSectionId)
}
