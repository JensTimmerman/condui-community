import { getSocketExtraWidth } from '@/components/canvas/eendraad/canvasSymbols'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { getVisibleConversionLabelParts, getVisibleEndpointNoteText } from '@/lib/conversionLabels'
import { getProtectionOneWireLabelLines } from '@/lib/protectionLabels'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'
import type { Circuit, Endpoint, ProtectionDevice, TrunkDevice } from '@/types/schema'
import { getEndpointMultiplier } from '@/utils/endpointMultipliers'
import { getSupplyDeviceMultiplier } from '@/utils/inverterMultipliers'
import { calculateBranchWidth, getEndpointXOffsets } from './bottomUpBranchWidths'
import { getCircuitBranches } from './endpointChains'
import {
  getCircuitNotesPaintBounds,
} from './circuitNoteMetrics'

export interface HorizontalEnvelope {
  /** Painted extent left of the circuit trunk anchor. */
  left: number
  /** Painted extent right of the circuit trunk anchor. */
  right: number
}

export interface CircuitLayoutEnvelope extends HorizontalEnvelope {
  /** Child trunk offsets relative to this circuit's trunk, in secondary-bus order. */
  nestedAnchorOffsets: Map<string, number>
}

export interface CircuitEnvelopeConfig {
  symbolSize: number
  protectionWidth: number
  branchLeadIn: number
  endpointSpacing: number
  applianceAfterSocketGap: number
  protectionLabelOffset: number
  spdProtectionLabelOffset: number
  protectionTechnicalLabelOffset: number
  secondaryBusPanelColumnWidth: number
  nestedGutter: number
  circuitNotesOrientation: 'horizontal' | 'vertical'
}

const ENDPOINT_LABEL_FONT_SIZE = 8
const PROTECTION_LABEL_FONT_SIZE = 11
const PROTECTION_TECHNICAL_LABEL_FONT_SIZE = 10
const TRUNK_DEVICE_LABEL_FONT_SIZE = 10
const LABEL_OFFSET_FROM_SYMBOL = 5
const BRANCH_LABEL_RIGHT_OFFSET = 20
const LABEL_SAFETY = 2
const CIRCUIT_LABEL_MAX_WIDTH = 220
const LABEL_FONT_FAMILY = 'Figtree'

function estimateTextWidth(text: string, fontSize: number): number {
  return measureSymbolLabelTextWidth(text, LABEL_FONT_FAMILY, fontSize)
}

function estimateCircuitLabelWidth(text: string): number {
  return Math.min(CIRCUIT_LABEL_MAX_WIDTH, estimateTextWidth(text, PROTECTION_LABEL_FONT_SIZE))
}

function unionEnvelope(
  envelope: HorizontalEnvelope,
  left: number,
  right: number
): HorizontalEnvelope {
  return {
    left: Math.min(envelope.left, left),
    right: Math.max(envelope.right, right),
  }
}

function getProtectionOwnEnvelope(
  circuit: Circuit,
  protection: ProtectionDevice | undefined,
  config: CircuitEnvelopeConfig
): HorizontalEnvelope {
  const halfSymbol = Math.max(config.symbolSize, config.protectionWidth) / 2
  let envelope: HorizontalEnvelope = { left: -halfSymbol, right: halfSymbol }

  if (protection && circuit.eendraadLetterVisible !== false) {
    const label = (protection.label ?? '').trim()
    if (label) {
      const right =
        protection.type === 'SPD' ? config.spdProtectionLabelOffset : config.protectionLabelOffset
      envelope = unionEnvelope(
        envelope,
        right - estimateCircuitLabelWidth(label) - LABEL_SAFETY,
        right
      )
    }
  }

  if (protection) {
    const technicalLines = getProtectionOneWireLabelLines(protection).map((line) => line.text)
    const technicalWidth = Math.max(
      0,
      ...technicalLines.map((line) => estimateTextWidth(line, PROTECTION_TECHNICAL_LABEL_FONT_SIZE))
    )
    if (technicalWidth > 0) {
      envelope = unionEnvelope(
        envelope,
        envelope.left,
        config.symbolSize / 2 + config.protectionTechnicalLabelOffset + technicalWidth
      )
    }
  }

  return envelope
}

