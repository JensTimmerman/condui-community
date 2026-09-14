import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { getVisibleConversionLabelParts, getVisibleEndpointNoteText } from '@/lib/conversionLabels'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'
import {
  applyMetadataCalloutMultiplier,
  getMetadataCalloutGroups,
  getMetadataCalloutWidth,
} from '@/lib/metadataCalloutGrouping'
import {
  getSupplyMetadataCalloutGroupPlacements,
  getSupplyMetadataCalloutLeaderPoints,
  type SupplyMetadataCalloutRect,
  type SupplyMetadataCalloutSegment,
} from '@/lib/supplyMetadataCallout'
import type { Circuit, Endpoint, TrunkDevice } from '@/types/schema'
import { getEndpointMultiplier } from '@/utils/endpointMultipliers'
import { getEndpointXOffsets } from './bottomUpBranchWidths'
import {
  CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD,
  getCircuitConverterBodyGeometry,
  getCircuitConverterDcConnectionCount,
  getOrdinaryCircuitConverterOutputRowY,
  getCircuitConverterPrimaryBranch,
  supportsCircuitConverterDcConnections,
} from './circuitConverterGeometry'

const LEADER_SYMBOL_CLEARANCE = 0.5
const CONVERTER_METADATA_CARD_GAP = 3
const BRANCH_CONVERSION_SYMBOLS = new Set([
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
])

export interface CircuitConverterMetadataCallout {
  targetId: string
  sharedTargetIds: string[]
  totalMultiplier: number
  x: number
  y: number
  width: number
  height: number
  rect: SupplyMetadataCalloutRect
  leaderPoints: [number, number, number, number]
  leaderSegments: Array<[number, number, number, number]>
}

interface MetadataTarget {
  id: string
  x: number
  y: number
}

/**
 * Return the painted height required by a branch-local conversion card.
 * Keeping this measurement beside the placement code lets the branch-row
 * layout reserve exactly the same card height that the renderer will paint.
 */
export function getBranchConverterMetadataCalloutHeight(endpoint: Endpoint): number {
  if (!BRANCH_CONVERSION_SYMBOLS.has(endpoint.symbol ?? '')) return 0
  const metadataItems = getMetadataItems(endpoint)
  if (metadataItems.length === 0) return 0
  const multiplier = getEndpointMultiplier(endpoint)
  return getCardSize(
    applyMetadataCalloutMultiplier(metadataItems, multiplier).map((item) => item.text)
  ).height
}

function getSymbolAnchors(
  target: MetadataTarget,
  width: number,
  height: number
): Array<{ x: number; y: number }> {
  return [
    { x: target.x, y: target.y - height / 2 - LEADER_SYMBOL_CLEARANCE },
    { x: target.x + width / 2 + LEADER_SYMBOL_CLEARANCE, y: target.y },
    { x: target.x, y: target.y + height / 2 + LEADER_SYMBOL_CLEARANCE },
    { x: target.x - width / 2 - LEADER_SYMBOL_CLEARANCE, y: target.y },
  ]
}

function getSharedCardAnchor(
  rect: SupplyMetadataCalloutRect,
  targets: MetadataTarget[],
  targetWidth: number,
  targetHeight: number
): { x: number; y: number } {
  const cardAnchors = [
    { x: rect.left, y: rect.top },
    { x: rect.left, y: (rect.top + rect.bottom) / 2 },
    { x: rect.left, y: rect.bottom },
    { x: (rect.left + rect.right) / 2, y: rect.top },
    { x: (rect.left + rect.right) / 2, y: rect.bottom },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: (rect.top + rect.bottom) / 2 },
    { x: rect.right, y: rect.bottom },
  ]
  return cardAnchors.reduce(
    (best, anchor) => {
      const score = targets.reduce((total, target) => {
        const nearestDistance = Math.min(
          ...getSymbolAnchors(target, targetWidth, targetHeight).map(
            (symbolAnchor) => (anchor.x - symbolAnchor.x) ** 2 + (anchor.y - symbolAnchor.y) ** 2
          )
        )
        return total + nearestDistance
      }, 0)
      return score < best.score ? { anchor, score } : best
    },
    { anchor: cardAnchors[0]!, score: Number.POSITIVE_INFINITY }
  ).anchor
}

