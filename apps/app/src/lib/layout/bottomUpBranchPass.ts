import type { Circuit, Panel } from '@/types/schema'
import { getCircuitBranches } from './endpointChains'
import type { BranchLayout, TrunkLayout } from './wireSegments'
import { calculateBranchWidth } from './bottomUpBranchWidths'
import {
  getVisibleConversionLabelParts,
  getVisibleEndpointNoteText,
} from '@/lib/conversionLabels'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { countSymbolLabelVisualLines } from '@/lib/symbolLabelMetrics'
import { getEndpointBranchLabelPrefix } from '@/lib/eendraad/automaticEndpointBranchNaming'

export interface BranchPassConstants {
  BRANCH_LEAD_IN: number
  BRANCH_START_OFFSET: number
  ENDPOINT_BRANCH_SPACING: number
  ENDPOINT_HORIZONTAL_SPACING: number
  APPLIANCE_AFTER_SOCKET_GAP: number
  MCB_Y_OFFSET: number
  RCD_TRUNK_OFFSET: number
  SECONDARY_BUS_ABOVE_ENDPOINTS_GAP: number
  TRUNK_DEVICE_MCB_GAP: number
  TRUNK_DEVICE_SPACING: number
  SYMBOL_SIZE: number
  PROTECTION_WIDTH: number
  DOMOTICA_MIN_ENDPOINT_OUTPUTS: number
  DOMOTICA_MAX_ENDPOINT_OUTPUTS: number
  DOMOTICA_OUTPUT_SPACING: number
}

export interface CircuitLayoutForBranches {
  circuit: Circuit
  parentRcd: { id: string } | null
  parentCircuit: Circuit | null
  x: number
  leftReserve: number
}

export interface BranchLayoutPassResult {
  branches: BranchLayout[]
  secondaryBusYByCircuitId: Map<string, number>
}

const NESTED_BRANCH_LABEL_CLEARANCE = 10
const ENDPOINT_LABEL_LINE_HEIGHT = 10
const ENDPOINT_LABEL_FIXED_VERTICAL_CLEARANCE = 25

function endpointUsesRightSideLabel(endpoint: Circuit['endpoints'][number], isBranchEnd: boolean) {
  return (
    isBranchEnd &&
    (endpoint.symbol === 'solar_panel' ||
      endpoint.symbol === 'battery' ||
      endpoint.symbol === 'ev')
  )
}

export function getBranchBottomLabelHeight(branchEndpoints: Circuit['endpoints']): number {
  let maximumVisualLines = 0

  branchEndpoints.forEach((endpoint, index) => {
    if (endpointUsesRightSideLabel(endpoint, index === branchEndpoints.length - 1)) return

    const texts = [
      ...getVisibleConversionLabelParts(endpoint).map((part) => part.text),
      ...getVisibleCertificationLabelParts(endpoint).map((part) => part.text),
      getVisibleEndpointNoteText(endpoint),
    ].filter((text) => text.length > 0)
    const visualLines = texts.reduce(
      (total, text) => total + countSymbolLabelVisualLines(text),
      0
    )
    maximumVisualLines = Math.max(maximumVisualLines, visualLines)
  })

  return maximumVisualLines * ENDPOINT_LABEL_LINE_HEIGHT
}

function getSequentialBranchLabelFallback(circuit: Circuit, branchIndex: number): string {
  const prefix = getEndpointBranchLabelPrefix(circuit)
  return prefix ? `${prefix}${branchIndex + 1}` : ''
}

export function buildBranchCircuitMap(panel?: Panel): Map<string, Circuit> {
  const circuitMap = new Map<string, Circuit>()
  if (!panel) return circuitMap
  for (const circuit of panel.circuits) {
    circuitMap.set(circuit.id, circuit)
  }
  for (const protection of panel.protections) {
    for (const circuit of protection.circuits ?? []) {
      if (!circuitMap.has(circuit.id)) circuitMap.set(circuit.id, circuit)
    }
  }
  return circuitMap
}

