import type { Point } from '@/types/ui'

export interface SupplyMetadataCalloutSegment {
  startPoint: Point
  endPoint: Point
}

export interface SupplyMetadataCalloutPlacement {
  x: number
  y: number
}

export interface SupplyMetadataCalloutRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface SupplyMetadataCalloutGroupItem {
  id: string
  symbolPosition: Point
  width: number
  height: number
  placement?: 'upper-left' | 'top'
}

export interface SupplyMetadataCalloutGroupPlacement extends SupplyMetadataCalloutGroupItem {
  x: number
  y: number
  rect: SupplyMetadataCalloutRect
}

export type SupplyMetadataCalloutPlacementKind = 'upper-left' | 'top'

/**
 * A lone metadata card can sit directly above its device. Inverter cards use
 * the upper-left position only when they are part of a grouped supply row,
 * where that offset leaves room for the other equipment cards.
 */
export function getSupplyMetadataCalloutPlacementKind({
  symbol,
  peerCount,
}: {
  symbol?: string
  peerCount: number
}): SupplyMetadataCalloutPlacementKind {
  return symbol === 'inverter' && peerCount > 1 ? 'upper-left' : 'top'
}

const CALLOUT_WIRE_CLEARANCE = 6
export const SUPPLY_METADATA_CALLOUT_MIN_WIDTH = 80

/**
 * Connects a metadata card to the shortest of its three bottom-edge anchors.
 *
 * The canvas renders the returned points relative to the device symbol. Keeping
 * this calculation here makes the leader geometry deterministic for every
 * callout placement, including grouped cards that move left or right.
 */
export function getSupplyMetadataCalloutLeaderPoints({
  placement,
  width,
  height,
  symbolWidth,
  symbolHeight,
  placementKind,
}: {
  placement: SupplyMetadataCalloutPlacement
  width: number
  height: number
  symbolWidth: number
  symbolHeight: number
  placementKind: SupplyMetadataCalloutPlacementKind
}): [number, number, number, number] {
  const symbolAnchor =
    placementKind === 'top'
      ? { x: 0, y: -symbolHeight / 2 - 2 }
      : { x: -symbolWidth / 2 - 2, y: -symbolHeight / 2 - 2 }
  const bottom = placement.y + height
  const anchors = [
    { x: placement.x, y: bottom },
    { x: placement.x + width / 2, y: bottom },
    { x: placement.x + width, y: bottom },
  ]
  const closestAnchor = anchors.reduce((closest, anchor) => {
    const distance = (anchor.x - symbolAnchor.x) ** 2 + (anchor.y - symbolAnchor.y) ** 2
    const closestDistance = (closest.x - symbolAnchor.x) ** 2 + (closest.y - symbolAnchor.y) ** 2
    return distance < closestDistance ? anchor : closest
  })

  return [closestAnchor.x, closestAnchor.y, symbolAnchor.x, symbolAnchor.y]
}

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
  rect: SupplyMetadataCalloutRect
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

function rectIntersectsRect(a: SupplyMetadataCalloutRect, b: SupplyMetadataCalloutRect): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
}

function getCalloutRect(
  symbolPosition: Point,
  placement: SupplyMetadataCalloutPlacement,
  width: number,
  height: number,
  clearance = 0
): SupplyMetadataCalloutRect {
  return {
    left: symbolPosition.x + placement.x - clearance,
    top: symbolPosition.y + placement.y - clearance,
    right: symbolPosition.x + placement.x + width + clearance,
    bottom: symbolPosition.y + placement.y + height + clearance,
  }
}

/**
 * Places a group of supply metadata cards deterministically.
 *
 * Every card avoids the device symbols in the group, then cards with the same
 * orientation are packed into one centered row. This is deliberately
 * independent of React rendering order, so the canvas and the layout engine
 * can use the same result when sizing the detached supply frame.
 */