function getMetadataItems(endpoint: Endpoint): Array<{ key: string; text: string }> {
  return [
    ...getVisibleConversionLabelParts(endpoint),
    ...getVisibleCertificationLabelParts(endpoint),
    ...(getVisibleEndpointNoteText(endpoint)
      ? [{ key: 'endpointNotes', text: getVisibleEndpointNoteText(endpoint) }]
      : []),
  ]
}

export interface BranchConverterMetadataTarget {
  endpoint: Endpoint
  position: { x: number; y: number }
}

/**
 * Branch-local conversion endpoints use the same detached-card treatment as
 * supply converters. Their card prefers a centered position directly above
 * the symbol; right-side nudges are only used when that space is occupied.
 */
export function getBranchConverterMetadataCallouts({
  targets,
  symbolSize,
  segments = [],
}: {
  targets: BranchConverterMetadataTarget[]
  symbolSize: number
  segments?: SupplyMetadataCalloutSegment[]
}): Map<string, CircuitConverterMetadataCallout> {
  const candidates = targets.flatMap(({ endpoint, position }) => {
    if (!BRANCH_CONVERSION_SYMBOLS.has(endpoint.symbol ?? '')) return []
    const metadataItems = getMetadataItems(endpoint)
    if (metadataItems.length === 0) return []
    const multiplier = getEndpointMultiplier(endpoint)
    const { width, height } = getCardSize(
      applyMetadataCalloutMultiplier(metadataItems, multiplier).map((item) => item.text)
    )
    return [
      {
        endpoint,
        position,
        metadataItems,
        width,
        height,
        multiplier,
      },
    ]
  })
  if (candidates.length === 0) return new Map()

  const symbolRects = targets.map(({ position }) => ({
    left: position.x - symbolSize / 2 - 4,
    top: position.y - symbolSize / 2 - 4,
    right: position.x + symbolSize / 2 + 4,
    bottom: position.y + symbolSize / 2 + 4,
  }))
  const placements = getSupplyMetadataCalloutGroupPlacements({
    items: candidates.map(({ endpoint, position, width, height }) => ({
      id: endpoint.id,
      symbolPosition: position,
      width,
      height,
      placement: 'top' as const,
    })),
    segments,
    symbolRects,
    packRows: false,
    preferRightNudges: true,
  })

  return new Map(
    candidates.flatMap(({ endpoint, width, height, multiplier }) => {
      const placement = placements.get(endpoint.id)
      if (!placement) return []
      const leaderPoints = getSupplyMetadataCalloutLeaderPoints({
        placement: { x: placement.x, y: placement.y },
        width,
        height,
        symbolWidth: symbolSize,
        symbolHeight: symbolSize,
        placementKind: 'top',
        adaptiveAnchors: true,
      })
      return [
        [
          endpoint.id,
          {
            targetId: endpoint.id,
            sharedTargetIds: [endpoint.id],
            totalMultiplier: multiplier,
            x: placement.x,
            y: placement.y,
            width,
            height,
            rect: placement.rect,
            leaderPoints,
            leaderSegments: [leaderPoints],
          },
        ] as const,
      ]
    })
  )
}

function getDeviceMetadataLines(device: TrunkDevice): string[] {
  const notes = (device.notes ?? '').trim()
  return [
    ...getVisibleCertificationLabelParts(device).map((part) => part.text),
    ...getVisibleConversionLabelParts(device).map((part) => part.text),
    ...(notes.length > 0 &&
    isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)
      ? [notes]
      : []),
  ].filter((line) => line.length > 0)
}

function getCardSize(lines: string[]): { width: number; height: number } {
  const visualLineCount = lines.reduce(
    (total, line) => total + Math.max(1, line.split(/\r?\n/).length),
    0
  )
  const textWidth = Math.max(
    0,
    ...lines.map((line) => measureSymbolLabelTextWidth(line, 'Figtree', 8))
  )
  return {
    width: getMetadataCalloutWidth([textWidth]),
    height: visualLineCount * 10 + 10,
  }
}