function getEndpointLabelLines(endpoint: Endpoint): string[] {
  return [
    ...getVisibleConversionLabelParts(endpoint).map((part) => part.text),
    ...getVisibleCertificationLabelParts(endpoint).map((part) => part.text),
    getVisibleEndpointNoteText(endpoint),
  ].filter((line) => line.length > 0)
}

function getEndpointEnvelope(
  endpoint: Endpoint,
  anchorX: number,
  isBranchEnd: boolean,
  symbolSize: number
): HorizontalEnvelope {
  const halfSymbol = symbolSize / 2
  const socketExtra =
    endpoint.type === 'socket'
      ? getSocketExtraWidth(Math.max(1, endpoint.socketProps?.socketCount ?? 1))
      : 0
  const groupCenterX = anchorX + socketExtra / 2
  let envelope: HorizontalEnvelope = {
    left: anchorX - halfSymbol,
    right: anchorX + halfSymbol + socketExtra,
  }

  const multiplier = getEndpointMultiplier(endpoint)
  if (multiplier > 1) {
    const multiplierWidth = estimateTextWidth(`${multiplier}×`, 10)
    envelope = unionEnvelope(
      envelope,
      groupCenterX + halfSymbol + 3,
      groupCenterX + halfSymbol + 3 + multiplierWidth
    )
  }

  const labelLines = getEndpointLabelLines(endpoint)
  const labelWidth = Math.max(
    0,
    ...labelLines.map((line) => estimateTextWidth(line, ENDPOINT_LABEL_FONT_SIZE))
  )
  if (labelWidth === 0) return envelope

  const usesRightLabel =
    isBranchEnd &&
    (endpoint.symbol === 'solar_panel' || endpoint.symbol === 'battery' || endpoint.symbol === 'ev')
  if (usesRightLabel) {
    const labelLeft = groupCenterX + halfSymbol + LABEL_OFFSET_FROM_SYMBOL
    return unionEnvelope(envelope, labelLeft, labelLeft + labelWidth)
  }

  return unionEnvelope(envelope, groupCenterX - labelWidth / 2, groupCenterX + labelWidth / 2)
}

function getBranchLabel(circuit: Circuit, branchIndex: number, endpoints: Endpoint[]): string {
  const stored = circuit.branches?.[branchIndex]?.label?.trim()
  if (stored) return stored
  return endpoints.find((endpoint) => endpoint.label?.trim())?.label?.trim() ?? ''
}

function getBranchesEnvelope(circuit: Circuit, config: CircuitEnvelopeConfig): HorizontalEnvelope {
  let envelope: HorizontalEnvelope = { left: 0, right: 0 }
  const branches = getCircuitBranches(circuit)

  branches.forEach((endpoints, branchIndex) => {
    const branchWidth = calculateBranchWidth(
      endpoints,
      config.branchLeadIn,
      config.endpointSpacing,
      config.applianceAfterSocketGap
    )
    envelope = unionEnvelope(envelope, 0, branchWidth)

    const offsets = getEndpointXOffsets(
      endpoints,
      config.branchLeadIn,
      config.endpointSpacing,
      config.applianceAfterSocketGap
    )
    endpoints.forEach((endpoint, endpointIndex) => {
      const endpointEnvelope = getEndpointEnvelope(
        endpoint,
        offsets[endpointIndex] ?? config.branchLeadIn,
        endpointIndex === endpoints.length - 1,
        config.symbolSize
      )
      envelope = unionEnvelope(envelope, endpointEnvelope.left, endpointEnvelope.right)
    })

    const branchLabel = getBranchLabel(circuit, branchIndex, endpoints)
    if (branchLabel) {
      const labelRight = -BRANCH_LABEL_RIGHT_OFFSET
      envelope = unionEnvelope(
        envelope,
        labelRight - estimateCircuitLabelWidth(branchLabel) - LABEL_SAFETY,
        labelRight
      )
    }
  })

  return envelope
}

