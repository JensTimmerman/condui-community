import { logger } from '@/lib/logger'
/**
 * Derive wire segments from LayoutNode tree
 *
 * Walks the tree and generates wires based on parent-child connections.
 * This replaces the flat wireSegments.ts approach with a tree-based one.
 */

import { generateId } from '@/utils'
import type { LayoutNode, LayoutTree } from './layoutTree'
import type {
  WireSegment,
  Circuit,
  Panel,
  Installation,
  ElectricalDomain,
  Endpoint,
  ProtectionDevice,
} from '@/types/schema'
import { resolveSymbolPortsForWire, DEFAULT_ELECTRICAL_DOMAIN } from '@/lib/symbols'
import {
  createDefaultAcCircuitCable,
  resolveShowFireClassLabel,
  resolveShowWireLengthLabel,
} from '@/lib/wires/circuitWireDefaults'
import {
  findSectionWireOverride,
  findSectionWireOverrideWithFeederFallback,
  findSubPanelFeederWireOverride,
  getSectionRefFromWireSegment,
  type CircuitSectionRef,
} from '@/lib/wires/sectionWireOverrides'
import {
  LAYOUT_CONSTANTS,
  hasPanelAttachmentOnSecondaryBus,
  isPanelOnlySubPanelFeeder,
} from './bottomUpLayout'
import { applyWireInset } from './wireInsets'
import {
  DOMOTICA_BRANCH_LEAD,
  DOMOTICA_BOX_WIDTH,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_OUTPUT_SPACING,
} from '@/lib/domoticaLayout'
import {
  ensureInstallationFeedTopology,
  getSupplyWireHideWireLabelForRole,
} from '@/lib/feedTopology'
import {
  applySupplyWireRoleToSegment,
  cableForSupplyWireRole,
  shouldMergeSupplyCrossingWithBusDrop,
  computeSupplySeparatorX,
  resolveSupplyFeedScopeForDeviceId,
  splitHorizontalSpanAtSeparator,
  type SupplySpanEndpoint,
} from '@/lib/supplyWireCables'
import { findPanelById } from '@/lib/panel/panelTree'

const SECONDARY_BUS_REFERENCE_LABEL_INTERVAL = 4

function shouldLabelSecondaryBusSegment(segmentIndex: number, childCount: number): boolean {
  if (childCount <= SECONDARY_BUS_REFERENCE_LABEL_INTERVAL) return false
  const childNumberAtSegmentEnd = segmentIndex + 1
  return childNumberAtSegmentEnd % SECONDARY_BUS_REFERENCE_LABEL_INTERVAL === 0
}

function getCircuitDisplayLabel(circuit: Circuit, protection?: { label?: string } | null): string {
  return (protection?.label ?? '').trim() || (circuit.code ?? '').trim()
}

/** Get the symbolId from a layout node's visual (if it's a symbol) */
function getNodeSymbolId(node: LayoutNode): string | undefined {
  return node.visual?.type === 'symbol' ? node.visual.symbolId : undefined
}

function getNodeLightPointProps(node: LayoutNode): Endpoint['lightPointProps'] | undefined {
  if (node.type !== 'endpoint' || !node.domainRef) return undefined
  return (node.domainRef as Endpoint).lightPointProps
}

function applyNodeWireInset(
  point: { x: number; y: number },
  otherEnd: { x: number; y: number },
  node: LayoutNode,
): { x: number; y: number } {
  return applyWireInset(
    point,
    otherEnd,
    node.type,
    getNodeSymbolId(node),
    getNodeLightPointProps(node),
  )
}

// Conversion components that are allowed to change electrical domain along a trunk
const CONVERSION_SYMBOL_IDS = new Set(['transformer', 'rectifier', 'inverter', 'dc_dc_converter'])

/** Domain for a segment leaving the given node on a trunk, based on previous domain and conversion devices only. */
function getTrunkDomainAfterNode(
  previousDomain: typeof DEFAULT_ELECTRICAL_DOMAIN,
  node: LayoutNode | null
): typeof DEFAULT_ELECTRICAL_DOMAIN {
  if (!node) return previousDomain
  const symbolId = getNodeSymbolId(node)
  if (!symbolId || !CONVERSION_SYMBOL_IDS.has(symbolId)) {
    // Non-conversion devices (protection, energy meter, etc.) are domain agnostic
    return previousDomain
  }
  const resolved = resolveSymbolPortsForWire(symbolId, previousDomain)
  if (!resolved.matched || !resolved.oppositePortDomain) {
    return previousDomain
  }
  return resolved.oppositePortDomain
}

function getCircuitWirePropertiesForDomain(
  circuit: Circuit,
  domain: ElectricalDomain,
  sectionRef?: CircuitSectionRef | null
) {
  const domainOverride = circuit.domainWireOverrides?.[domain]
  const sectionOverride = sectionRef ? findSectionWireOverride(circuit, sectionRef) : undefined
  const wireRoute =
    sectionOverride?.wireRoute ??
    domainOverride?.wireRoute ??
    circuit.wireRoute ??
    (circuit.inWall ? 'wall' : undefined)
  return {
    cable: sectionOverride?.cable ?? domainOverride?.cable ?? circuit.cable,
    inTube: sectionOverride?.inTube ?? domainOverride?.inTube ?? circuit.inTube,
    wireRoute,
    inWall:
      sectionOverride?.inWall ??
      domainOverride?.inWall ??
      (wireRoute === 'wall' ? (circuit.inWall ?? false) : false),
    hideWireLabel:
      sectionOverride?.hideWireLabel ?? domainOverride?.hideWireLabel ?? circuit.hideWireLabel,
    showFireClassLabel: resolveShowFireClassLabel(
      sectionOverride?.showFireClassLabel ??
        domainOverride?.showFireClassLabel ??
        circuit.showFireClassLabel,
      domain,
    ),
    wireLengthM:
      sectionOverride?.wireLengthM ?? domainOverride?.wireLengthM ?? circuit.wireLengthM,
    showWireLengthLabel: resolveShowWireLengthLabel(
      sectionOverride?.showWireLengthLabel ??
        domainOverride?.showWireLengthLabel ??
        circuit.showWireLengthLabel,
    ),
  }
}

/** Same merge as {@link getCircuitWirePropertiesForDomain} when the section override was resolved externally. */
function getCircuitWirePropertiesFromResolvedOverride(
  circuit: Circuit,
  domain: ElectricalDomain,
  sectionOverride: ReturnType<typeof findSectionWireOverride>
) {
  const domainOverride = circuit.domainWireOverrides?.[domain]
  const wireRoute =
    sectionOverride?.wireRoute ??
    domainOverride?.wireRoute ??
    circuit.wireRoute ??
    (circuit.inWall ? 'wall' : undefined)
  return {
    cable: sectionOverride?.cable ?? domainOverride?.cable ?? circuit.cable,
    inTube: sectionOverride?.inTube ?? domainOverride?.inTube ?? circuit.inTube,
    wireRoute,
    inWall:
      sectionOverride?.inWall ??
      domainOverride?.inWall ??
      (wireRoute === 'wall' ? (circuit.inWall ?? false) : false),
    hideWireLabel:
      sectionOverride?.hideWireLabel ?? domainOverride?.hideWireLabel ?? circuit.hideWireLabel,
    showFireClassLabel: resolveShowFireClassLabel(
      sectionOverride?.showFireClassLabel ??
        domainOverride?.showFireClassLabel ??
        circuit.showFireClassLabel,
      domain,
    ),
    wireLengthM:
      sectionOverride?.wireLengthM ?? domainOverride?.wireLengthM ?? circuit.wireLengthM,
    showWireLengthLabel: resolveShowWireLengthLabel(
      sectionOverride?.showWireLengthLabel ??
        domainOverride?.showWireLengthLabel ??
        circuit.showWireLengthLabel,
    ),
  }
}

/**
 * Derive all wire segments from the layout tree
 */
export function deriveWires(
  tree: LayoutTree,
  panels: Panel[],
  installation?: Installation
): WireSegment[] {
  const segments: WireSegment[] = []
  if (installation) ensureInstallationFeedTopology(installation, panels)

  for (const panelNode of tree.panels) {
    const panel = findPanelById(panels, panelNode.domainId)
    if (!panel) continue

    const panelSegments = derivePanelWires(panelNode, panel, panels, installation)
    segments.push(...panelSegments)
  }

  return segments
}

/**
 * Derive wires for a single panel
 */