function rectsOverlap(
  left: SupplyMetadataCalloutRect,
  right: SupplyMetadataCalloutRect,
  clearance = 0
): boolean {
  return !(
    left.right + clearance <= right.left ||
    left.left >= right.right + clearance ||
    left.bottom + clearance <= right.top ||
    left.top >= right.bottom + clearance
  )
}

function segmentOverlapsRect(
  segment: SupplyMetadataCalloutSegment,
  rect: SupplyMetadataCalloutRect,
  clearance = 0
): boolean {
  const left = Math.min(segment.startPoint.x, segment.endPoint.x)
  const right = Math.max(segment.startPoint.x, segment.endPoint.x)
  const top = Math.min(segment.startPoint.y, segment.endPoint.y)
  const bottom = Math.max(segment.startPoint.y, segment.endPoint.y)
  return !(
    right + clearance <= rect.left ||
    left >= rect.right + clearance ||
    bottom + clearance <= rect.top ||
    top >= rect.bottom + clearance
  )
}

function getSegmentRectInterval(
  segment: [number, number, number, number],
  rect: SupplyMetadataCalloutRect
): [number, number] | null {
  const [x1, y1, x2, y2] = segment
  const dx = x2 - x1
  const dy = y2 - y1
  let start = 0
  let end = 1
  const constraints: Array<[number, number]> = [
    [-dx, x1 - rect.left],
    [dx, rect.right - x1],
    [-dy, y1 - rect.top],
    [dy, rect.bottom - y1],
  ]
  for (const [p, q] of constraints) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    const ratio = q / p
    if (p < 0) start = Math.max(start, ratio)
    else end = Math.min(end, ratio)
    if (start > end) return null
  }
  return [start, end]
}

export function clipCircuitConverterMetadataLeaderBehindRects(
  segment: [number, number, number, number],
  rects: SupplyMetadataCalloutRect[]
): Array<[number, number, number, number]> {
  const intervals = rects
    .map((rect) => getSegmentRectInterval(segment, rect))
    .filter((interval): interval is [number, number] => interval != null)
    .sort((left, right) => left[0] - right[0])
  const visibleIntervals: Array<[number, number]> = []
  let cursor = 0
  for (const [start, end] of intervals) {
    if (start > cursor) visibleIntervals.push([cursor, start])
    cursor = Math.max(cursor, end)
  }
  if (cursor < 1) visibleIntervals.push([cursor, 1])
  const [x1, y1, x2, y2] = segment
  return visibleIntervals
    .filter(([start, end]) => end - start > 0.01)
    .map(([start, end]) => [
      x1 + (x2 - x1) * start,
      y1 + (y2 - y1) * start,
      x1 + (x2 - x1) * end,
      y1 + (y2 - y1) * end,
    ])
}

