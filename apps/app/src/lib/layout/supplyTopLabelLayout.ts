import { hasSupplyInlineLabels } from './supplyInlineDeviceLabels'
import type { TrunkDevice } from '@/types/schema'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import {
  solveAnchoredTopLabelCollisions,
  type AnchoredTopLabelInput,
  type AnchoredTopLabelPlacement,
} from './anchoredLabelCollision'
import { isVerticalSupplyDevice } from './supplyDeviceOrientation'

export type SupplyTopLabelKind = 'name' | 'metadata'

export interface SupplyTopLabelPlacement extends AnchoredTopLabelPlacement {
  deviceId: string
  kind: SupplyTopLabelKind
}

export interface PositionedSupplyLabelDevice {
  device: TrunkDevice
  x: number
  y: number
}

const SYMBOL_HEIGHT = 30
const OFFSET_FROM_SYMBOL = 5
const LABEL_GAP = 4
const MIN_WRAP_WIDTH = 44
const MAX_WRAP_WIDTH = 96
const NEIGHBOR_GUTTER = 8

function getMaximumLineWidth(
  current: PositionedSupplyLabelDevice,
  peers: PositionedSupplyLabelDevice[]
): number {
  const nearestDistance = Math.min(
    ...peers
      .filter((peer) => peer.device.id !== current.device.id)
      .map((peer) => Math.abs(peer.x - current.x)),
    Number.POSITIVE_INFINITY
  )
  if (!Number.isFinite(nearestDistance)) return MAX_WRAP_WIDTH
  return Math.max(MIN_WRAP_WIDTH, Math.min(MAX_WRAP_WIDTH, nearestDistance - NEIGHBOR_GUTTER))
}

function getDeviceInputs(
  positioned: PositionedSupplyLabelDevice,
  peers: PositionedSupplyLabelDevice[],
  fontFamily: string,
  notesOrientation: 'horizontal' | 'vertical'
): AnchoredTopLabelInput[] {
  const { device, x, y } = positioned
  if (device.supplyDcBusId || isVerticalSupplyDevice(device)) return []

  const maximumLineWidth = getMaximumLineWidth(positioned, peers)
  const shared = {
    anchorX: x,
    anchorY: y,
    symbolHeight: SYMBOL_HEIGHT,
    offsetFromSymbol: OFFSET_FROM_SYMBOL,
    maximumLineWidth,
    measureText: (text: string, fontSize: number) =>
      measureSymbolLabelTextWidth(text, fontFamily, fontSize),
  }
  const result: AnchoredTopLabelInput[] = []
  const name = (device.label ?? '').trim()
  const showName =
    (hasSupplyInlineLabels(device) || device.symbol === 'source_changeover') &&
    name.length > 0 &&
    isSymbolLabelVisible(device.symbolLabelDisplay, 'supplyProtectionNameLabel', true)
  if (showName) {
    result.push({
      ...shared,
      id: `${device.id}:name`,
      text: name,
      fontSize: 11,
      lineSpacing: 2,
    })
  }

  const notes = (device.notes ?? '').trim()
  const notesAreVertical = notesOrientation === 'vertical'
  const showNotes =
    notes.length > 0 &&
    !notesAreVertical &&
    isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)
  const metadataLines = [
    ...getVisibleCertificationLabelParts(device).map((part) => part.text),
    ...(showNotes ? [notes] : []),
  ]
  if (metadataLines.length > 0) {
    result.push({
      ...shared,
      id: `${device.id}:metadata`,
      text: metadataLines.join('\n'),
      fontSize: 8,
      lineSpacing: 2,
    })
  }
  return result
}

/** Shared supply-wire label layout used by both frame measurement and rendering. */
export function getSupplyTopLabelPlacements(
  devices: PositionedSupplyLabelDevice[],
  fontFamily = 'Figtree',
  notesOrientation: 'horizontal' | 'vertical' = 'horizontal'
): SupplyTopLabelPlacement[] {
  const horizontalDevices = devices.filter(
    ({ device }) => !device.supplyDcBusId && !isVerticalSupplyDevice(device)
  )
  return solveAnchoredTopLabelCollisions(
    horizontalDevices.flatMap((positioned) =>
      getDeviceInputs(positioned, horizontalDevices, fontFamily, notesOrientation)
    ),
    LABEL_GAP
  ).map((placement) => {
    const separator = placement.id.lastIndexOf(':')
    return {
      ...placement,
      deviceId: placement.id.slice(0, separator),
      kind: placement.id.slice(separator + 1) as SupplyTopLabelKind,
    }
  })
}