function derivePanelWires(
  panelNode: LayoutNode,
  panel: Panel,
  panels: Panel[],
  installation?: Installation
): WireSegment[] {
  const segments: WireSegment[] = []

  // Find supply, ground, and main bus nodes
  const supplyNode = panelNode.children.find((c) => c.type === 'supply')
  const groundNode = panelNode.children.find((c) => c.type === 'ground')
  const mainBusNode = panelNode.children.find((c) => c.type === 'busBar')

  if (!mainBusNode) return segments

  const mainBusY = mainBusNode.bounds.y + mainBusNode.bounds.height / 2
  const mainBusX = mainBusNode.bounds.x
  const mainBusWidth = mainBusNode.bounds.width

  // 1. Ground wire (vertical from ground to main bus) - only for main panels
  if (groundNode && panel.isMain) {
    const groundCable = installation?.groundCable || {
      kind: 'VOB',
      conductors: 1,
      sectionMm2: 6,
      hasPE: true,
    }

    // Find ground trunk device nodes (children of the panel, not the main bus)
    const groundTrunkDeviceNodes = panelNode.children
      .filter((c) => c.type === 'trunkDevice' && c.id?.startsWith('groundTrunkDevice-'))
      .sort((a, b) => b.bounds.y - a.bounds.y) // Sort by Y descending (bottom to top = ground to bus)

    if (groundTrunkDeviceNodes.length > 0) {
      // Ground wire with trunk devices: segments between ground → devices → bus.
      // Build waypoints on the vertical wire: ground (high Y) → devices → main bus (low Y)
      const waypoints: { y: number; deviceId?: string }[] = [
        { y: groundNode.bounds.y }, // Start at ground symbol
      ]

      // Add trunk devices as waypoints (already sorted high Y to low Y)
      for (const td of groundTrunkDeviceNodes) {
        waypoints.push({ y: td.bounds.y, deviceId: td.domainId })
      }

      waypoints.push({ y: mainBusY }) // End at main bus

      // Create wire segments between consecutive waypoints
      // Apply wire insets at the ground symbol and each trunk device
      const groundX = groundNode.bounds.x
      const allNodes = [groundNode, ...groundTrunkDeviceNodes] // index 0..n-1 match waypoints 0..n-1
      for (let i = 0; i < waypoints.length - 1; i++) {
        const from = waypoints[i]!
        const to = waypoints[i + 1]!
        const startPt = { x: groundX, y: from.y }
        const endPt = { x: groundX, y: to.y }

        // Apply inset on the "from" side (ground symbol or trunk device)
        const fromNode = allNodes[i]
        const adjustedStart = fromNode
          ? applyNodeWireInset(startPt, endPt, fromNode)
          : startPt

        // Apply inset on the "to" side (trunk device or main bus — bus has no inset)
        const toNode = allNodes[i + 1] // undefined for the last segment (→ main bus)
        const adjustedEnd = toNode
          ? applyNodeWireInset(endPt, startPt, toNode)
          : endPt

        segments.push({
          id: generateId(),
          type: 'vertical',
          startPoint: adjustedStart,
          endPoint: adjustedEnd,
          cable: groundCable,
          panelId: panel.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
          hideWireLabel: true,
          fromElementType: 'ground',
        })
      }
    } else {
      // No ground trunk devices: simple vertical wire from ground to main bus
      const groundStart = { x: groundNode.bounds.x, y: groundNode.bounds.y }
      const groundEnd = { x: groundNode.bounds.x, y: mainBusY }
      segments.push({
        id: generateId(),
        type: 'vertical',
        startPoint: applyNodeWireInset(groundStart, groundEnd, groundNode),
        endPoint: groundEnd,
        cable: groundCable,
        panelId: panel.id,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        hideWireLabel: true,
        fromElementType: 'ground',
      })
    }
  }

  // 2. Main bus wire (horizontal), split into sections between each protection/circuit
  const defaultCable = panel.protections[0]?.circuits?.[0]?.cable || {
    kind: 'XVB',
    conductors: 3,
    sectionMm2: 6,
    hasPE: true,
  }

  // Collect X positions of all RCDs/MCBs attached to the main bus.
  const connectionXs: number[] = mainBusNode.children
    .filter((child) => child.type === 'rcd' || child.type === 'mcb')
    .map((child) => child.bounds.x)
    .sort((a, b) => a - b)

  const busStartX = mainBusX
  const busEndX = mainBusX + mainBusWidth

  const waypoints: number[] = [busStartX, ...connectionXs, busEndX]

  for (let i = 0; i < waypoints.length - 1; i++) {
    const startX = waypoints[i]!
    const endX = waypoints[i + 1]!
    if (endX <= startX) continue

    segments.push({
      id: generateId(),
      type: 'mainBus',
      startPoint: { x: startX, y: mainBusY },
      endPoint: { x: endX, y: mainBusY },
      cable: defaultCable,
      panelId: panel.id,
      domain: DEFAULT_ELECTRICAL_DOMAIN,
      fromElementType: 'mainBus',
      toElementType: 'mainBus',
    })
  }

  // 3. Supply wire (vertical + optional horizontal with trunk devices)
  // For sub-panels: vertical supply wire from main bus down to parent MCB
  const parentMcbNode = panelNode.children.find((c) => c.id === 'parent-mcb')
  if (!supplyNode && parentMcbNode) {
    // Use the parent MCB's circuit cable — this is the same cable shown on the
    // main panel's circuit wire, so properties stay in sync when edited.
    const parentProtection = parentMcbNode.domainRef as ProtectionDevice | undefined
    const parentCircuit =
      (parentMcbNode.circuitIdForWires && Array.isArray(parentProtection?.circuits)
        ? parentProtection.circuits.find((c: Circuit) => c.id === parentMcbNode.circuitIdForWires)
        : undefined) ?? parentProtection?.circuits?.[0]
    const parentCircuitCable = parentCircuit?.cable
    const fallbackSupplyCable = parentCircuitCable || {
      kind: 'XVB' as const,
      conductors: 3,
      sectionMm2: 6,
      hasPE: true,
    }
    // The same physical feeder is rendered once in the source panel and once as
    // the incoming supply of the target panel. Resolve the target-side copy from
    // the source panel's protection→panel section override as well, otherwise it
    // silently falls back to Circuit.cable and validation can report a different
    // section than the wire properties editor.
    const parentFeederOverride = parentCircuit
      ? findSubPanelFeederWireOverride(
          parentCircuit,
          parentProtection?.id,
          panel.id,
          DEFAULT_ELECTRICAL_DOMAIN
        )
      : undefined
    const supplyWireProps = parentCircuit
      ? getCircuitWirePropertiesFromResolvedOverride(
          parentCircuit,
          DEFAULT_ELECTRICAL_DOMAIN,
          parentFeederOverride
        )
      : undefined
    const supplyCable = supplyWireProps?.cable ?? fallbackSupplyCable

    const subPanelSupplyDeviceNodes = panelNode.children
      .filter((c) => c.type === 'trunkDevice' && c.id?.startsWith('subpanelSupplyTrunkDevice-'))
      .sort((a, b) => b.bounds.y - a.bounds.y) // bottom -> top
    const hasLocalFeederDevice = subPanelSupplyDeviceNodes.length > 0
    const waypoints: Array<{ y: number; node?: LayoutNode; deviceId?: string }> =
      hasLocalFeederDevice
      ? [
          { y: parentMcbNode.bounds.y, node: parentMcbNode },
          ...subPanelSupplyDeviceNodes.map((node) => ({
            y: node.bounds.y,
            node,
            deviceId: node.domainId,
          })),
          { y: mainBusY },
        ]
      : [{ y: parentMcbNode.bounds.y, node: parentMcbNode }, { y: mainBusY }]
    for (let i = 0; i < waypoints.length - 1; i++) {
      const from = waypoints[i]!
      const to = waypoints[i + 1]!
      if (from.y === to.y) continue
      const startPt = { x: parentMcbNode.bounds.x, y: from.y }
      const endPt = { x: parentMcbNode.bounds.x, y: to.y }
      const fromNode = from.node
      const toNode = to.node
      const adjustedStart = fromNode
        ? applyNodeWireInset(startPt, endPt, fromNode)
        : startPt
      const adjustedEnd = toNode
        ? applyNodeWireInset(endPt, startPt, toNode)
        : endPt
      segments.push({
        id: generateId(),
        type: 'vertical',
        startPoint: adjustedStart,
        endPoint: adjustedEnd,
        cable: supplyCable,
        panelId: panel.id,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        circuitId: parentCircuit?.id,
        inTube: supplyWireProps?.inTube ?? parentCircuit?.inTube,
        wireRoute:
          supplyWireProps?.wireRoute ??
          parentCircuit?.wireRoute ??
          (parentCircuit?.inWall ? 'wall' : undefined),
        inWall: supplyWireProps?.inWall ?? false,
        hideWireLabel: supplyWireProps?.hideWireLabel ?? parentCircuit?.hideWireLabel,
        showFireClassLabel: supplyWireProps?.showFireClassLabel,
        wireLengthM: supplyWireProps?.wireLengthM,
        showWireLengthLabel: supplyWireProps?.showWireLengthLabel,
        fromElementType: 'protection',
        fromElementId: from.deviceId ?? parentProtection?.id,
        toElementType: to.deviceId ? 'protection' : undefined,
        toElementId: to.deviceId,
        isSubPanelSupply: true,
        feederProtectionId: parentProtection?.id,
      })
    }
  }

  if (supplyNode) {
    const fallbackCable = {
      kind: 'XVB' as const,
      conductors: 3,
      sectionMm2: 6,
      hasPE: true,
    }
    const downstreamCable = installation
      ? cableForSupplyWireRole(installation, panels, panel, 'downstream')
      : fallbackCable

    const supplyTrunkDeviceNodes = panelNode.children
      .filter((c) => c.type === 'trunkDevice' && c.id?.startsWith('supplyTrunkDevice-'))
      .sort((a, b) => a.bounds.x - b.bounds.x)

    const applySupplyLabelVisibility = (
      verticalSeg: WireSegment | undefined,
      mergeCrossingWithBusDrop: boolean,
    ) => {
      if (!installation || !verticalSeg) return
      const downstreamHidden = getSupplyWireHideWireLabelForRole(
        installation,
        panels,
        panel,
        'downstream',
      )
      const crossingHidden = getSupplyWireHideWireLabelForRole(
        installation,
        panels,
        panel,
        'crossing',
      )
      const upstreamHidden = getSupplyWireHideWireLabelForRole(
        installation,
        panels,
        panel,
        'upstream',
      )
      if (mergeCrossingWithBusDrop) {
        verticalSeg.supplyMergesCrossingToBus = true
        verticalSeg.hideWireLabel = downstreamHidden
      } else {
        verticalSeg.hideWireLabel = true
      }
      for (const seg of segments) {
        if (!seg.isSupplyTrunk || seg.type !== 'branch') continue
        if (seg.supplyMergedIntoBusDrop) {
          seg.hideWireLabel = true
          continue
        }
        if (seg.supplyWireRole === 'upstream') {
          seg.hideWireLabel = upstreamHidden
          continue
        }
        if (seg.supplyWireRole === 'crossing' && !mergeCrossingWithBusDrop) {
          seg.hideWireLabel = crossingHidden
          continue
        }
        if (seg.supplyWireRole === 'downstream' && !mergeCrossingWithBusDrop) {
          seg.hideWireLabel = downstreamHidden
        }
      }
    }

    const pushSupplyHorizontal = (
      supplyBendX: number,
      start: { x: number; y: number },
      end: { x: number; y: number },
      separatorX: number | null,
      fromEndpoint?: SupplySpanEndpoint,
      toEndpoint?: SupplySpanEndpoint,
      mergeCrossingWithBusDrop?: boolean,
    ) => {
      const spans = splitHorizontalSpanAtSeparator(
        start.x,
        end.x,
        separatorX,
        fromEndpoint,
        toEndpoint,
      )
      for (const span of spans) {
        const spanLeft = Math.min(span.x1, span.x2)
        const touchesBend = Math.abs(spanLeft - supplyBendX) < 1
        const mergeThisCrossing =
          mergeCrossingWithBusDrop === true &&
          span.role === 'crossing' &&
          touchesBend

        const seg: WireSegment = {
          id: generateId(),
          type: 'branch',
          startPoint: { x: span.x1, y: start.y },
          endPoint: { x: span.x2, y: end.y },
          cable: installation
            ? cableForSupplyWireRole(
                installation,
                panels,
                panel,
                mergeThisCrossing ? 'downstream' : span.role,
              )
            : fallbackCable,
          panelId: panel.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
          hideWireLabel: true,
          isSupplyTrunk: true,
          supplyWireRole: span.role,
        }
        if (mergeThisCrossing) {
          seg.supplyMergedIntoBusDrop = true
        } else if (
          span.role === 'crossing' &&
          separatorX != null &&
          mergeCrossingWithBusDrop !== true
        ) {
          seg.supplySeparatorX = separatorX
        }
        if (installation) {
          applySupplyWireRoleToSegment(
            seg,
            mergeThisCrossing ? 'downstream' : span.role,
            installation,
            panels,
            panel,
          )
        } else if (span.role !== 'downstream') {
          seg.hideWireLabel = true
        }
        segments.push(seg)
      }
    }

    if (supplyTrunkDeviceNodes.length > 0) {
      const supplyY = supplyNode.bounds.y
      const firstSupplyTrunkNode = supplyTrunkDeviceNodes[0]
      if (!firstSupplyTrunkNode) return segments
      const bendX = firstSupplyTrunkNode.bounds.x - LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING

      const devicePositions = supplyTrunkDeviceNodes.map((node) => ({
        x: node.bounds.x,
        feedScope: installation
          ? resolveSupplyFeedScopeForDeviceId(
              installation,
              panels,
              panel,
              node.domainId ?? '',
            )
          : ('shared' as const),
      }))
      const supplyEndX = supplyNode.bounds.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
      const separatorX = computeSupplySeparatorX(devicePositions, supplyEndX, bendX)
      const mergeCrossingWithBusDrop = installation
        ? shouldMergeSupplyCrossingWithBusDrop(bendX, separatorX, devicePositions)
        : false

      const vertical: WireSegment = {
        id: generateId(),
        type: 'vertical',
        startPoint: { x: bendX, y: mainBusY },
        endPoint: { x: bendX, y: supplyY },
        cable: downstreamCable,
        panelId: panel.id,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        hideWireLabel: true,
        supplyWireRole: 'downstream',
        supplyFeedScope: 'root',
      }
      if (installation) {
        applySupplyWireRoleToSegment(vertical, 'downstream', installation, panels, panel)
      }
      segments.push(vertical)

      const waypoints: { x: number; deviceId?: string }[] = [{ x: bendX }]
      for (const td of supplyTrunkDeviceNodes) {
        waypoints.push({ x: td.bounds.x, deviceId: td.domainId })
      }
      const lastSupplyTrunkNode = supplyTrunkDeviceNodes[supplyTrunkDeviceNodes.length - 1]
      if (!lastSupplyTrunkNode) return segments
      const supplyInset = applyNodeWireInset(
        { x: supplyNode.bounds.x, y: supplyY },
        { x: lastSupplyTrunkNode.bounds.x, y: supplyY },
        supplyNode,
      )
      waypoints.push({ x: supplyInset.x })

      const waypointScopes: SupplySpanEndpoint[] = ['bend']
      for (const node of supplyTrunkDeviceNodes) {
        const pos = devicePositions.find((p) => p.x === node.bounds.x)
        waypointScopes.push(pos?.feedScope ?? 'root')
      }
      waypointScopes.push('supply')

      const allSupplyNodes = [...supplyTrunkDeviceNodes]
      for (let i = 0; i < waypoints.length - 1; i++) {
        const from = waypoints[i]!
        const to = waypoints[i + 1]!
        const startPt = { x: from.x, y: supplyY }
        const endPt = { x: to.x, y: supplyY }
        const fromDevice = allSupplyNodes[i - 1]
        const toDevice = allSupplyNodes[i]
        const adjustedStart = fromDevice
          ? applyNodeWireInset(startPt, endPt, fromDevice)
          : startPt
        const adjustedEnd = toDevice
          ? applyNodeWireInset(endPt, startPt, toDevice)
          : endPt
        pushSupplyHorizontal(
          bendX,
          adjustedStart,
          adjustedEnd,
          separatorX,
          waypointScopes[i],
          waypointScopes[i + 1],
          mergeCrossingWithBusDrop,
        )
      }
      applySupplyLabelVisibility(vertical, mergeCrossingWithBusDrop)
    } else {
      const supplyY = supplyNode.bounds.y
      const bendX = supplyNode.bounds.x - LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
      const supplyEndX = supplyNode.bounds.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
      const separatorX = computeSupplySeparatorX([], supplyEndX, bendX)
      const mergeCrossingWithBusDrop = installation
        ? shouldMergeSupplyCrossingWithBusDrop(bendX, separatorX, [])
        : false

      const vertical: WireSegment = {
        id: generateId(),
        type: 'vertical',
        startPoint: { x: bendX, y: mainBusY },
        endPoint: { x: bendX, y: supplyY },
        cable: downstreamCable,
        panelId: panel.id,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        hideWireLabel: true,
        supplyWireRole: 'downstream',
        supplyFeedScope: 'root',
      }
      if (installation) {
        applySupplyWireRoleToSegment(vertical, 'downstream', installation, panels, panel)
      }
      segments.push(vertical)

      const supplyInset = applyNodeWireInset(
        { x: supplyNode.bounds.x, y: supplyY },
        { x: bendX, y: supplyY },
        supplyNode,
      )
      pushSupplyHorizontal(
        bendX,
        { x: bendX, y: supplyY },
        { x: supplyInset.x, y: supplyY },
        separatorX,
        'bend',
        'supply',
        mergeCrossingWithBusDrop,
      )
      applySupplyLabelVisibility(vertical, mergeCrossingWithBusDrop)
    }
  }

  // 4. Process main bus children (RCDs, MCBs)
  for (const child of mainBusNode.children) {
    if (child.type === 'rcd') {
      const rcdSegments = deriveRcdWires(child, panel, mainBusY)
      segments.push(...rcdSegments)
    } else if (child.type === 'mcb') {
      const mcbSegments = deriveMcbWires(child, panel, mainBusY, null)
      segments.push(...mcbSegments)
    }
  }

  // Final pass: enforce per-section overrides on all vertical circuit segments.
  for (const segment of segments) {
    if (segment.type !== 'vertical' || !segment.circuitId) continue
    const circuit = findCircuitByIdInPanel(panel, segment.circuitId)
    if (!circuit) continue
    const sectionRef = getSectionRefFromWireSegment(segment)
    const sectionOverride = findSectionWireOverride(circuit, sectionRef)
    if (!sectionOverride) continue
    if (sectionOverride.cable) segment.cable = sectionOverride.cable
    if (sectionOverride.inTube !== undefined) segment.inTube = sectionOverride.inTube
    if (sectionOverride.wireRoute !== undefined) segment.wireRoute = sectionOverride.wireRoute
    if (sectionOverride.inWall !== undefined) segment.inWall = sectionOverride.inWall
    if (sectionOverride.hideWireLabel !== undefined)
      segment.hideWireLabel = sectionOverride.hideWireLabel
    if (sectionOverride.showFireClassLabel !== undefined)
      segment.showFireClassLabel = sectionOverride.showFireClassLabel
    if (sectionOverride.wireLengthM !== undefined) segment.wireLengthM = sectionOverride.wireLengthM
    if (sectionOverride.showWireLengthLabel !== undefined)
      segment.showWireLengthLabel = sectionOverride.showWireLengthLabel
  }

  // Sync fire-class and wire-length label visibility from merged circuit wire properties.
  for (const segment of segments) {
    if (segment.type !== 'vertical' || !segment.circuitId) continue
    const circuit = findCircuitByIdInPanel(panel, segment.circuitId)
    if (!circuit) continue
    const sectionRef = getSectionRefFromWireSegment(segment)
    const wireProps = getCircuitWirePropertiesForDomain(
      circuit,
      segment.domain ?? DEFAULT_ELECTRICAL_DOMAIN,
      sectionRef,
    )
    segment.showFireClassLabel = wireProps.showFireClassLabel
    segment.wireLengthM = wireProps.wireLengthM
    segment.showWireLengthLabel = wireProps.showWireLengthLabel
  }

  // Final pass: normalize sub-panel incoming feeder tagging.
  // In some layout paths the incoming feeder can be derived through the generic
  // vertical-circuit flow, which may omit `isSubPanelSupply`. Mark it
  // consistently so validation/focus can reliably target this wire.
  const parentMcbNodeForTagging = panelNode.children.find((c) => c.id === 'parent-mcb')
  const parentProtection = parentMcbNodeForTagging?.domainRef as ProtectionDevice | undefined
  const parentProtectionId: string | undefined = parentProtection?.id
  const parentFeedCircuitId: string | undefined = parentProtection?.circuits?.[0]?.id
  if (parentProtectionId && parentFeedCircuitId) {
    for (const segment of segments) {
      if (
        segment.type === 'vertical' &&
        segment.panelId === panel.id &&
        segment.circuitId === parentFeedCircuitId &&
        segment.fromElementType === 'protection' &&
        segment.fromElementId === parentProtectionId
      ) {
        segment.isSubPanelSupply = true
        segment.feederProtectionId = parentProtectionId
      }
    }
  }

  return segments
}

