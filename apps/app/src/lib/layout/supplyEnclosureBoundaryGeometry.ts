import type { Point2, WireSegment } from '@/types/schema'
import { isWireLabelVisibleForSegment } from '@/lib/wireLabelVisibility'
import {
  WIRE_LABEL_FONT_SIZE,
  formatWireLabel,
  getSupplyWireLabelAnchor,
  measureTextWidth,
} from '@/lib/wireTextLabel'

const BOUNDARY_EDGE_INSET = 8
const BOUNDARY_LABEL_CLEARANCE = 4

/**
 * Places an enclosure separator on its wire without crossing the centered cable label.
 * The segment has already been lengthened where necessary by the supply layout.
 */
export function getSupplyEnclosureBoundaryCenter(
  segment: WireSegment,
  fontFamily = 'Arial'
): Point2 {
  const midpoint = {
    x: (segment.startPoint.x + segment.endPoint.x) / 2,
    y: (segment.startPoint.y + segment.endPoint.y) / 2,
  }
  if (!isWireLabelVisibleForSegment(segment)) return midpoint

  const horizontal =
    Math.abs(segment.endPoint.x - segment.startPoint.x) >=
    Math.abs(segment.endPoint.y - segment.startPoint.y)
  const axisStart = horizontal ? segment.startPoint.x : segment.startPoint.y
  const axisEnd = horizontal ? segment.endPoint.x : segment.endPoint.y
  const low = Math.min(axisStart, axisEnd)
  const high = Math.max(axisStart, axisEnd)
  if (high - low <= BOUNDARY_EDGE_INSET * 2) return midpoint

  const labelAnchor = horizontal ? getSupplyWireLabelAnchor(segment)?.x : midpoint.y
  if (labelAnchor == null) return midpoint
  const labelWidth = measureTextWidth(
    formatWireLabel(segment),
    fontFamily,
    WIRE_LABEL_FONT_SIZE
  )
  const labelLow = labelAnchor - labelWidth / 2 - BOUNDARY_LABEL_CLEARANCE
  const labelHigh = labelAnchor + labelWidth / 2 + BOUNDARY_LABEL_CLEARANCE
  const lowCandidate = low + BOUNDARY_EDGE_INSET
  const highCandidate = high - BOUNDARY_EDGE_INSET
  const lowClearance = labelLow - lowCandidate
  const highClearance = highCandidate - labelHigh
  const boundaryAxis =
    lowClearance >= 0 || highClearance >= 0
      ? lowClearance >= 0
        ? lowCandidate
        : highCandidate
      : Math.abs(lowCandidate - labelAnchor) >= Math.abs(highCandidate - labelAnchor)
        ? lowCandidate
        : highCandidate

  return horizontal ? { x: boundaryAxis, y: midpoint.y } : { x: midpoint.x, y: boundaryAxis }
}
