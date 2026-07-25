import type { TrunkDevice, WireSegment } from '@/types/schema'
import { getDomainForSymbol } from '@/lib/symbols'
import {
  getWireFireClassLabel,
  WIRE_LABEL_DISTANCE_FROM_WIRE,
  WIRE_LABEL_FONT_SIZE,
  WIRE_LABEL_LINE_GAP,
} from '@/lib/wireTextLabel'
import { getWireLengthLabel } from '@/lib/wires/wireFingerprint'
import {
  isFireClassLabelVisibleForSegment,
  isWireLabelVisibleForSegment,
  isWireLengthLabelVisibleForSegment,
} from '@/lib/wireLabelVisibility'
import { isCertificationListingVisible, type CertificationLabelSource } from '@/lib/certificationLabels'

/** Must stay in sync with `WireSegment` domain-change marker placement. */
const DOMAIN_LABEL_BASE_OFFSET_FROM_WIRE_X = 10
const DOMAIN_LABEL_EXTRA_OFFSET_WHEN_WIRE_LABEL_X = 10
const DOMAIN_LABEL_ICON_HALF_WIDTH = 11 / 2
const DOMAIN_LABEL_TEXT_WIDTH_ESTIMATE = 6

const DEFAULT_SYMBOL_HALF_WIDTH = 10
const DEFAULT_OFFSET_FROM_SYMBOL = 5
const LABEL_GAP_PX = 2
/** Scale computed reserve — full wire-width math over-estimates horizontal clearance for −90° labels. */
const CERTIFICATION_EXTRA_OFFSET_SCALE = 0.6

export function findOutboundVerticalWireFromDevice(
  deviceId: string,
  wireSegments: WireSegment[],
): WireSegment | undefined {
  return wireSegments.find(
    (ws) =>
      ws.type === 'vertical' &&
      ws.fromElementId === deviceId &&
      ws.startPoint.x === ws.endPoint.x,
  )
}

export function shouldShowDomainChangeLabelOnWire(
  device: Pick<TrunkDevice, 'symbol' | 'showDomainChangeLabel'>,
  wireSegment: WireSegment,
): boolean {
  if (device.showDomainChangeLabel === false) return false
  if (wireSegment.type !== 'vertical') return false
  const domainInfo = getDomainForSymbol(device.symbol)
  return domainInfo.inputDomain !== domainInfo.outputDomain
}

function getDomainChangeLabelRightEdgePx(wireLabelVisible: boolean): number {
  const domainLabelOffsetX = wireLabelVisible ? DOMAIN_LABEL_EXTRA_OFFSET_WHEN_WIRE_LABEL_X : 0
  const domainLabelX = DOMAIN_LABEL_BASE_OFFSET_FROM_WIRE_X + domainLabelOffsetX
  return domainLabelX + DOMAIN_LABEL_ICON_HALF_WIDTH + DOMAIN_LABEL_TEXT_WIDTH_ESTIMATE
}

function getWireLabelRightEdgePx(wireSegment: WireSegment): number {
  if (!isWireLabelVisibleForSegment(wireSegment)) return 0
  // Wire labels on vertical segments use rotation −90°; horizontal extent ≈ font size, not string width.
  const fireClassText = isFireClassLabelVisibleForSegment(wireSegment)
    ? getWireFireClassLabel(wireSegment.cable)
    : undefined
  const wireLengthText = isWireLengthLabelVisibleForSegment(wireSegment)
    ? getWireLengthLabel(wireSegment)
    : undefined
  const lineCount = 1 + (fireClassText ? 1 : 0) + (wireLengthText ? 1 : 0)
  const horizontalExtent =
    lineCount * WIRE_LABEL_FONT_SIZE + Math.max(0, lineCount - 1) * WIRE_LABEL_LINE_GAP
  return WIRE_LABEL_DISTANCE_FROM_WIRE + horizontalExtent
}

function isConversionCertificationSymbol(symbol: string | undefined): boolean {
  return symbol === 'inverter' || symbol === 'rectifier'
}

/**
 * Extra distance (px) to add to `SymbolTextLabels.offsetFromSymbol` on the right of a conversion
 * trunk/endpoint symbol so certification lines sit clear of AC/DC and wire-property labels on the
 * outgoing vertical wire.
 */
export function getCertificationSideLabelExtraOffsetPx(
  device: Pick<TrunkDevice, 'id' | 'symbol' | 'showDomainChangeLabel'> & CertificationLabelSource,
  wireSegments: WireSegment[],
  _fontFamily: string,
  options?: {
    symbolHalfWidth?: number
    baseOffsetFromSymbol?: number
  },
): number {
  if (!isConversionCertificationSymbol(device.symbol)) return 0
  if (!isCertificationListingVisible(device.symbolLabelDisplay)) return 0

  const wire = findOutboundVerticalWireFromDevice(device.id, wireSegments)
  if (!wire) return 0

  let obstructionRight = 0

  if (shouldShowDomainChangeLabelOnWire(device, wire)) {
    const wireLabelVisible = isWireLabelVisibleForSegment(wire)
    obstructionRight = Math.max(
      obstructionRight,
      getDomainChangeLabelRightEdgePx(wireLabelVisible),
    )
  }

  obstructionRight = Math.max(obstructionRight, getWireLabelRightEdgePx(wire))

  if (obstructionRight <= 0) return 0

  const symbolHalfWidth = options?.symbolHalfWidth ?? DEFAULT_SYMBOL_HALF_WIDTH
  const baseOffsetFromSymbol = options?.baseOffsetFromSymbol ?? DEFAULT_OFFSET_FROM_SYMBOL
  const defaultCertStart = symbolHalfWidth + baseOffsetFromSymbol
  const rawExtra = obstructionRight - defaultCertStart + LABEL_GAP_PX

  return Math.max(0, Math.ceil(rawExtra * CERTIFICATION_EXTRA_OFFSET_SCALE))
}