export function resolveBranchSubCircuits(
  circuit: Circuit,
  circuitMap: Map<string, Circuit>
): Circuit[] {
  if (!circuit.subCircuitIds || circuit.subCircuitIds.length === 0) return []
  return circuit.subCircuitIds
    .map((id) => circuitMap.get(id))
    .filter((c): c is Circuit => c !== undefined)
}

export function getBranchProtectionAnchorOffset(
  leftReserve: number,
  constants: Pick<BranchPassConstants, 'PROTECTION_WIDTH' | 'SYMBOL_SIZE'>
): number {
  const baseWidth = Math.max(constants.PROTECTION_WIDTH, constants.SYMBOL_SIZE)
  return leftReserve + baseWidth / 2
}

export function getBranchStartX(
  circuitLayout: Pick<CircuitLayoutForBranches, 'x' | 'leftReserve'>,
  constants: Pick<BranchPassConstants, 'PROTECTION_WIDTH' | 'SYMBOL_SIZE'>
): number {
  return circuitLayout.x + getBranchProtectionAnchorOffset(circuitLayout.leftReserve, constants)
}

export function calculateFirstBranchY(
  circuitLayout: Pick<CircuitLayoutForBranches, 'circuit' | 'parentRcd'>,
  startY: number,
  constants: Pick<
    BranchPassConstants,
    | 'MCB_Y_OFFSET'
    | 'TRUNK_DEVICE_MCB_GAP'
    | 'TRUNK_DEVICE_SPACING'
    | 'SYMBOL_SIZE'
    | 'BRANCH_START_OFFSET'
  >
): number {
  const mcbStartY = circuitLayout.parentRcd ? startY - constants.MCB_Y_OFFSET : startY
  const trunkDevicesBeforeBranches = (circuitLayout.circuit.trunkDevices || []).filter(
    (d) => d.trunkPosition === 0
  ).length
  return trunkDevicesBeforeBranches > 0
    ? mcbStartY -
        constants.TRUNK_DEVICE_MCB_GAP -
        (trunkDevicesBeforeBranches - 1) *
          (constants.TRUNK_DEVICE_SPACING + constants.SYMBOL_SIZE) -
        constants.BRANCH_START_OFFSET
    : mcbStartY - constants.BRANCH_START_OFFSET
}

function getNonPanelEndpoints(circuit: Circuit) {
  return circuit.endpoints.filter((e) => e.symbol !== 'panel_distribution')
}

function createEmptyBranch(
  circuit: Circuit,
  startX: number,
  startY: number,
  branchY: number
): BranchLayout {
  return {
    id: `branch-${circuit.id}-empty`,
    circuitId: circuit.id,
    label: '',
    trunkX: startX,
    trunkY: startY,
    branchX: startX,
    branchY,
    branchWidth: 0,
    endpoints: [],
    isStraight: false,
  }
}

function getDomoticaExtraRows(
  branchEndpoints: ReturnType<typeof getCircuitBranches>[number],
  constants: Pick<
    BranchPassConstants,
    'DOMOTICA_MIN_ENDPOINT_OUTPUTS' | 'DOMOTICA_MAX_ENDPOINT_OUTPUTS'
  >
): number {
  const domotica = branchEndpoints.find((ep) => ep.symbol === 'domotica' && !ep.domoticaChildProps)
  if (!domotica) return 0
  const endpointCount = Math.max(
    constants.DOMOTICA_MIN_ENDPOINT_OUTPUTS,
    Math.min(
      constants.DOMOTICA_MAX_ENDPOINT_OUTPUTS,
      Math.trunc(domotica.domoticaProps?.endpointCount ?? constants.DOMOTICA_MIN_ENDPOINT_OUTPUTS)
    )
  )
  return Math.max(0, endpointCount - 1)
}