/**
 * Derive wires for an RCD node
 */
function deriveRcdWires(rcdNode: LayoutNode, panel: Panel, mainBusY: number): WireSegment[] {
  const segments: WireSegment[] = []
  const rcdY = rcdNode.bounds.y
  // bounds.x IS the center of the RCD symbol (from bottomUpLayout position.x)
  const rcdX = rcdNode.bounds.x

  const protection = rcdNode.domainRef as ProtectionDevice | undefined
  const cable = protection?.circuits?.[0]?.cable || {
    kind: 'XVB',
    conductors: 3,
    sectionMm2: 6,
    hasPE: true,
  }

  // Vertical from main bus to RCD
  const busToRcd = { x: rcdX, y: mainBusY }
  const rcdPoint = { x: rcdX, y: rcdY }
  segments.push({
    id: generateId(),
    type: 'vertical',
    startPoint: busToRcd,
    endPoint: applyNodeWireInset(rcdPoint, busToRcd, rcdNode),
    cable,
    panelId: panel.id,
    domain: DEFAULT_ELECTRICAL_DOMAIN,
    fromElementType: 'mainBus',
    toElementType: 'rcd',
    toElementId: protection?.id,
  })

  // Find secondary bus (trunk) child
  const secondaryBusNode = rcdNode.children.find((c) => c.type === 'secondaryBus')
  if (secondaryBusNode) {
    const trunkY = secondaryBusNode.bounds.y

    // Vertical from RCD to trunk
    const rcdToTrunk = { x: rcdX, y: trunkY }
    segments.push({
      id: generateId(),
      type: 'vertical',
      startPoint: applyNodeWireInset({ x: rcdX, y: rcdY }, rcdToTrunk, rcdNode),
      endPoint: rcdToTrunk,
      cable,
      panelId: panel.id,
      domain: DEFAULT_ELECTRICAL_DOMAIN,
      fromElementType: 'rcd',
      fromElementId: protection?.id,
      toElementType: 'secondaryBus',
    })

    // Trunk wire (horizontal), split into sections between each MCB on the trunk
    const trunkStartX = secondaryBusNode.bounds.x
    const trunkEndX = secondaryBusNode.bounds.x + secondaryBusNode.bounds.width
    const mcbXs: number[] = secondaryBusNode.children
      .filter((child) => child.type === 'mcb')
      .map((child) => child.bounds.x)
      .sort((a, b) => a - b)
    const secondaryBusReferenceLabel = (protection?.label ?? '').trim()

    const trunkWaypoints: number[] = [trunkStartX, ...mcbXs, trunkEndX]

    for (let i = 0; i < trunkWaypoints.length - 1; i++) {
      const startX = trunkWaypoints[i]!
      const endX = trunkWaypoints[i + 1]!
      if (endX <= startX) continue

      segments.push({
        id: generateId(),
        type: 'trunk',
        startPoint: { x: startX, y: trunkY },
        endPoint: { x: endX, y: trunkY },
        cable,
        panelId: panel.id,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        fromElementType: 'rcd',
        fromElementId: protection?.id,
        ...(secondaryBusReferenceLabel ? { secondaryBusReferenceExportLabel: secondaryBusReferenceLabel } : {}),
        ...(secondaryBusReferenceLabel && shouldLabelSecondaryBusSegment(i, mcbXs.length)
          ? { secondaryBusReferenceLabel }
          : {}),
      })
    }

    // Process MCB children of secondary bus
    for (const mcbChild of secondaryBusNode.children) {
      if (mcbChild.type === 'mcb') {
        const mcbSegments = deriveMcbWires(mcbChild, panel, mainBusY, secondaryBusNode)
        segments.push(...mcbSegments)
      }
    }
  }

  return segments
}