export function getCircuitConverterMetadataCallouts({
  circuit,
  device,
  anchor,
  symbolSize,
  endpointSpacing,
  applianceAfterSocketGap,
}: {
  circuit: Circuit
  device: TrunkDevice
  anchor: { x: number; y: number }
  symbolSize: number
  endpointSpacing: number
  applianceAfterSocketGap: number
}): Map<string, CircuitConverterMetadataCallout> {
  const count = getCircuitConverterDcConnectionCount(device)
  if (!supportsCircuitConverterDcConnections(device) || count <= 1) return new Map()

  const geometry = getCircuitConverterBodyGeometry(device, anchor)
  const owningConverterBranch = (circuit.branches ?? []).find((branch) =>
    branch.branchDevices?.some((candidate) => candidate.id === device.id)
  )
  const primaryIds = new Set(
    (owningConverterBranch ?? getCircuitConverterPrimaryBranch(circuit, device))?.endpointIds ?? []
  )
  const branchOrder = new Map<string, number>()
  let endpointOrder = 0
  for (const branch of circuit.branches ?? []) {
    for (const endpointId of branch.endpointIds) branchOrder.set(endpointId, endpointOrder++)
  }

  const segments: SupplyMetadataCalloutSegment[] = []
  const symbolRects: SupplyMetadataCalloutRect[] = []
  const leaderClipRectByTargetId = new Map<string, SupplyMetadataCalloutRect>()
  const endpointCandidates = Array.from({ length: count }).flatMap((_, outputIndex) => {
    const port = geometry.dcPorts[outputIndex]!
    const rowY = getOrdinaryCircuitConverterOutputRowY(device, anchor.y, outputIndex)
    const endpoints = circuit.endpoints
      .filter(
        (endpoint) =>
          (endpoint.converterDcConnection?.converterId === device.id &&
            endpoint.converterDcConnection.connectionIndex === outputIndex) ||
          (outputIndex === 0 && primaryIds.has(endpoint.id) && !endpoint.converterDcConnection)
      )
      .sort(
        (left, right) =>
          (branchOrder.get(left.id) ?? circuit.endpoints.indexOf(left)) -
          (branchOrder.get(right.id) ?? circuit.endpoints.indexOf(right))
      )
    const offsets = getEndpointXOffsets(
      endpoints,
      CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD,
      endpointSpacing,
      applianceAfterSocketGap
    )
    const positions = endpoints.map((endpoint, endpointIndex) => ({
      endpoint,
      x:
        endpoints.length === 1
          ? port.x
          : port.x + (offsets[endpointIndex] ?? CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD),
      y: rowY,
      endpointIndex,
    }))
    segments.push({ startPoint: port, endPoint: { x: port.x, y: rowY } })
    if (positions.length > 1) {
      segments.push({
        startPoint: { x: port.x, y: rowY },
        endPoint: { x: positions.at(-1)!.x, y: rowY },
      })
    }
    positions.forEach(({ endpoint, x, y }) => {
      const rect = {
        left: x - symbolSize / 2 - 4,
        top: y - symbolSize / 2 - 4,
        right: x + symbolSize / 2 + 4,
        bottom: y + symbolSize / 2 + 4,
      }
      symbolRects.push(rect)
      leaderClipRectByTargetId.set(endpoint.id, {
        left: x - symbolSize / 2 - LEADER_SYMBOL_CLEARANCE,
        top: y - symbolSize / 2 - LEADER_SYMBOL_CLEARANCE,
        right: x + symbolSize / 2 + LEADER_SYMBOL_CLEARANCE,
        bottom: y + symbolSize / 2 + LEADER_SYMBOL_CLEARANCE,
      })
    })

    return positions.flatMap(({ endpoint, x, y, endpointIndex }) => {
      const metadataItems = getMetadataItems(endpoint)
      const lines = metadataItems.map((item) => item.text)
      if (lines.length === 0) return []
      const multiplier = getEndpointMultiplier(endpoint)
      const { width, height } = getCardSize(
        applyMetadataCalloutMultiplier(metadataItems, multiplier).map((item) => item.text)
      )
      const usesRightLabel =
        endpointIndex === positions.length - 1 &&
        (endpoint.symbol === 'solar_panel' ||
          endpoint.symbol === 'battery' ||
          endpoint.symbol === 'ev')
      return [
        {
          targetId: endpoint.id,
          sharedTargetIds: [endpoint.id],
          totalMultiplier: multiplier,
          targets: [{ id: endpoint.id, x, y }],
          metadataItems,
          metadataLines: lines,
          metadataSymbol: endpoint.symbol ?? '',
          targetWidth: symbolSize,
          targetHeight: symbolSize,
          preferSide: outputIndex >= 2 && endpointIndex === positions.length - 1,
          outputIndex,
          x,
          y,
          width,
          height,
          defaultRect: usesRightLabel
            ? {
                left: x + symbolSize / 2 + 5,
                top: y - height / 2,
                right: x + symbolSize / 2 + 5 + width,
                bottom: y + height / 2,
              }
            : {
                left: x - width / 2,
                top: y + symbolSize / 2 + 5,
                right: x + width / 2,
                bottom: y + symbolSize / 2 + 5 + height,
              },
        },
      ]
    })
  })

  const metadataGroups = getMetadataCalloutGroups(
    endpointCandidates.map((candidate) => ({
      id: candidate.targetId,
      ownerId: device.id,
      symbol: candidate.metadataSymbol,
      lines: candidate.metadataLines,
      multiplier: candidate.totalMultiplier,
    }))
  )
  const groupedCandidates = [...new Set(metadataGroups.values())].map((metadataGroup) =>
    metadataGroup.targetIds.flatMap((targetId) => {
      const candidate = endpointCandidates.find((item) => item.targetId === targetId)
      return candidate ? [candidate] : []
    })
  )
  const deviceLines = getDeviceMetadataLines(device)
  const candidates = groupedCandidates.map((group) => {
    const metadataGroup = metadataGroups.get(group[0]!.targetId)!
    const owner = group[0]!
    const { width, height } = getCardSize(
      applyMetadataCalloutMultiplier(owner.metadataItems, metadataGroup.totalMultiplier).map(
        (item) => item.text
      )
    )
    if (group.length === 1) {
      return { ...owner, width, height, totalMultiplier: metadataGroup.totalMultiplier }
    }
    const x = group.reduce((total, candidate) => total + candidate.x, 0) / group.length
    const y = Math.min(...group.map((candidate) => candidate.y))
    return {
      ...owner,
      sharedTargetIds: group.map((candidate) => candidate.targetId),
      totalMultiplier: metadataGroup.totalMultiplier,
      targets: group.flatMap((candidate) => candidate.targets),
      preferSide: false,
      outputIndex: Math.min(...group.map((candidate) => candidate.outputIndex)),
      x,
      y,
      width,
      height,
      defaultRect: {
        left: x - width / 2,
        top: y - symbolSize / 2 - 5 - height,
        right: x + width / 2,
        bottom: y - symbolSize / 2 - 5,
      },
    }
  })
  if (deviceLines.length > 0) {
    const { width, height } = getCardSize(deviceLines)
    const deviceRect = {
      left: geometry.center.x - geometry.width / 2 - 4,
      top: geometry.center.y - symbolSize / 2 - 4,
      right: geometry.center.x + geometry.width / 2 + 4,
      bottom: geometry.center.y + symbolSize / 2 + 4,
    }
    symbolRects.push(deviceRect)
    leaderClipRectByTargetId.set(device.id, {
      left: geometry.center.x - geometry.width / 2 - LEADER_SYMBOL_CLEARANCE,
      top: geometry.center.y - symbolSize / 2 - LEADER_SYMBOL_CLEARANCE,
      right: geometry.center.x + geometry.width / 2 + LEADER_SYMBOL_CLEARANCE,
      bottom: geometry.center.y + symbolSize / 2 + LEADER_SYMBOL_CLEARANCE,
    })
    candidates.push({
      targetId: device.id,
      sharedTargetIds: [device.id],
      totalMultiplier: 1,
      targets: [{ id: device.id, x: geometry.center.x, y: geometry.center.y }],
      metadataLines: deviceLines,
      metadataItems: deviceLines.map((text) => ({ key: '', text })),
      metadataSymbol: device.symbol ?? '',
      targetWidth: geometry.width,
      targetHeight: symbolSize,
      preferSide: true,
      outputIndex: count,
      x: geometry.center.x,
      y: geometry.center.y,
      width,
      height,
      defaultRect: {
        left: geometry.center.x + geometry.width / 2 + 5,
        top: geometry.center.y - height / 2,
        right: geometry.center.x + geometry.width / 2 + 5 + width,
        bottom: geometry.center.y + height / 2,
      },
    })
  }

  const placements = getSupplyMetadataCalloutGroupPlacements({
    items: candidates.map((candidate) => ({
      id: candidate.targetId,
      symbolPosition: { x: candidate.x, y: candidate.y },
      width: candidate.width,
      height: candidate.height,
      placement: 'top' as const,
    })),
    segments,
    symbolRects,
    packRows: false,
    preferRightNudges: true,
  })

  // The later output columns are visually read from left to right. Place A3/A4
  // as true side cards, close to and vertically centered on their symbols.
  // Search nearby Y positions before moving farther right; the circuit envelope
  // consumes the chosen rectangles and moves neighboring trunks out of the way.
  const occupiedCardRects: SupplyMetadataCalloutRect[] = []
  for (const candidate of candidates) {
    const placement = placements.get(candidate.targetId)
    if (!placement) continue
    if (candidate.preferSide) {
      const sideX = candidate.targetWidth / 2 + 4
      const centeredY = -candidate.height / 2
      const staggerY = candidate.targetId === device.id ? 0 : (candidate.outputIndex - 2) * 6
      const yOffsets = [staggerY, staggerY + 12, staggerY - 12, staggerY + 24, staggerY - 24]
      const xOffsets = [0, 12, 24, 36, 48]
      const nearbyCandidates = xOffsets.flatMap((xOffset) =>
        yOffsets.map((yOffset) => ({ x: sideX + xOffset, y: centeredY + yOffset }))
      )
      const chosen =
        nearbyCandidates.find((position) => {
          const rect = {
            left: candidate.x + position.x,
            top: candidate.y + position.y,
            right: candidate.x + position.x + candidate.width,
            bottom: candidate.y + position.y + candidate.height,
          }
          return (
            !symbolRects.some((symbolRect) => rectsOverlap(rect, symbolRect)) &&
            !segments.some((segment) => segmentOverlapsRect(segment, rect, 2)) &&
            !occupiedCardRects.some((cardRect) =>
              rectsOverlap(rect, cardRect, CONVERTER_METADATA_CARD_GAP)
            )
          )
        }) ?? nearbyCandidates.at(-1)!
      placement.x = chosen.x
      placement.y = chosen.y
      placement.rect = {
        left: candidate.x + chosen.x,
        top: candidate.y + chosen.y,
        right: candidate.x + chosen.x + candidate.width,
        bottom: candidate.y + chosen.y + candidate.height,
      }
    }
    occupiedCardRects.push(placement.rect)
  }

  return new Map(
    candidates.flatMap((candidate) => {
      const placement = placements.get(candidate.targetId)
      if (!placement) return []
      const owner = candidate.targets[0] as MetadataTarget
      const sharedCardAnchor =
        candidate.targets.length > 1
          ? getSharedCardAnchor(
              placement.rect,
              candidate.targets,
              candidate.targetWidth,
              candidate.targetHeight
            )
          : null
      const absoluteLeaderSegments = candidate.targets.flatMap((target: MetadataTarget) => {
        let absoluteLeader: [number, number, number, number]
        if (sharedCardAnchor) {
          const symbolAnchor = getSymbolAnchors(
            target,
            candidate.targetWidth,
            candidate.targetHeight
          ).reduce((closest, anchor) => {
            const distance =
              (sharedCardAnchor.x - anchor.x) ** 2 + (sharedCardAnchor.y - anchor.y) ** 2
            const closestDistance =
              (sharedCardAnchor.x - closest.x) ** 2 + (sharedCardAnchor.y - closest.y) ** 2
            return distance < closestDistance ? anchor : closest
          })
          absoluteLeader = [sharedCardAnchor.x, sharedCardAnchor.y, symbolAnchor.x, symbolAnchor.y]
        } else {
          const targetRelativePlacement = {
            x: placement.rect.left - target.x,
            y: placement.rect.top - target.y,
          }
          const localLeader = getSupplyMetadataCalloutLeaderPoints({
            placement: targetRelativePlacement,
            width: candidate.width,
            height: candidate.height,
            symbolWidth: candidate.targetWidth,
            symbolHeight: candidate.targetHeight,
            placementKind: 'top',
            adaptiveAnchors: true,
          })
          absoluteLeader = [
            target.x + localLeader[0],
            target.y + localLeader[1],
            target.x + localLeader[2],
            target.y + localLeader[3],
          ]
        }
        const clippingRects = [...leaderClipRectByTargetId]
          .filter(([id]) => id !== target.id)
          .map(([, rect]) => rect)
        return clipCircuitConverterMetadataLeaderBehindRects(absoluteLeader, clippingRects)
      })
      const leaderSegments = absoluteLeaderSegments.map(
        (segment): [number, number, number, number] => [
          segment[0] - owner.x,
          segment[1] - owner.y,
          segment[2] - owner.x,
          segment[3] - owner.y,
        ]
      )
      const leaderPoints = leaderSegments[0] ?? [0, 0, 0, 0]
      return [
        [
          candidate.targetId,
          {
            targetId: candidate.targetId,
            sharedTargetIds: candidate.sharedTargetIds,
            totalMultiplier: candidate.totalMultiplier,
            x: placement.rect.left - owner.x,
            y: placement.rect.top - owner.y,
            width: candidate.width,
            height: candidate.height,
            rect: placement.rect,
            leaderPoints,
            leaderSegments,
          },
        ] as const,
      ]
    })
  )
}