function createEndpointBranchRows(
  circuit: Circuit,
  startX: number,
  startY: number,
  firstBranchY: number,
  constants: BranchPassConstants,
  nestedBranchLabelClearance: number
): BranchLayout[] {
  const endpointBranches = getCircuitBranches(circuit)
  const storedBranches = circuit.branches ?? []
  const result: BranchLayout[] = []
  let domoticaVerticalReserve = 0
  let labelVerticalReserve = 0

  endpointBranches.forEach((branchEndpoints, branchIndex) => {
    const trunkDevicesBetween = (circuit.trunkDevices || []).filter(
      (d) => d.trunkPosition > 0 && d.trunkPosition <= branchIndex
    ).length
    const interBranchTrunkDeviceOffset = trunkDevicesBetween * constants.TRUNK_DEVICE_SPACING
    const availableLabelHeight =
      (branchIndex === 0
        ? constants.BRANCH_START_OFFSET
        : constants.ENDPOINT_BRANCH_SPACING) - ENDPOINT_LABEL_FIXED_VERTICAL_CLEARANCE
    labelVerticalReserve += Math.max(
      0,
      getBranchBottomLabelHeight(branchEndpoints) - availableLabelHeight
    )
    let branchY =
      firstBranchY -
      branchIndex * constants.ENDPOINT_BRANCH_SPACING -
      interBranchTrunkDeviceOffset -
      domoticaVerticalReserve -
      labelVerticalReserve

    if ((circuit.trunkDevices || []).length === 0 && branchIndex === 0) {
      branchY -= nestedBranchLabelClearance
    }

    const storedBranch = storedBranches[branchIndex]
    const storedLabel = storedBranch?.label?.trim() ?? ''
    const storedLabelIsDuplicate =
      storedLabel.length > 0 && result.some((existing) => existing.label === storedLabel)
    const branchLabel =
      (!storedLabelIsDuplicate ? storedLabel : '') ||
      getSequentialBranchLabelFallback(circuit, branchIndex) ||
      branchEndpoints.find((ep) => ep.label)?.label ||
      ''
    result.push({
      id: `branch-${circuit.id}-${branchIndex}`,
      circuitId: circuit.id,
      label: branchLabel,
      trunkX: startX,
      trunkY: startY,
      branchX: startX,
      branchY,
      branchWidth: calculateBranchWidth(
        branchEndpoints,
        constants.BRANCH_LEAD_IN,
        constants.ENDPOINT_HORIZONTAL_SPACING,
        constants.APPLIANCE_AFTER_SOCKET_GAP
      ),
      endpoints: branchEndpoints,
      isStraight: false,
    })

    domoticaVerticalReserve +=
      getDomoticaExtraRows(branchEndpoints, constants) * constants.DOMOTICA_OUTPUT_SPACING
  })

  return result
}

function getTopmostBranchY(branches: BranchLayout[], circuitId: string, fallbackY: number): number {
  const circuitBranches = branches.filter((b) => b.circuitId === circuitId)
  return circuitBranches.length > 0 ? Math.min(...circuitBranches.map((b) => b.branchY)) : fallbackY
}