/**
 * Derive wires for an MCB node
 */
function deriveMcbWires(
  mcbNode: LayoutNode,
  panel: Panel,
  mainBusY: number,
  parentSecondaryBus: LayoutNode | null
): WireSegment[] {
  const segments: WireSegment[] = []
  const protection = mcbNode.domainRef as ProtectionDevice | undefined
  const circuit =
    mcbNode.circuitIdForWires != null
      ? findCircuitByIdInPanel(panel, mcbNode.circuitIdForWires)
      : findCircuitForProtection(panel, protection?.id)

  if (!circuit) return segments

  const protectionConnectionSectionRef: CircuitSectionRef = {
    fromElementType: parentSecondaryBus ? 'secondaryBus' : 'mainBus',
    toElementType: 'protection',
    toElementId: protection?.id,
    domain: DEFAULT_ELECTRICAL_DOMAIN,
  }
  const defaultWireProps = getCircuitWirePropertiesForDomain(
    circuit,
    DEFAULT_ELECTRICAL_DOMAIN,
    protectionConnectionSectionRef
  )
  const cable = defaultWireProps.cable || createDefaultAcCircuitCable()

  const mcbY = mcbNode.bounds.y
  // bounds.x IS the center of the MCB symbol (from bottomUpLayout position.x = cl.x + baseWidth/2)
  const mcbX = mcbNode.bounds.x

  // Determine connection point
  // Vertical wires are always at mcbX (the center of the MCB symbol) for both start and end
  let connectFromY: number
  let connectFromType: 'mainBus' | 'secondaryBus' | 'protection' = 'mainBus'

  if (parentSecondaryBus) {
    // Connected to secondary bus (RCD trunk)
    connectFromY = parentSecondaryBus.bounds.y
    connectFromType = 'secondaryBus'
  } else {
    // Connected directly to main bus
    connectFromY = mainBusY
    connectFromType = 'mainBus'
  }

  // Vertical wire from connection point to MCB (always at mcbX for both ends)
  const connStart = { x: mcbX, y: connectFromY }
  const connEnd = { x: mcbX, y: mcbY }
  const panelOnlyFeederStub =
    (mcbNode.id.includes('-nest-') || protection?.directPanelFeeder === true) &&
    isPanelOnlySubPanelFeeder(protection, circuit)

  // Find branches, trunk devices, direct endpoint children (sub-panel symbols), and parent wire end for this circuit
  const branchNodes = mcbNode.children.filter((c) => c.type === 'branch')
  const trunkDeviceNodes = mcbNode.children
    .filter((c) => c.type === 'trunkDevice')
    .sort((a, b) => b.bounds.y - a.bounds.y) // Sort by Y descending (bottom to top = MCB to branches)
  // Sub-panel symbols sit directly on the MCB trunk (no branch)
  const directEndpointNodes = mcbNode.children.filter((c) => c.type === 'endpoint')
  const panelUsesSecondaryBusStem = hasPanelAttachmentOnSecondaryBus(protection, circuit)
  const secondaryBusEndpointNodes = panelUsesSecondaryBusStem ? directEndpointNodes : []
  const trunkEndpointNodes = panelUsesSecondaryBusStem ? [] : directEndpointNodes
  // When circuit has both endpoints and subcircuits, layout tree adds a node at secondary bus Y (above endpoints)
  const parentWireEndNodes = mcbNode.children.filter(
    (c) => c.type === 'secondaryBus' && c.id?.startsWith('parent-wire-end-')
  )

  const mergePanelOnlyFeederBusToEndpoint =
    panelOnlyFeederStub &&
    trunkEndpointNodes.length > 0 &&
    branchNodes.length === 0 &&
    trunkDeviceNodes.length === 0 &&
    parentWireEndNodes.length === 0

  if (!mergePanelOnlyFeederBusToEndpoint) {
    segments.push({
      id: generateId(),
      type: 'vertical',
      startPoint: connStart,
      endPoint: applyNodeWireInset(connEnd, connStart, mcbNode),
      cable,
      panelId: panel.id,
      domain: DEFAULT_ELECTRICAL_DOMAIN,
      fromElementType: connectFromType,
      toElementType: 'protection',
      toElementId: protection?.id,
      circuitId: circuit.id,
      inTube: defaultWireProps.inTube,
      wireRoute: defaultWireProps.wireRoute,
      inWall: defaultWireProps.inWall,
      hideWireLabel: defaultWireProps.hideWireLabel,
      ...(panelOnlyFeederStub ? { showWireLabelOnBusStub: true } : {}),
    })
  }

  let verticalWireTopY = mcbY
  if (
    branchNodes.length > 0 ||
    trunkDeviceNodes.length > 0 ||
    trunkEndpointNodes.length > 0 ||
    parentWireEndNodes.length > 0
  ) {
    // Determine the top-most real connection point on this trunk.
    // If a trunk device is top-most, continue with a short stub above it so
    // spacing matches protection-like visuals and keeps room for future inserts.
    let topmostBranchWireY: number | null = null
    if (branchNodes.length > 0) {
      const topmostBranch = branchNodes.reduce((top, branch) =>
        branch.bounds.y < top.bounds.y ? branch : top
      )
      topmostBranchWireY = topmostBranch.bounds.y + topmostBranch.bounds.height / 2
    }

    let topmostEndpointInsetY: number | null = null
    if (trunkEndpointNodes.length > 0) {
      const topmostEndpoint = trunkEndpointNodes.reduce((top, ep) =>
        ep.bounds.y < top.bounds.y ? ep : top
      )
      const epInset = applyNodeWireInset(
        { x: mcbX, y: topmostEndpoint.bounds.y },
        { x: mcbX, y: mcbY },
        topmostEndpoint,
      )
      topmostEndpointInsetY = epInset.y
    }

    const topmostDeviceY =
      trunkDeviceNodes.length > 0 ? trunkDeviceNodes[trunkDeviceNodes.length - 1]!.bounds.y : null

    const parentWireEndY = parentWireEndNodes.length > 0 ? parentWireEndNodes[0]!.bounds.y : null

    const topCandidates = [
      topmostBranchWireY,
      topmostEndpointInsetY,
      topmostDeviceY,
      parentWireEndY,
    ].filter((y): y is number => y !== null)

    if (topCandidates.length > 0) {
      const topmostContentY = Math.min(...topCandidates)
      const isTopmostTrunkDevice = topmostDeviceY !== null && topmostDeviceY === topmostContentY
      verticalWireTopY = isTopmostTrunkDevice
        ? topmostContentY - LAYOUT_CONSTANTS.BRANCH_START_OFFSET
        : topmostContentY
    }

    // Build vertical wire segments — wire passes THROUGH the trunk device center.
    // The device symbol renders on top and visually covers the wire.
    if (trunkDeviceNodes.length > 0) {
      // Collect waypoints on the vertical wire: MCB → trunk devices → top wire end
      // waypoints are sorted from MCB (high Y) to top (low Y)
      const waypoints: { y: number; deviceId?: string }[] = [
        { y: mcbY }, // Start at MCB
      ]

      // Add trunk devices as waypoints (already sorted high Y to low Y)
      for (const td of trunkDeviceNodes) {
        waypoints.push({ y: td.bounds.y, deviceId: td.domainId })
      }
      waypoints.push({ y: verticalWireTopY })

      // Create wire segments between consecutive waypoints
      // Apply wire insets at MCB and each trunk device
      // waypoint 0 = MCB, waypoints 1..n-1 = trunk devices, waypoint n = branch/endpoint
      const allTrunkNodes = [mcbNode, ...trunkDeviceNodes] // indices 0..n match waypoints 0..n
      // Domain along the trunk: start at MCB (AC by default) and let conversion devices update it.
      let currentDomain: typeof DEFAULT_ELECTRICAL_DOMAIN = DEFAULT_ELECTRICAL_DOMAIN
      // Only when the user explicitly sets hideWireLabel=true do we hide labels
      // on all trunk segments. By default (undefined/false), the first segment
      // after the protection can show a label; higher segments stay hidden.
      const hideAllWireLabels = (defaultWireProps.hideWireLabel ?? false) === true
      for (let i = 0; i < waypoints.length - 1; i++) {
        const from = waypoints[i]
        const to = waypoints[i + 1]
        if (!from || !to) continue
        const startPt = { x: mcbX, y: from.y }
        const endPt = { x: mcbX, y: to.y }

        const fromNode = allTrunkNodes[i]
        const toNode = allTrunkNodes[i + 1] // undefined for the last segment (→ branch/endpoint)
        const toEndpointRef = to.deviceId ?? toNode?.domainId

        const adjustedStart = fromNode
          ? applyNodeWireInset(startPt, endPt, fromNode)
          : startPt
        const adjustedEnd = toNode
          ? applyNodeWireInset(endPt, startPt, toNode)
          : endPt

        const segmentSectionRef: CircuitSectionRef = {
          fromElementType: i === 0 ? 'protection' : 'endpoint',
          fromElementId: from.deviceId ?? fromNode?.domainId,
          toElementType: toEndpointRef ? 'endpoint' : undefined,
          toElementId: toEndpointRef,
          domain: currentDomain,
        }
        const segmentWireProps = getCircuitWirePropertiesForDomain(
          circuit,
          currentDomain,
          segmentSectionRef
        )
        segments.push({
          id: generateId(),
          type: 'vertical',
          startPoint: adjustedStart,
          endPoint: adjustedEnd,
          cable: segmentWireProps.cable,
          panelId: panel.id,
          domain: currentDomain,
          fromElementType: i === 0 ? 'protection' : 'endpoint',
          fromElementId: from.deviceId ?? fromNode?.domainId,
          toElementId: to.deviceId ?? toNode?.domainId,
          circuitId: circuit.id,
          inTube: segmentWireProps.inTube,
          wireRoute: segmentWireProps.wireRoute,
          inWall: segmentWireProps.inWall,
          // By default, hide labels for all trunk segments. When the user
          // unchecks "Hide Wire Label" on the circuit, only the first segment
          // (directly after the protection) will show a label; the rest stay
          // hidden so there is still just a single label per circuit.
          hideWireLabel: hideAllWireLabels ? true : i === 0 ? undefined : true,
        })

        // After this segment, update domain if the next node is a conversion component
        currentDomain = getTrunkDomainAfterNode(currentDomain, toNode ?? null)
      }

      // Debug logging for suspiciously short trunk stubs above the last trunk device.
      // This helps diagnose cases where the wire above a trunk device is only a few pixels.
      if (typeof console !== 'undefined' && trunkDeviceNodes.length > 0) {
        const topDevice = trunkDeviceNodes[trunkDeviceNodes.length - 1]!
        const stubLen = Math.abs(verticalWireTopY - topDevice.bounds.y)
        if (stubLen > 0 && stubLen <= 20) {

          logger.info('[Eendraad Trunk Debug]', {
            circuitId: circuit.id,
            protectionId: protection?.id,
            panelId: panel.id,
            mcbY,
            mcbX,
            verticalWireTopY,
            topDeviceY: topDevice.bounds.y,
            stubLen,
            branchNodes: branchNodes.map((b) => ({
              id: b.id,
              y: b.bounds.y,
              height: b.bounds.height,
            })),
            parentWireEndNodes: parentWireEndNodes.map((n) => ({
              id: n.id,
              y: n.bounds.y,
              height: n.bounds.height,
            })),
            hasParentSecondaryBus: !!parentSecondaryBus,
            parentSecondaryBusY: parentSecondaryBus?.bounds.y,
          })
        }
      }
    } else if (branchNodes.length > 0) {
      // No trunk devices, has branches: vertical wire from MCB up to wire top (branch level or secondary bus when present)
      const firstBranch = branchNodes.reduce((nearest, branch) =>
        branch.bounds.y > nearest.bounds.y ? branch : nearest
      )
      const firstBranchWireY = firstBranch.bounds.y + firstBranch.bounds.height / 2
      // When parent has endpoint + subcircuits, verticalWireTopY is above the branch (secondary bus); draw wire all the way to bus
      const wireEndY = verticalWireTopY
      const mcbToBranchStart = { x: mcbX, y: mcbY }
      const mcbToBranchEnd = { x: mcbX, y: wireEndY }
      const noTrunkSectionRef: CircuitSectionRef = {
        fromElementType: 'protection',
        fromElementId: protection?.id,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
      }
      const noTrunkWireProps = getCircuitWirePropertiesForDomain(
        circuit,
        DEFAULT_ELECTRICAL_DOMAIN,
        noTrunkSectionRef
      )
      segments.push({
        id: generateId(),
        type: 'vertical',
        startPoint: applyNodeWireInset(mcbToBranchStart, mcbToBranchEnd, mcbNode),
        endPoint: mcbToBranchEnd,
        cable: noTrunkWireProps.cable,
        panelId: panel.id,
        // No trunk devices, so trunk domain stays at default (AC)
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        fromElementType: 'protection',
        fromElementId: protection?.id,
        circuitId: circuit.id,
        inTube: noTrunkWireProps.inTube,
        wireRoute: noTrunkWireProps.wireRoute,
        inWall: noTrunkWireProps.inWall,
        wireLabelEndPoint: { x: mcbX, y: firstBranchWireY },
        // This vertical is directly above the protection; by default its label
        // is shown (hideWireLabel undefined/false). When the user explicitly
        // hides labels on the circuit, we respect that here too.
        hideWireLabel: noTrunkWireProps.hideWireLabel,
      })
    } else if (trunkEndpointNodes.length > 0) {
      // No trunk devices, no branches, has direct endpoint (panel symbol):
      // Single vertical from bus→MCB stub + MCB→endpoint merged into one bus→endpoint wire for panel-only feeders;
      // otherwise from MCB straight up to the panel symbol.
      const topmostEndpoint = trunkEndpointNodes.reduce((top, ep) =>
        ep.bounds.y < top.bounds.y ? ep : top
      )

      const mcbToEpEnd = { x: mcbX, y: topmostEndpoint.bounds.y }
      const directEndpointSectionRef: CircuitSectionRef = {
        fromElementType: 'protection',
        fromElementId: protection?.id,
        toElementType: 'endpoint',
        toElementId: topmostEndpoint.domainId,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
      }

      if (mergePanelOnlyFeederBusToEndpoint) {
        const mergedEndpointRef: CircuitSectionRef = {
          fromElementType: connectFromType,
          toElementType: 'endpoint',
          toElementId: topmostEndpoint.domainId,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
        }
        const resolvedSectionOverride =
          findSubPanelFeederWireOverride(
            circuit,
            protection?.id,
            topmostEndpoint.domainId ?? '',
            DEFAULT_ELECTRICAL_DOMAIN
          ) ?? findSectionWireOverrideWithFeederFallback(circuit, mergedEndpointRef, protection?.id)
        const mergedWireProps = getCircuitWirePropertiesFromResolvedOverride(
          circuit,
          DEFAULT_ELECTRICAL_DOMAIN,
          resolvedSectionOverride
        )
        const busInsetType = connectFromType === 'mainBus' ? 'mainBus' : 'secondaryBus'
        segments.push({
          id: generateId(),
          type: 'vertical',
          startPoint: applyWireInset(connStart, mcbToEpEnd, busInsetType),
          endPoint: applyNodeWireInset(mcbToEpEnd, connStart, topmostEndpoint),
          cable: mergedWireProps.cable ?? cable,
          panelId: panel.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
          fromElementType: connectFromType,
          toElementType: 'endpoint',
          toElementId: topmostEndpoint.domainId,
          circuitId: circuit.id,
          inTube: mergedWireProps.inTube,
          wireRoute: mergedWireProps.wireRoute,
          inWall: mergedWireProps.inWall,
          hideWireLabel: mergedWireProps.hideWireLabel,
          feederProtectionId: protection?.id,
        })
      } else {
        const mcbToEpStart = { x: mcbX, y: mcbY }
        const directEndpointWireProps = getCircuitWirePropertiesForDomain(
          circuit,
          DEFAULT_ELECTRICAL_DOMAIN,
          directEndpointSectionRef
        )
        segments.push({
          id: generateId(),
          type: 'vertical',
          startPoint: applyNodeWireInset(mcbToEpStart, mcbToEpEnd, mcbNode),
          endPoint: applyNodeWireInset(mcbToEpEnd, mcbToEpStart, topmostEndpoint),
          cable: directEndpointWireProps.cable,
          panelId: panel.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
          fromElementType: 'protection',
          fromElementId: protection?.id,
          toElementType: 'endpoint',
          toElementId: topmostEndpoint.domainId,
          circuitId: circuit.id,
          inTube: directEndpointWireProps.inTube,
          wireRoute: directEndpointWireProps.wireRoute,
          inWall: directEndpointWireProps.inWall,
          hideWireLabel: directEndpointWireProps.hideWireLabel,
        })
      }
    }

    // Domain at trunk/branch junction (output of last conversion device or MCB)
    let trunkDomainAtBranch: typeof DEFAULT_ELECTRICAL_DOMAIN = DEFAULT_ELECTRICAL_DOMAIN
    if (trunkDeviceNodes.length > 0) {
      // Walk trunk devices in order from MCB upwards, applying only conversion devices
      for (const td of trunkDeviceNodes) {
        trunkDomainAtBranch = getTrunkDomainAfterNode(trunkDomainAtBranch, td)
      }
    }
    const trunkExitSectionRef: CircuitSectionRef =
      trunkDeviceNodes.length > 0
        ? {
            fromElementType: 'endpoint',
            fromElementId: trunkDeviceNodes[trunkDeviceNodes.length - 1]?.domainId,
            domain: trunkDomainAtBranch,
          }
        : {
            fromElementType: 'protection',
            fromElementId: protection?.id,
            domain: trunkDomainAtBranch,
          }
    const trunkOriginWireProps = getCircuitWirePropertiesForDomain(
      circuit,
      trunkDomainAtBranch,
      trunkExitSectionRef
    )

    // Horizontal branch wires
    // Determine which branch is visually the last one (top-most on screen, smallest Y).
    const lastBranchNode =
      branchNodes.length > 0
        ? branchNodes.reduce(
            (top, branch) => (branch.bounds.y < top.bounds.y ? branch : top),
            branchNodes[0]!
          )
        : null

    for (const branchNode of branchNodes) {
      const branchSegments = deriveBranchWires(
        branchNode,
        circuit,
        panel,
        mcbX,
        trunkDomainAtBranch,
        trunkOriginWireProps,
        trunkExitSectionRef,
        !!lastBranchNode && branchNode.id === lastBranchNode.id
      )
      segments.push(...branchSegments)
    }
  }

  // Process nested circuits (sub-circuits)
  const nestedMcbNodes = mcbNode.children.filter((c) => c.type === 'mcb')
  if (nestedMcbNodes.length > 0) {
    // Connect nested circuits at the computed parent wire end, which now also
    // respects top-most trunk devices and direct endpoints.
    const explicitSecondaryBus = mcbNode.children.find(
      (child) => child.id === `secondary-bus-${circuit.id}`
    )
    const secondaryBusY = explicitSecondaryBus
      ? explicitSecondaryBus.bounds.y + explicitSecondaryBus.bounds.height / 2
      : verticalWireTopY

    const parentHasVisibleTrunkContent =
      branchNodes.length > 0 ||
      trunkDeviceNodes.length > 0 ||
      trunkEndpointNodes.length > 0 ||
      parentWireEndNodes.length > 0
    if (!parentHasVisibleTrunkContent && secondaryBusY !== mcbY) {
      const parentToBusWireProps = getCircuitWirePropertiesForDomain(
        circuit,
        DEFAULT_ELECTRICAL_DOMAIN,
        {
          fromElementType: 'protection',
          fromElementId: protection?.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
        }
      )
      segments.push({
        id: generateId(),
        type: 'vertical',
        startPoint: applyNodeWireInset(
          { x: mcbX, y: mcbY },
          { x: mcbX, y: secondaryBusY },
          mcbNode
        ),
        endPoint: { x: mcbX, y: secondaryBusY },
        cable: parentToBusWireProps.cable,
        panelId: panel.id,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        fromElementType: 'protection',
        fromElementId: protection?.id,
        circuitId: circuit.id,
        inTube: parentToBusWireProps.inTube,
        wireRoute: parentToBusWireProps.wireRoute,
        inWall: parentToBusWireProps.inWall,
        hideWireLabel: parentToBusWireProps.hideWireLabel,
      })
    }
    const secondaryBusAttachmentNodes = [...secondaryBusEndpointNodes, ...nestedMcbNodes]
    // If there are multiple attachments, draw a secondary busbar (horizontal line).
    if (secondaryBusAttachmentNodes.length > 1) {
      const nestedXPositions = secondaryBusAttachmentNodes
        .map((n) => n.bounds.x)
        .sort((a, b) => a - b)
      const leftmostX = Math.min(...nestedXPositions)
      const rightmostX = Math.max(...nestedXPositions)
      const extension = LAYOUT_CONSTANTS.SECONDARY_BUS_EXTENSION

      const busStartX = leftmostX - extension
      const busEndX = rightmostX + extension
      const busWaypoints: number[] = [busStartX, ...nestedXPositions, busEndX]
      const secondaryBusReferenceLabel = getCircuitDisplayLabel(circuit, protection)

      for (let i = 0; i < busWaypoints.length - 1; i++) {
        const startX = busWaypoints[i]!
        const endX = busWaypoints[i + 1]!
        if (endX <= startX) continue

        segments.push({
          id: generateId(),
          type: 'mainBus',
          startPoint: { x: startX, y: secondaryBusY },
          endPoint: { x: endX, y: secondaryBusY },
          cable,
          panelId: panel.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
          fromElementType: 'secondaryBus',
          toElementType: 'secondaryBus',
          circuitId: circuit.id,
          ...(secondaryBusReferenceLabel
            ? { secondaryBusReferenceExportLabel: secondaryBusReferenceLabel }
            : {}),
          ...(secondaryBusReferenceLabel &&
          shouldLabelSecondaryBusSegment(i, nestedXPositions.length)
            ? { secondaryBusReferenceLabel }
            : {}),
        })
      }
    }

    // Create a virtual secondary bus node so nested MCBs connect
    // from the correct Y position (parent wire end) instead of main bus
    const virtualSecondaryBus: LayoutNode = {
      id: `virtual-secondary-bus-${circuit.id}`,
      type: 'secondaryBus',
      bounds: {
        x: mcbX,
        y: secondaryBusY,
        width: 0,
        height: LAYOUT_CONSTANTS.BUS_THICKNESS,
      },
      children: [],
    }

    for (const nestedMcb of nestedMcbNodes) {
      const nestedSegments = deriveMcbWires(nestedMcb, panel, mainBusY, virtualSecondaryBus)
      segments.push(...nestedSegments)
    }

    for (const panelEndpoint of secondaryBusEndpointNodes) {
      const busPoint = { x: panelEndpoint.bounds.x, y: secondaryBusY }
      const endpointPoint = { x: panelEndpoint.bounds.x, y: panelEndpoint.bounds.y }
      const panelWireProps = getCircuitWirePropertiesForDomain(
        circuit,
        DEFAULT_ELECTRICAL_DOMAIN,
        {
          fromElementType: 'secondaryBus',
          toElementType: 'endpoint',
          toElementId: panelEndpoint.domainId,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
        }
      )
      segments.push({
        id: generateId(),
        type: 'vertical',
        startPoint: busPoint,
        endPoint: applyNodeWireInset(endpointPoint, busPoint, panelEndpoint),
        cable: panelWireProps.cable,
        panelId: panel.id,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        fromElementType: 'secondaryBus',
        toElementType: 'endpoint',
        toElementId: panelEndpoint.domainId,
        circuitId: circuit.id,
        inTube: panelWireProps.inTube,
        wireRoute: panelWireProps.wireRoute,
        inWall: panelWireProps.inWall,
        hideWireLabel: panelWireProps.hideWireLabel,
        feederProtectionId: protection?.id,
      })
    }
  }

  return segments
}

