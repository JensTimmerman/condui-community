import type { WireSegment } from '@/types/schema'

/** Touch taps have no mouse button; mouse selection is primary-button only. */
export function isPrimaryWireSelection(button?: number): boolean {
  return button == null || button === 0
}

/**
 * A bus-section association describes which rail feeds a conductor; it does not turn that
 * conductor into the rail's selection surface. Only the rendered busbar itself selects the rail.
 */
export function wireSegmentSelectsBusSection(segment: WireSegment): boolean {
  return segment.type === 'mainBus' && Boolean(segment.busSectionId)
}
