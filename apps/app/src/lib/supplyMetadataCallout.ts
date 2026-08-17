import type { Point } from '@/types/ui'

export interface SupplyMetadataCalloutSegment {
  startPoint: Point
  endPoint: Point
}

export interface SupplyMetadataCalloutPlacement {
  x: number
  y: number
}

const CALLOUT_WIRE_CLEARANCE = 6

export function shouldUseSupplyMetadataCallout(lines: string[], multiplier: number): boolean {
  const visualLineCount = lines.reduce(
    (total, line) => total + Math.max(1, line.split(/\r?\n/).length),
    0
  )
  const longestLine = Math.max(
    0,
    ...lines.flatMap((line) => line.split(/\r?\n/)).map((line) => line.length)
  )
  return multiplier > 1 || visualLineCount >= 4 || longestLine >= 18
}

function segmentIntersectsRect(
  segment: SupplyMetadataCalloutSegment,
  rect: { left: number; top: number; right: number; bottom: number }
): boolean {
  const segmentLeft = Math.min(segment.startPoint.x, segment.endPoint.x)
  const segmentRight = Math.max(segment.startPoint.x, segment.endPoint.x)
  const segmentTop = Math.min(segment.startPoint.y, segment.endPoint.y)
  const segmentBottom = Math.max(segment.startPoint.y, segment.endPoint.y)
  return !(
    segmentRight < rect.left ||
    segmentLeft > rect.right ||
    segmentBottom < rect.top ||
    segmentTop > rect.bottom
  )
}

/** Preferred upper-left callout placement with small deterministic collision nudges. */
export function getSupplyMetadataCalloutPlacement({
  symbolPosition,
  width,
  height,
  segments,
  placement = 'upper-left',
}: {
  symbolPosition: Point
  width: number
  height: number
  segments: SupplyMetadataCalloutSegment[]
  placement?: 'upper-left' | 'top'
}): SupplyMetadataCalloutPlacement {
  const preferred =
    placement === 'top'
      ? { x: -width / 2, y: -height - 28 }
      : // Sit clearly above the phase/domain labels around the inverter while keeping
        // the callout close enough that its leader remains short and unambiguous.
        { x: -width - 30, y: -height - 40 }
  const candidates =
    placement === 'top'
      ? [
          preferred,
          { x: preferred.x + 24, y: preferred.y },
          { x: preferred.x - 24, y: preferred.y },
          { x: preferred.x, y: preferred.y - 20 },
        ]
      : [
          preferred,
          { x: preferred.x, y: preferred.y - 40 },
          { x: preferred.x + 20, y: preferred.y - 20 },
          { x: preferred.x - 28, y: preferred.y - 20 },
          { x: preferred.x - 56, y: preferred.y },
        ]

  return (
    candidates.find((candidate) => {
      const rect = {
        left: symbolPosition.x + candidate.x - CALLOUT_WIRE_CLEARANCE,
        top: symbolPosition.y + candidate.y - CALLOUT_WIRE_CLEARANCE,
        right: symbolPosition.x + candidate.x + width + CALLOUT_WIRE_CLEARANCE,
        bottom: symbolPosition.y + candidate.y + height + CALLOUT_WIRE_CLEARANCE,
      }
      return !segments.some((segment) => segmentIntersectsRect(segment, rect))
    }) ?? candidates[candidates.length - 1]!
  )
}