/**
 * Derive wires for a branch node
 *
 * Creates individual wire segments between each pair of adjacent elements on
 * the endpoint chain:  trunk → endpoint1 → endpoint2 → ... → endpointN
 *
 * Each segment references the endpoints it connects (fromElementId/toElementId),
 * enabling precise detection of insertion position when adding symbols to the chain.
 *
 * For the visually last (top-most) branch on a circuit we extend the horizontal
 * start point slightly to the left so that the butt-capped corner overlaps the
 * vertical trunk and avoids a tiny gap.
 */
function deriveBranchWires(
  branchNode: LayoutNode,
  circuit: Circuit,
  panel: Panel,
  trunkX: number,
  trunkDomainAtBranch: typeof DEFAULT_ELECTRICAL_DOMAIN = DEFAULT_ELECTRICAL_DOMAIN,
  trunkOriginWireProps?: ReturnType<typeof getCircuitWirePropertiesForDomain>,
  trunkOriginSectionRef?: CircuitSectionRef,
  isLastBranchOnCircuit = false
): WireSegment[] {
  const segments: WireSegment[] = []
  const inheritedBranchWireProps =
    trunkOriginWireProps ?? getCircuitWirePropertiesForDomain(circuit, trunkDomainAtBranch)

  // Branch bounds.y is the TOP of the hit area (branchY - padding).
  // The actual wire Y is at the CENTER of the branch bounds.
  const branchY = branchNode.bounds.y + branchNode.bounds.height / 2

  // Find endpoints on this branch, sorted by X position (left to right = trunk to tip)
  const endpointNodes = branchNode.children
    .filter((c) => c.type === 'endpoint')
    .sort((a, b) => a.bounds.x - b.bounds.x)

  if (endpointNodes.length === 0) return segments
  const domoticaNode = endpointNodes.find((node) => {
    const endpoint = node.domainRef as Endpoint | undefined
    return endpoint?.symbol === 'domotica' && !endpoint?.domoticaChildProps
  })
  if (domoticaNode) {
    const domotica = domoticaNode.domainRef as Endpoint | undefined
    const endpointCount = Math.max(
      DOMOTICA_MIN_ENDPOINT_OUTPUTS,
      Math.min(
        DOMOTICA_MAX_ENDPOINT_OUTPUTS,
        Math.trunc(domotica?.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS)
      )
    )
    const endpointOutputWires = domotica?.domoticaProps?.endpointOutputWires ?? []
    // Layout bounds.x is the center of the domotica symbol; the 1-draad box is drawn from
    // center - width/2 (left edge) to center + width/2 (right edge).
    const boxCenterX = domoticaNode.bounds.x
    const boxLeftX = boxCenterX - DOMOTICA_BOX_WIDTH / 2
    const boxRightX = boxCenterX + DOMOTICA_BOX_WIDTH / 2

    const domoticaHeight = Math.max(0, endpointCount - 1) * DOMOTICA_OUTPUT_SPACING
    const firstOutputY = branchY - domoticaHeight

    const addDomoticaOutputChain = (
      group: 'endpoint',
      index: number,
      outputY: number,
      fallbackLead: number,
      wireProps: Partial<ReturnType<typeof getCircuitWirePropertiesForDomain>> | undefined,
      baseProps: ReturnType<typeof getCircuitWirePropertiesForDomain>,
      domain: typeof DEFAULT_ELECTRICAL_DOMAIN
    ) => {
      const childrenOnRow = endpointNodes
        .filter((n) => {
          const ep = n.domainRef as {
            domoticaChildProps?: {
              parentEndpointId?: string
              outputGroup?: string
              outputIndex?: number
            }
          }
          const childProps = ep?.domoticaChildProps
          return (
            childProps?.parentEndpointId === domoticaNode.domainId &&
            (childProps?.outputGroup === group ||
              childProps?.outputGroup === 'control') &&
            childProps?.outputIndex === index
          )
        })
        .sort((a, b) => a.bounds.x - b.bounds.x)

      const segmentCable = wireProps?.cable ?? baseProps.cable
      const baseRoute = wireProps?.wireRoute ?? baseProps.wireRoute
      const segmentInTube = wireProps?.inTube ?? baseProps.inTube
      const segmentInWall =
        wireProps?.inWall ?? (baseRoute === 'wall' ? (baseProps.inWall ?? false) : false)
      const segmentHideWireLabel = wireProps?.hideWireLabel ?? baseProps.hideWireLabel
      const segmentShowFireClassLabel =
        wireProps?.showFireClassLabel ?? baseProps.showFireClassLabel
      const segmentWireLengthM = wireProps?.wireLengthM ?? baseProps.wireLengthM
      const segmentShowWireLengthLabel =
        wireProps?.showWireLengthLabel ?? baseProps.showWireLengthLabel

      const start = { x: boxRightX, y: outputY }
      const firstNode = childrenOnRow[0]
      const firstEnd = firstNode
        ? { x: firstNode.bounds.x, y: outputY }
        : { x: boxRightX + fallbackLead, y: outputY }

      segments.push({
        id: generateId(),
        type: 'branch',
        startPoint: start,
        endPoint: firstNode
          ? applyNodeWireInset(firstEnd, start, firstNode)
          : firstEnd,
        cable: segmentCable,
        panelId: panel.id,
        domain,
        circuitId: circuit.id,
        fromElementId: domoticaNode.domainId,
        fromElementType: 'endpoint',
        toElementId: firstNode?.domainId,
        toElementType: firstNode ? 'endpoint' : undefined,
        inTube: segmentInTube,
        inWall: segmentInWall,
        wireRoute: baseRoute,
        hideWireLabel: segmentHideWireLabel,
        showFireClassLabel: segmentShowFireClassLabel,
        wireLengthM: segmentWireLengthM,
        showWireLengthLabel: segmentShowWireLengthLabel,
        domoticaOutputGroup: group,
        domoticaOutputIndex: index,
      })

      for (let childIndex = 0; childIndex < childrenOnRow.length - 1; childIndex++) {
        const fromNode = childrenOnRow[childIndex]!
        const toNode = childrenOnRow[childIndex + 1]!
        const fromPt = { x: fromNode.bounds.x, y: outputY }
        const toPt = { x: toNode.bounds.x, y: outputY }
        segments.push({
          id: generateId(),
          type: 'branch',
          startPoint: applyNodeWireInset(fromPt, toPt, fromNode),
          endPoint: applyNodeWireInset(toPt, fromPt, toNode),
          cable: segmentCable,
          panelId: panel.id,
          domain,
          circuitId: circuit.id,
          fromElementId: fromNode.domainId,
          fromElementType: 'endpoint',
          toElementId: toNode.domainId,
          toElementType: 'endpoint',
          inTube: segmentInTube,
          inWall: segmentInWall,
          wireRoute: baseRoute,
          hideWireLabel: segmentHideWireLabel,
          showFireClassLabel: segmentShowFireClassLabel,
          wireLengthM: segmentWireLengthM,
          showWireLengthLabel: segmentShowWireLengthLabel,
          domoticaOutputGroup: group,
          domoticaOutputIndex: index,
        })
      }
    }

    // Main branch segment to domotica body.
    const trunkToDomoticaStart = { x: trunkX, y: branchY }
    // Trunk wire ends exactly on the LEFT edge of the domotica box.
    const trunkToDomoticaEnd = { x: boxLeftX, y: branchY }
    const branchEntryWireProps = inheritedBranchWireProps
    segments.push({
      id: generateId(),
      type: 'branch',
      startPoint: trunkToDomoticaStart,
      endPoint: applyNodeWireInset(trunkToDomoticaEnd, trunkToDomoticaStart, domoticaNode),
      cable: branchEntryWireProps.cable,
      panelId: panel.id,
      domain: trunkDomainAtBranch,
      circuitId: circuit.id,
      fromElementId: trunkOriginSectionRef?.fromElementId,
      fromElementType: trunkOriginSectionRef?.fromElementType,
      toElementId: domoticaNode.domainId,
      toElementType: 'endpoint',
      inTube: branchEntryWireProps.inTube,
      wireRoute: branchEntryWireProps.wireRoute,
      inWall: branchEntryWireProps.inWall,
      hideWireLabel: branchEntryWireProps.hideWireLabel,
    })

    for (let i = 0; i < endpointCount; i++) {
      const outputY = firstOutputY + i * DOMOTICA_OUTPUT_SPACING
      addDomoticaOutputChain(
        'endpoint',
        i,
        outputY,
        DOMOTICA_BRANCH_LEAD,
        endpointOutputWires[i],
        inheritedBranchWireProps,
        trunkDomainAtBranch
      )
    }
    return segments
  }

  // First segment: trunk (vertical wire) to first endpoint
  const firstNode = endpointNodes[0]! // Safe: checked length === 0 above
  const firstEndpointX = firstNode.bounds.x
  if (trunkX < firstEndpointX) {
    // For the last (top-most) branch, nudge the horizontal start a tiny
    // bit to the left so the corner visually overlaps the vertical trunk.
    const trunkStartX = isLastBranchOnCircuit
      ? trunkX - LAYOUT_CONSTANTS.BRANCH_LINE_WIDTH / 2
      : trunkX
    const trunkStart = { x: trunkStartX, y: branchY }
    const firstEnd = { x: firstEndpointX, y: branchY }
    const firstBranchWireProps = inheritedBranchWireProps
    segments.push({
      id: generateId(),
      type: 'branch',
      startPoint: trunkStart,
      endPoint: applyNodeWireInset(firstEnd, trunkStart, firstNode),
      cable: firstBranchWireProps.cable,
      panelId: panel.id,
      domain: trunkDomainAtBranch,
      circuitId: circuit.id,
      fromElementId: trunkOriginSectionRef?.fromElementId,
      fromElementType: trunkOriginSectionRef?.fromElementType,
      toElementId: firstNode.domainId,
      toElementType: 'endpoint',
      inTube: firstBranchWireProps.inTube,
      wireRoute: firstBranchWireProps.wireRoute,
      inWall: firstBranchWireProps.inWall,
      hideWireLabel: firstBranchWireProps.hideWireLabel,
    })
  }
  // Segments between each consecutive pair of endpoints
  let currentBranchDomain = getTrunkDomainAfterNode(trunkDomainAtBranch, firstNode)
  for (let i = 0; i < endpointNodes.length - 1; i++) {
    const fromNode = endpointNodes[i]!
    const toNode = endpointNodes[i + 1]!

    const fromPt = { x: fromNode.bounds.x, y: branchY }
    const toPt = { x: toNode.bounds.x, y: branchY }
    const betweenSectionRef: CircuitSectionRef = {
      fromElementType: 'endpoint',
      fromElementId: fromNode.domainId,
      toElementType: 'endpoint',
      toElementId: toNode.domainId,
      domain: currentBranchDomain,
    }
    const betweenBranchWireProps = getCircuitWirePropertiesForDomain(
      circuit,
      currentBranchDomain,
      betweenSectionRef
    )
    segments.push({
      id: generateId(),
      type: 'branch',
      startPoint: applyNodeWireInset(fromPt, toPt, fromNode),
      endPoint: applyNodeWireInset(toPt, fromPt, toNode),
      cable: betweenBranchWireProps.cable,
      panelId: panel.id,
      domain: currentBranchDomain,
      circuitId: circuit.id,
      fromElementId: fromNode.domainId,
      fromElementType: 'endpoint',
      toElementId: toNode.domainId,
      toElementType: 'endpoint',
      inTube: betweenBranchWireProps.inTube,
      wireRoute: betweenBranchWireProps.wireRoute,
      inWall: betweenBranchWireProps.inWall,
      hideWireLabel: betweenBranchWireProps.hideWireLabel,
    })
    currentBranchDomain = getTrunkDomainAfterNode(currentBranchDomain, toNode)
  }

  return segments
}

/**
 * Helper to find circuit for a protection device
 */
function findCircuitForProtection(panel: Panel, protectionId?: string): Circuit | null {
  if (!protectionId) return null

  // Check direct circuits
  for (const circuit of panel.circuits) {
    // Check if any protection in the panel has this circuit
    const protection = panel.protections.find((p) => p.id === protectionId)
    if (protection?.circuits?.some((c) => c.id === circuit.id)) {
      return circuit
    }
  }

  // Check circuits under protections
  for (const protection of panel.protections) {
    if (protection.id === protectionId && protection.circuits?.[0]) {
      return protection.circuits[0]
    }
  }

  return null
}

export function findCircuitByIdInPanel(panel: Panel, circuitId?: string): Circuit | null {
  if (!circuitId) return null
  for (const circuit of panel.circuits ?? []) {
    if (circuit.id === circuitId) return circuit
  }
  for (const protection of panel.protections ?? []) {
    for (const circuit of protection.circuits ?? []) {
      if (circuit.id === circuitId) return circuit
    }
  }
  return null
}
