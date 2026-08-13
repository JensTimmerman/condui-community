import type { WireSegment } from '@/types/schema'

/** Keep busbar strokes above every conductor that terminates on them. */
export function orderWireSegmentsForRendering(wireSegments: WireSegment[]): WireSegment[] {
  return [...wireSegments].sort(
    (a, b) => Number(a.type === 'mainBus') - Number(b.type === 'mainBus')
  )
}