export function getSupplyMetadataCalloutGroupPlacements({
  items,
  segments,
  symbolRects = [],
}: {
  items: SupplyMetadataCalloutGroupItem[]
  segments: SupplyMetadataCalloutSegment[]
  /** Other content (including non-card device symbols) that cards must avoid. */
  symbolRects?: SupplyMetadataCalloutRect[]
}): Map<string, SupplyMetadataCalloutGroupPlacement> {
  const placed = new Map<string, SupplyMetadataCalloutGroupPlacement>()
  const basePlacements = items.map((item) => {
    const avoidRects = [
      ...symbolRects,
      ...items
        .filter((peer) => peer.id !== item.id)
        .map((peer) =>
          getCalloutRect(peer.symbolPosition, { x: -15, y: -15 }, 30, 30, CALLOUT_WIRE_CLEARANCE)
        ),
    ]

    const relativePlacement = getSupplyMetadataCalloutPlacement({
      symbolPosition: item.symbolPosition,
      width: item.width,
      height: item.height,
      segments,
      avoidRects,
      placement: item.placement,
    })
    return {
      item,
      relativePlacement,
      rect: getCalloutRect(item.symbolPosition, relativePlacement, item.width, item.height),
    }
  })

  // Pack cards with the same orientation as one centered group. This avoids
  // the old cascading behaviour where the first card stayed fixed and every
  // later card was pushed farther right. The median card remains centered;
  // outer cards absorb the small movement with a compact, visible gap.
  const CALLOUT_GROUP_GAP = 6
  const groups = new Map<'upper-left' | 'top', typeof basePlacements>()
  basePlacements.forEach((entry) => {
    const kind = entry.item.placement ?? 'upper-left'
    const group = groups.get(kind) ?? []
    group.push(entry)
    groups.set(kind, group)
  })

  groups.forEach((group) => {
    const ordered = [...group].sort((left, right) => left.rect.left - right.rect.left)
    if (ordered.length > 1) {
      const centerIndex = Math.floor((ordered.length - 1) / 2)
      const centerLeft = ordered[centerIndex]!.rect.left
      const centerRight = ordered[centerIndex]!.rect.right
      const anchor = (centerLeft + centerRight) / 2
      const totalWidth =
        ordered.reduce((total, entry) => total + entry.item.width, 0) +
        CALLOUT_GROUP_GAP * (ordered.length - 1)
      let nextLeft = anchor - totalWidth / 2
      ordered.forEach((entry) => {
        entry.relativePlacement = {
          x: nextLeft - entry.item.symbolPosition.x,
          y: entry.relativePlacement.y,
        }
        entry.rect = getCalloutRect(
          entry.item.symbolPosition,
          entry.relativePlacement,
          entry.item.width,
          entry.item.height
        )
        nextLeft += entry.item.width + CALLOUT_GROUP_GAP
      })
    }

    ordered.forEach((entry) => {
      const result = {
        ...entry.item,
        x: entry.relativePlacement.x,
        y: entry.relativePlacement.y,
        rect: entry.rect,
      }
      placed.set(entry.item.id, result)
    })
  })

  // A converter/inverter card can use a different orientation from the solar
  // and battery cards. Resolve those cross-group frame collisions last while
  // leaving the centered top-card row intact.
  const allResults = [...placed.values()]
  allResults.forEach((current, index) => {
    let attempts = 0
    while (
      allResults
        .slice(0, index)
        .some((previous) => rectIntersectsRect(current.rect, previous.rect)) &&
      attempts < 24
    ) {
      current.x += current.width + 6
      current.rect = getCalloutRect(
        current.symbolPosition,
        { x: current.x, y: current.y },
        current.width,
        current.height
      )
      attempts += 1
    }
  })

  return placed
}

/** Preferred upper-left callout placement with small deterministic collision nudges. */
export function getSupplyMetadataCalloutPlacement({
  symbolPosition,
  width,
  height,
  segments,
  avoidRects = [],
  placement = 'upper-left',
}: {
  symbolPosition: Point
  width: number
  height: number
  segments: SupplyMetadataCalloutSegment[]
  /** Existing device labels/callouts that this card must not cover. */
  avoidRects?: SupplyMetadataCalloutRect[]
  placement?: 'upper-left' | 'top'
}): SupplyMetadataCalloutPlacement {
  const preferred =
    placement === 'top'
      ? { x: -width / 2, y: -height - 28 }
      : // Sit clearly above the phase/domain labels around the inverter while keeping
        // the callout close enough that its leader remains short and unambiguous.
        { x: -width - 30, y: -height - 40 }
  const preferredCandidates =
    placement === 'top'
      ? [
          preferred,
          // Keep neighboring cards close to their symbols when the preferred
          // centered position is occupied. Try the left side first so a card
          // does not unnecessarily jump beyond the next DC device.
          { x: preferred.x - width - 12, y: preferred.y },
          // When another device is directly above this one, move the card to
          // the right as a whole. A small nudge is not enough for wide cards.
          { x: preferred.x + width + 12, y: preferred.y },
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

  // The named candidates preserve the established compact placements. If all
  // of those are occupied, expand into a small deterministic grid rather than
  // falling back to a position that can still overlap another frame.
  const gridXOffsets = [0, -(width + 12), width + 12, -2 * (width + 12), 2 * (width + 12)]
  const gridYOffsets = [0, -(height + 20), height + 20, -2 * (height + 20), 2 * (height + 20)]
  const candidates = [
    ...preferredCandidates,
    ...gridYOffsets.flatMap((yOffset) =>
      gridXOffsets.map((xOffset) => ({
        x: (placement === 'top' ? -width / 2 : -width - 30) + xOffset,
        y: (placement === 'top' ? -height - 28 : -height - 40) + yOffset,
      }))
    ),
  ]

  return (
    candidates.find((candidate) => {
      const rect = getCalloutRect(symbolPosition, candidate, width, height, CALLOUT_WIRE_CLEARANCE)
      return (
        !segments.some((segment) => segmentIntersectsRect(segment, rect)) &&
        !avoidRects.some((avoidRect) => rectIntersectsRect(rect, avoidRect))
      )
    }) ?? candidates[candidates.length - 1]!
  )
}