function getTrunkDeviceEnvelope(device: TrunkDevice, symbolSize: number): HorizontalEnvelope {
  const halfSymbol = symbolSize / 2
  let envelope: HorizontalEnvelope = { left: -halfSymbol, right: halfSymbol }
  const labelLines =
    device.type === 'protection'
      ? getProtectionOneWireLabelLines(device).map((line) => line.text)
      : [
          ...getVisibleConversionLabelParts(device).map((part) => part.text),
          ...getVisibleCertificationLabelParts(device).map((part) => part.text),
          ...(isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true) &&
          device.notes?.trim()
            ? [device.notes.trim()]
            : []),
        ]
  const labelWidth = Math.max(
    0,
    ...labelLines.map((line) => estimateTextWidth(line, TRUNK_DEVICE_LABEL_FONT_SIZE))
  )
  if (labelWidth > 0) {
    envelope = unionEnvelope(
      envelope,
      envelope.left,
      halfSymbol + LABEL_OFFSET_FROM_SYMBOL + labelWidth
    )
  }

  const multiplier = getSupplyDeviceMultiplier(device)
  if (multiplier > 1) {
    envelope = unionEnvelope(
      envelope,
      envelope.left,
      halfSymbol + 3 + estimateTextWidth(`${multiplier}×`, 10)
    )
  }
  return envelope
}

function getCircuitNotesEnvelope(
  circuit: Circuit,
  orientation: 'horizontal' | 'vertical'
): HorizontalEnvelope | null {
  if (!circuit.notes?.trim() || circuit.notesVisible === false) return null
  const bounds = getCircuitNotesPaintBounds(circuit.notes, orientation)
  return { left: bounds.left, right: bounds.right }
}

export function measureCircuitLayoutEnvelope(
  circuit: Circuit,
  circuitMap: Map<string, Circuit>,
  protectionByCircuitId: Map<string, ProtectionDevice>,
  config: CircuitEnvelopeConfig,
  hasPanelAttachment: (protection: ProtectionDevice | undefined, circuit: Circuit) => boolean,
  memo = new Map<string, CircuitLayoutEnvelope>()
): CircuitLayoutEnvelope {
  const cached = memo.get(circuit.id)
  if (cached) return cached

  let envelope = getProtectionOwnEnvelope(circuit, protectionByCircuitId.get(circuit.id), config)
  const branchEnvelope = getBranchesEnvelope(circuit, config)
  envelope = unionEnvelope(envelope, branchEnvelope.left, branchEnvelope.right)

  for (const device of circuit.trunkDevices ?? []) {
    const deviceEnvelope = getTrunkDeviceEnvelope(device, config.symbolSize)
    envelope = unionEnvelope(envelope, deviceEnvelope.left, deviceEnvelope.right)
  }

  const notesEnvelope = getCircuitNotesEnvelope(circuit, config.circuitNotesOrientation)
  if (notesEnvelope) {
    envelope = unionEnvelope(envelope, notesEnvelope.left, notesEnvelope.right)
  }

  const nestedCircuits = (circuit.subCircuitIds ?? [])
    .map((id) => circuitMap.get(id))
    .filter((candidate): candidate is Circuit => candidate !== undefined)
  const nestedAnchorOffsets = new Map<string, number>()
  if (nestedCircuits.length === 1) {
    const child = nestedCircuits[0]!
    const childEnvelope = measureCircuitLayoutEnvelope(
      child,
      circuitMap,
      protectionByCircuitId,
      config,
      hasPanelAttachment,
      memo
    )
    nestedAnchorOffsets.set(child.id, 0)
    envelope = unionEnvelope(envelope, childEnvelope.left, childEnvelope.right)
  } else if (nestedCircuits.length > 1) {
    const protection = protectionByCircuitId.get(circuit.id)
    let anchorOffset = hasPanelAttachment(protection, circuit)
      ? config.secondaryBusPanelColumnWidth
      : 0
    let previousRight: number | null = null

    nestedCircuits.forEach((child) => {
      const childEnvelope = measureCircuitLayoutEnvelope(
        child,
        circuitMap,
        protectionByCircuitId,
        config,
        hasPanelAttachment,
        memo
      )
      if (previousRight != null) {
        anchorOffset = previousRight + config.nestedGutter - childEnvelope.left
      }
      nestedAnchorOffsets.set(child.id, anchorOffset)
      envelope = unionEnvelope(
        envelope,
        anchorOffset + childEnvelope.left,
        anchorOffset + childEnvelope.right
      )
      previousRight = anchorOffset + childEnvelope.right
    })
  }

  const result: CircuitLayoutEnvelope = {
    left: envelope.left,
    right: envelope.right,
    nestedAnchorOffsets,
  }
  memo.set(circuit.id, result)
  return result
}