function processNestedCircuitBranches(
  immediateParentCircuit: Circuit,
  nestedCircuits: Circuit[],
  parentWireEndY: number,
  context: {
    circuitLayouts: CircuitLayoutForBranches[]
    circuitMap: Map<string, Circuit>
    constants: BranchPassConstants
    branches: BranchLayout[]
  }
): void {
  const { circuitLayouts, circuitMap, constants, branches } = context
  const immediateParentLayout = circuitLayouts.find(
    (cl) => cl.circuit.id === immediateParentCircuit.id
  )
  const immediateParentAnchorX = immediateParentLayout
    ? getBranchStartX(immediateParentLayout, constants)
    : 0
  const singleNestedUnderImmediateParent =
    resolveBranchSubCircuits(immediateParentCircuit, circuitMap).length === 1

  nestedCircuits.forEach((nestedCircuit) => {
    const nestedCircuitLayout = circuitLayouts.find((cl) => cl.circuit.id === nestedCircuit.id)
    const nestedMcbY = parentWireEndY - constants.MCB_Y_OFFSET
    const nestedStartX =
      singleNestedUnderImmediateParent &&
      nestedCircuitLayout &&
      immediateParentLayout &&
      nestedCircuitLayout.x === immediateParentLayout.x
        ? immediateParentAnchorX
        : nestedCircuitLayout
          ? getBranchStartX(nestedCircuitLayout, constants)
          : immediateParentAnchorX
    const nestedFirstBranchY = calculateFirstBranchY(
      nestedCircuitLayout ?? { circuit: nestedCircuit, parentRcd: null },
      parentWireEndY,
      constants
    )

    if (getNonPanelEndpoints(nestedCircuit).length === 0) {
      branches.push(createEmptyBranch(nestedCircuit, nestedStartX, nestedMcbY, nestedFirstBranchY))
    } else {
      branches.push(
        ...createEndpointBranchRows(
          nestedCircuit,
          nestedStartX,
          nestedMcbY,
          nestedFirstBranchY,
          constants,
          NESTED_BRANCH_LABEL_CLEARANCE
        )
      )
    }

    const deeperNestedCircuits = resolveBranchSubCircuits(nestedCircuit, circuitMap)
    if (deeperNestedCircuits.length > 0) {
      processNestedCircuitBranches(
        nestedCircuit,
        deeperNestedCircuits,
        getTopmostBranchY(branches, nestedCircuit.id, nestedMcbY),
        context
      )
    }
  })
}

export function calculateBranchLayoutPass(
  circuitLayouts: CircuitLayoutForBranches[],
  trunks: TrunkLayout[],
  mainBusY: number,
  panel: Panel | undefined,
  constants: BranchPassConstants
): BranchLayoutPassResult {
  const branches: BranchLayout[] = []
  const secondaryBusYByCircuitId = new Map<string, number>()
  const circuitMap = buildBranchCircuitMap(panel)

  for (const circuitLayout of circuitLayouts) {
    if (circuitLayout.parentCircuit) continue

    const circuit = circuitLayout.circuit
    const endpointBranches = getCircuitBranches(circuit)
    const nestedCircuits = resolveBranchSubCircuits(circuit, circuitMap)
    const startX = getBranchStartX(circuitLayout, constants)
    const trunk = circuitLayout.parentRcd
      ? trunks.find((t) => t.protectionId === circuitLayout.parentRcd!.id)
      : undefined
    const startY = circuitLayout.parentRcd
      ? (trunk?.y ?? mainBusY - constants.RCD_TRUNK_OFFSET)
      : mainBusY - constants.MCB_Y_OFFSET
    const firstBranchY = calculateFirstBranchY(circuitLayout, startY, constants)

    if (getNonPanelEndpoints(circuit).length === 0) {
      branches.push(createEmptyBranch(circuit, startX, startY, firstBranchY))
    } else {
      branches.push(
        ...createEndpointBranchRows(circuit, startX, startY, firstBranchY, constants, 0)
      )
    }

    if (nestedCircuits.length === 0) continue

    const hasParentEndpointBranches = endpointBranches.length > 0
    if (hasParentEndpointBranches) {
      const lastBranchY =
        firstBranchY - (endpointBranches.length - 1) * constants.ENDPOINT_BRANCH_SPACING
      secondaryBusYByCircuitId.set(
        circuit.id,
        lastBranchY - constants.SECONDARY_BUS_ABOVE_ENDPOINTS_GAP
      )
    } else if (nestedCircuits.some((sc) => getNonPanelEndpoints(sc).length > 0)) {
      secondaryBusYByCircuitId.set(circuit.id, startY)
    }

    const topmostBranchY = getTopmostBranchY(branches, circuit.id, startY)
    const secondaryBusY = secondaryBusYByCircuitId.get(circuit.id)
    const parentWireEndY =
      hasParentEndpointBranches && secondaryBusY != null ? secondaryBusY : topmostBranchY

    processNestedCircuitBranches(circuit, nestedCircuits, parentWireEndY, {
      circuitLayouts,
      circuitMap,
      constants,
      branches,
    })
  }

  return { branches, secondaryBusYByCircuitId }
}
