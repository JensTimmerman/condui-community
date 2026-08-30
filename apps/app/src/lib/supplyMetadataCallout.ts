import type { Point } from '@/types/ui'
import type { TrunkDevice } from '@/types/schema'
import { getSupplyDeviceMultiplier } from '@/lib/supplyAssembly/inverterMultipliers'
import { getMetadataCalloutGroups } from '@/lib/metadataCalloutGrouping'

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

export interface SupplyMetadataCalloutCluster {
  ownerConverterId: string
  representativeId: string
  targetIds: string[]
  totalMultiplier: number
}

/**
 * Groups identical supply metadata only within one converter-owned topology.
 * Non-metadata devices do not interrupt ownership, so a fuse or junction box
 * between two equal panels still allows them to share one frame.
 */
export function getSupplyMetadataCalloutClusters(
  items: Array<{ device: TrunkDevice; lines: string[] }>
): Map<string, SupplyMetadataCalloutCluster> {
  const ownerByDeviceId = new Map<string, string>()
  let activeConverterId: string | undefined

  for (const { device } of items) {
    if (device.supplyPath === 'converter-branch' || device.supplyPath === 'backup') {
      activeConverterId = device.id
      ownerByDeviceId.set(device.id, device.id)
      continue
    }
    const belongsToActiveConverter =
      device.supplyPath === 'converter-dc' || device.supplyPath === 'converter-dc-top'
    ownerByDeviceId.set(
      device.id,
      belongsToActiveConverter && activeConverterId ? activeConverterId : device.id
    )
  }

  const groups = getMetadataCalloutGroups(
    items.map(({ device, lines }) => ({
      id: device.id,
      ownerId: ownerByDeviceId.get(device.id) ?? device.id,
      symbol: device.symbol ?? '',
      lines,
      multiplier: getSupplyDeviceMultiplier(device),
    }))
  )

  const result = new Map<string, SupplyMetadataCalloutCluster>()
  for (const group of new Set(groups.values())) {
    const representativeId = group.representativeId
    const targetIds = group.targetIds
    const cluster = {
      ownerConverterId: ownerByDeviceId.get(representativeId) ?? representativeId,
      representativeId,
      targetIds,
      totalMultiplier: group.totalMultiplier,
    }
    targetIds.forEach((targetId) => result.set(targetId, cluster))
  }
  return result
}

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
  mirrorHorizontally = false,
  adaptiveAnchors = false,
}: {
  placement: SupplyMetadataCalloutPlacement
  width: number
  height: number
  symbolWidth: number
  symbolHeight: number
  placementKind: SupplyMetadataCalloutPlacementKind
  /** Keep the leader attached to the equivalent symbol port in a mirrored supply layout. */
  mirrorHorizontally?: boolean
  /** Choose the nearest card and symbol edges instead of fixed bottom/top anchors. */
  adaptiveAnchors?: boolean
}): [number, number, number, number] {
  if (adaptiveAnchors) {
    const symbolGap = 0.5
    const cardAnchors = [
      { x: placement.x, y: placement.y },
      { x: placement.x, y: placement.y + height / 2 },
      { x: placement.x, y: placement.y + height },
      { x: placement.x + width / 2, y: placement.y },
      { x: placement.x + width / 2, y: placement.y + height },
      { x: placement.x + width, y: placement.y },
      { x: placement.x + width, y: placement.y + height / 2 },
      { x: placement.x + width, y: placement.y + height },
    ]
    const symbolAnchors = [
      { x: 0, y: -symbolHeight / 2 - symbolGap },
      { x: symbolWidth / 2 + symbolGap, y: 0 },
      { x: 0, y: symbolHeight / 2 + symbolGap },
      { x: -symbolWidth / 2 - symbolGap, y: 0 },
    ]
    let closest = { card: cardAnchors[0]!, symbol: symbolAnchors[0]!, distance: Infinity }
    for (const card of cardAnchors) {
      for (const symbol of symbolAnchors) {
        const distance = (card.x - symbol.x) ** 2 + (card.y - symbol.y) ** 2
        if (distance < closest.distance) closest = { card, symbol, distance }
      }
    }
    return [closest.card.x, closest.card.y, closest.symbol.x, closest.symbol.y]
  }

  const canonicalSymbolAnchor =
    placementKind === 'top'
      ? { x: 0, y: -symbolHeight / 2 - 2 }
      : { x: -symbolWidth / 2 - 2, y: -symbolHeight / 2 - 2 }
  const symbolAnchor = {
    x: mirrorHorizontally ? -canonicalSymbolAnchor.x : canonicalSymbolAnchor.x,
    y: canonicalSymbolAnchor.y,
  }
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

/**
 * Fans a shared metadata frame out from one common, nearest edge anchor. This
 * keeps grouped leaders visually calm while each target still receives the
 * line at the closest safe edge of its own symbol.
 */
export function getSupplyMetadataSharedLeaderPointSets({
  placement,
  width,
  height,
  targets,
}: {
  placement: SupplyMetadataCalloutPlacement
  width: number
  height: number
  targets: Array<{ position: Point; width: number; height: number }>
}): Array<[number, number, number, number]> {
  if (targets.length === 0) return []
  const cardAnchors = [
    { x: placement.x + width / 2, y: placement.y + height },
    { x: placement.x, y: placement.y + height / 2 },
    { x: placement.x + width, y: placement.y + height / 2 },
    { x: placement.x + width / 2, y: placement.y },
    { x: placement.x, y: placement.y + height },
    { x: placement.x + width, y: placement.y + height },
    { x: placement.x, y: placement.y },
    { x: placement.x + width, y: placement.y },
  ]
  const targetAnchors = targets.map((target) => [
    { x: target.position.x, y: target.position.y - target.height / 2 - 0.5 },
    { x: target.position.x + target.width / 2 + 0.5, y: target.position.y },
    { x: target.position.x, y: target.position.y + target.height / 2 + 0.5 },
    { x: target.position.x - target.width / 2 - 0.5, y: target.position.y },
  ])
  const score = (card: Point) =>
    targetAnchors.reduce(
      (total, anchors) =>
        total +
        Math.min(...anchors.map((anchor) => (card.x - anchor.x) ** 2 + (card.y - anchor.y) ** 2)),
      0
    )
  const sharedCardAnchor = cardAnchors.reduce((best, candidate) =>
    score(candidate) < score(best) ? candidate : best
  )

  return targetAnchors.map((anchors) => {
    const targetAnchor = anchors.reduce((best, candidate) => {
      const candidateDistance =
        (sharedCardAnchor.x - candidate.x) ** 2 + (sharedCardAnchor.y - candidate.y) ** 2
      const bestDistance = (sharedCardAnchor.x - best.x) ** 2 + (sharedCardAnchor.y - best.y) ** 2
      return candidateDistance < bestDistance ? candidate : best
    })
    return [sharedCardAnchor.x, sharedCardAnchor.y, targetAnchor.x, targetAnchor.y]
  })
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

/** Converter specifications need a collision-aware frame even when only a few fields are shown. */
export function shouldUseSupplyDeviceMetadataCallout(
  device: Pick<TrunkDevice, 'type' | 'supplyPath'>,
  lines: string[],
  multiplier: number
): boolean {
  const isSupplyConverter =
    device.type === 'conversion' &&
    (device.supplyPath === 'converter-branch' || device.supplyPath === 'backup')
  return (
    lines.length > 0 && (isSupplyConverter || shouldUseSupplyMetadataCallout(lines, multiplier))
  )
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
  packRows = true,
  preferRightNudges = false,
}: {
  items: SupplyMetadataCalloutGroupItem[]
  segments: SupplyMetadataCalloutSegment[]
  /** Other content (including non-card device symbols) that cards must avoid. */
  symbolRects?: SupplyMetadataCalloutRect[]
  /** Supply assemblies use compact rows; staggered converter outputs stay nearer their symbols. */
  packRows?: boolean
  /** For vertically staggered symbols, try the shorter right-side detour first. */
  preferRightNudges?: boolean
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
      preferRightNudges,
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
  const CALLOUT_COLLISION_GAP = 8
  const groups = new Map<'upper-left' | 'top', typeof basePlacements>()
  basePlacements.forEach((entry) => {
    const kind = entry.item.placement ?? 'upper-left'
    const group = groups.get(kind) ?? []
    group.push(entry)
    groups.set(kind, group)
  })

  groups.forEach((group) => {
    const ordered = [...group].sort((left, right) => left.rect.left - right.rect.left)
    if (packRows && ordered.length > 1) {
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
    while (attempts < 24) {
      const overlappingPrevious = allResults
        .slice(0, index)
        .filter((previous) =>
          packRows
            ? rectIntersectsRect(current.rect, previous.rect)
            : !(
                current.rect.right + CALLOUT_COLLISION_GAP <= previous.rect.left ||
                current.rect.left >= previous.rect.right + CALLOUT_COLLISION_GAP ||
                current.rect.bottom + CALLOUT_COLLISION_GAP <= previous.rect.top ||
                current.rect.top >= previous.rect.bottom + CALLOUT_COLLISION_GAP
              )
        )
      if (overlappingPrevious.length === 0) break
      current.x += packRows
        ? current.width + CALLOUT_GROUP_GAP
        : Math.max(...overlappingPrevious.map((previous) => previous.rect.right)) -
          current.rect.left +
          CALLOUT_COLLISION_GAP
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
  preferRightNudges = false,
}: {
  symbolPosition: Point
  width: number
  height: number
  segments: SupplyMetadataCalloutSegment[]
  /** Existing device labels/callouts that this card must not cover. */
  avoidRects?: SupplyMetadataCalloutRect[]
  placement?: 'upper-left' | 'top'
  preferRightNudges?: boolean
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
          ...(preferRightNudges
            ? [
                { x: preferred.x + width + 12, y: preferred.y },
                { x: preferred.x + 24, y: preferred.y },
                { x: preferred.x - width - 12, y: preferred.y },
                { x: preferred.x - 24, y: preferred.y },
              ]
            : [
                // Supply rows traditionally expand toward their source side first.
                { x: preferred.x - width - 12, y: preferred.y },
                { x: preferred.x + width + 12, y: preferred.y },
                { x: preferred.x + 24, y: preferred.y },
                { x: preferred.x - 24, y: preferred.y },
              ]),
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
