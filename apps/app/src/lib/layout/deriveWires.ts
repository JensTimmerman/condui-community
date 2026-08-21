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
  TrunkDevice,
  CircuitPhaseAssignment,
} from '@/types/schema'
import { resolveSymbolPortsForWire, DEFAULT_ELECTRICAL_DOMAIN } from '@/lib/symbols'
import {
  createDefaultAcCircuitCable,
  ensurePanelBusCableMinimum,
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
  getEffectiveCircuitPhaseState,
  getFullInstallationPhaseAssignment,
  getDownstreamProtectionPhaseAssignment,
  getInheritedCircuitPhaseState,
  getMainBusProtectionPhaseAssignment,
  getPanelIncomingPhaseState,
  isPhaseAssignmentLabelVisible,
} from '@/lib/wires/phaseAssignment'
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
  type SupplyWireRole,
} from '@/lib/supplyWireCables'
import { findPanelById } from '@/lib/panel/panelTree'
import {
  getPrimaryPanelBusSectionId,
  getProtectionBusSectionId,
  hasExplicitPanelBusSections,
} from '@/lib/panel/panelBusSections'
import { getLeftBiasedBusFeedStubX, PANEL_BUS_FEED_GAP } from '@/lib/panel/panelBusFeedPreview'
import { getSecondaryBusSectionBoundaryX } from './mainBusSectionBoundary'
import {
  panelGridModuleIsVisibleByDefault,
  trunkDeviceCanAppearInPanelGrid,
} from '@/lib/eendraad/projectElectricalDomain'
import type {
  OffGridSupplyAssembly,
  SupplyConnection,
  SupplyConnectionPathRole,
  ElectricalEnclosureRef,
} from '@/types/supplyAssembly'

const SECONDARY_BUS_REFERENCE_LABEL_INTERVAL = 4

function getAcConnectionPhaseAssignment(
  connection: SupplyConnection | undefined
): CircuitPhaseAssignment | undefined {
  if (!connection || connection.domain !== 'AC') return undefined
  const phases = connection.conductors.filter(
    (conductor): conductor is 'L1' | 'L2' | 'L3' | 'N' =>
      conductor === 'L1' || conductor === 'L2' || conductor === 'L3' || conductor === 'N'
  )
  const uniquePhases = [...new Set(phases)]
  const linePhaseCount = uniquePhases.filter((phase) => phase !== 'N').length
  if (linePhaseCount === 0) return undefined
  return {
    kind:
      linePhaseCount >= 3
        ? 'three_phase'
        : linePhaseCount === 2
          ? 'phase_to_phase'
          : 'single_phase',
    phases: uniquePhases,
    neutral: uniquePhases.includes('N') ? 'used' : 'not_present',
    source: 'derived_from_busbar',
  }
}

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

function findDescendantNode(
  roots: LayoutNode[],
  predicate: (node: LayoutNode) => boolean
): LayoutNode | undefined {
  for (const node of roots) {
    if (predicate(node)) return node
    const nested = findDescendantNode(node.children, predicate)
    if (nested) return nested
  }
  return undefined
}

function getDomoticaOutputPhaseState(
  circuit: Circuit,
  segment: WireSegment
):
  | Pick<ReturnType<typeof getCircuitWirePropertiesForDomain>, 'phaseAssignment' | 'showPhaseLabel'>
  | undefined {
  if (!segment.domoticaOutputGroup || segment.domoticaOutputIndex == null) return undefined
  const domotica = circuit.endpoints.find(
    (endpoint) => endpoint.symbol === 'domotica' && endpoint.domoticaProps
  )
  if (!domotica?.domoticaProps) return undefined
  const outputWires =
    segment.domoticaOutputGroup === 'control'
      ? domotica.domoticaProps.controlOutputWires
      : domotica.domoticaProps.endpointOutputWires
  const output = outputWires?.[segment.domoticaOutputIndex]
  return output
    ? { phaseAssignment: output.phaseAssignment, showPhaseLabel: output.showPhaseLabel }
    : undefined
}

function applyNodeWireInset(
  point: { x: number; y: number },
  otherEnd: { x: number; y: number },
  node: LayoutNode
): { x: number; y: number } {
  return applyWireInset(
    point,
    otherEnd,
    node.type,
    getNodeSymbolId(node),
    getNodeLightPointProps(node)
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
    phaseAssignment:
      sectionOverride?.phaseAssignment ??
      domainOverride?.phaseAssignment ??
      circuit.phaseAssignment,
    showPhaseLabel:
      sectionOverride?.showPhaseLabel ?? domainOverride?.showPhaseLabel ?? circuit.showPhaseLabel,
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
      domain
    ),
    wireLengthM: sectionOverride?.wireLengthM ?? domainOverride?.wireLengthM ?? circuit.wireLengthM,
    showWireLengthLabel: resolveShowWireLengthLabel(
      sectionOverride?.showWireLengthLabel ??
        domainOverride?.showWireLengthLabel ??
        circuit.showWireLengthLabel
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
    phaseAssignment:
      sectionOverride?.phaseAssignment ??
      domainOverride?.phaseAssignment ??
      circuit.phaseAssignment,
    showPhaseLabel:
      sectionOverride?.showPhaseLabel ?? domainOverride?.showPhaseLabel ?? circuit.showPhaseLabel,
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
      domain
    ),
    wireLengthM: sectionOverride?.wireLengthM ?? domainOverride?.wireLengthM ?? circuit.wireLengthM,
    showWireLengthLabel: resolveShowWireLengthLabel(
      sectionOverride?.showWireLengthLabel ??
        domainOverride?.showWireLengthLabel ??
        circuit.showWireLengthLabel
    ),
  }
}

/**
 * Derive all wire segments from the layout tree
 */
export function deriveWires(
  tree: LayoutTree,
  panels: Panel[],
  installation?: Installation,
  supplyAssemblies: OffGridSupplyAssembly[] = [],
  resolveSupplyDeviceEnclosure?: (deviceId: string) => ElectricalEnclosureRef | undefined
): WireSegment[] {
  const segments: WireSegment[] = []
  if (installation) ensureInstallationFeedTopology(installation, panels)

  for (const panelNode of tree.panels) {
    const panel = findPanelById(panels, panelNode.domainId)
    if (!panel) continue

    const panelSegments = derivePanelWires(
      panelNode,
      panel,
      panels,
      installation,
      supplyAssemblies,
      resolveSupplyDeviceEnclosure
    )
    const diagramId = panelNode.diagramId ?? panel.id
    panelSegments.forEach((segment) => {
      segment.diagramId = diagramId
    })
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
  installation?: Installation,
  supplyAssemblies: OffGridSupplyAssembly[] = [],
  resolveSupplyDeviceEnclosure?: (deviceId: string) => ElectricalEnclosureRef | undefined
): WireSegment[] {
  const segments: WireSegment[] = []

  const feedTopology = installation
    ? ensureInstallationFeedTopology(installation, panels)
    : undefined
  const rootFeed = feedTopology?.rootFeeds.find((feed) => feed.panelId === panel.id)
  const applySupplySection = (segment: WireSegment, sectionKey?: string): WireSegment => {
    if (!sectionKey) return segment
    segment.supplySectionKey = sectionKey
    const properties = rootFeed?.wireSections?.[sectionKey]
    if (!properties) return segment
    segment.cable = properties.cable
    segment.wireRoute = properties.wireRoute
    segment.inTube = properties.inTube
    segment.inWall = properties.inWall
    segment.hideWireLabel = properties.hideWireLabel
    segment.showFireClassLabel = properties.showFireClassLabel
    segment.wireLengthM = properties.wireLengthM
    segment.showWireLengthLabel = properties.showWireLengthLabel
    return segment
  }
  const propagateSupplySectionsAcrossSimpleJoints = (): void => {
    const supplySegments = segments.filter(
      (segment) =>
        segment.isSupplyTrunk === true ||
        segment.supplyConnectionId != null ||
        segment.supplySectionKey != null
    )
    if (supplySegments.length < 2) return

    const endpointKey = (segment: WireSegment, point: { x: number; y: number }) =>
      `${segment.domain ?? 'AC'}:${Math.round(point.x * 10)}:${Math.round(point.y * 10)}`
    const endpointIncidence = new Map<string, number[]>()
    supplySegments.forEach((segment, index) => {
      for (const point of [segment.startPoint, segment.endPoint]) {
        const key = endpointKey(segment, point)
        endpointIncidence.set(key, [...(endpointIncidence.get(key) ?? []), index])
      }
    })

    const parents = supplySegments.map((_, index) => index)
    const find = (index: number): number => {
      let root = index
      while (parents[root] !== root) root = parents[root]!
      while (parents[index] !== index) {
        const next = parents[index]!
        parents[index] = root
        index = next
      }
      return root
    }
    const unite = (left: number, right: number) => {
      const leftRoot = find(left)
      const rightRoot = find(right)
      if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot
    }
    for (const incident of endpointIncidence.values()) {
      // A simple two-piece joint is one physical run (including a 90-degree bend).
      // A T-junction remains a boundary between independently configurable wires.
      if (incident.length === 2) unite(incident[0]!, incident[1]!)
    }

    const groups = new Map<number, WireSegment[]>()
    supplySegments.forEach((segment, index) => {
      const root = find(index)
      groups.set(root, [...(groups.get(root) ?? []), segment])
    })
    for (const group of groups.values()) {
      const sectionKeys = new Set(
        group.map((segment) => segment.supplySectionKey).filter((key): key is string => !!key)
      )
      if (sectionKeys.size !== 1) continue
      const [sectionKey] = sectionKeys
      for (const segment of group) {
        if (!segment.supplySectionKey) applySupplySection(segment, sectionKey)
      }
    }
  }
  const supplySectionKey = (path: string, first: string, second: string): string => {
    const [left, right] = [first, second].sort()
    return `supply:${panel.id}:${path}:${left}<>${right}`
  }

  const supplyAssembly = supplyAssemblies.find(
    (assembly) =>
      ((assembly.incomingAttachment.kind === 'panel-input' ||
        assembly.incomingAttachment.kind === 'panel-bus-input') &&
        assembly.incomingAttachment.panelId === panel.id) ||
      assembly.loadHandoffs.some(
        (handoff) =>
          (handoff.target.kind === 'panel-input' ||
            handoff.target.kind === 'panel-bus-input' ||
            handoff.target.kind === 'circuit-input') &&
          handoff.target.panelId === panel.id
      )
  )
  const findAssemblyConnection = (
    firstNodeId: string | undefined,
    secondNodeId: string | undefined,
    pathRole?: SupplyConnectionPathRole
  ): SupplyConnection | undefined => {
    if (!supplyAssembly || !firstNodeId || !secondNodeId) return undefined
    const equivalentNodeIds = (nodeId: string): Set<string> => {
      const node = supplyAssembly.nodes.find((candidate) => candidate.id === nodeId)
      if (node?.kind !== 'inverter-unit' || !node.deviceId) return new Set([nodeId])
      return new Set(
        supplyAssembly.nodes
          .filter(
            (candidate) =>
              candidate.kind === 'inverter-unit' && candidate.deviceId === node.deviceId
          )
          .map((candidate) => candidate.id)
      )
    }
    const firstIds = equivalentNodeIds(firstNodeId)
    const secondIds = equivalentNodeIds(secondNodeId)
    const matches = supplyAssembly.connections.filter(
      (connection) =>
        (!pathRole || connection.pathRole === pathRole) &&
        connection.endpoints.some(({ nodeId }) => firstIds.has(nodeId)) &&
        connection.endpoints.some(({ nodeId }) => secondIds.has(nodeId))
    )
    const primary =
      matches.find(
        (connection) =>
          connection.endpoints.some(({ nodeId }) => nodeId === firstNodeId) &&
          connection.endpoints.some(({ nodeId }) => nodeId === secondNodeId)
      ) ?? matches[0]
    if (!primary || matches.length === 1) return primary
    const conductorOrder = ['L1', 'L2', 'L3', 'N', 'PE', 'DC+', 'DC-'] as const
    return {
      ...primary,
      // Multiplied inverter units are separate graph sources but share one collapsed
      // symbol and one physical one-wire run. Render that run with the union carried
      // by all equivalent unit connections, never the arbitrary first unit only.
      conductors: Array.from(new Set(matches.flatMap((connection) => connection.conductors))).sort(
        (left, right) => conductorOrder.indexOf(left) - conductorOrder.indexOf(right)
      ),
    }
  }
  const findAssemblyPortConnection = (
    nodeId: string | undefined,
    portId: string
  ): SupplyConnection | undefined => {
    if (!supplyAssembly || !nodeId) return undefined
    const node = supplyAssembly.nodes.find((candidate) => candidate.id === nodeId)
    const equivalentIds =
      node?.kind === 'inverter-unit' && node.deviceId
        ? new Set(
            supplyAssembly.nodes
              .filter(
                (candidate) =>
                  candidate.kind === 'inverter-unit' && candidate.deviceId === node.deviceId
              )
              .map((candidate) => candidate.id)
          )
        : new Set([nodeId])
    const matches = supplyAssembly.connections.filter((connection) =>
      connection.endpoints.some(
        (endpoint) => equivalentIds.has(endpoint.nodeId) && endpoint.portId === portId
      )
    )
    const primary =
      matches.find((connection) =>
        connection.endpoints.some(
          (endpoint) => endpoint.nodeId === nodeId && endpoint.portId === portId
        )
      ) ?? matches[0]
    if (!primary || matches.length === 1) return primary
    const conductorOrder = ['L1', 'L2', 'L3', 'N', 'PE', 'DC+', 'DC-'] as const
    return {
      ...primary,
      conductors: Array.from(new Set(matches.flatMap((connection) => connection.conductors))).sort(
        (left, right) => conductorOrder.indexOf(left) - conductorOrder.indexOf(right)
      ),
    }
  }
  const applyAssemblyConnection = (
    segment: WireSegment,
    connection: SupplyConnection | undefined
  ): WireSegment => {
    if (!supplyAssembly || !connection) return segment
    segment.supplyAssemblyId = supplyAssembly.id
    segment.supplyConnectionId = connection.id
    const connectionPhaseAssignment = getAcConnectionPhaseAssignment(connection)
    if (connectionPhaseAssignment) segment.phaseAssignment = connectionPhaseAssignment
    const properties = connection.wireProperties
    if (properties) {
      segment.cable = properties.cable
      segment.wireRoute = properties.wireRoute
      segment.inTube = properties.inTube
      segment.inWall = properties.inWall
      segment.hideWireLabel = properties.hideWireLabel
      segment.showFireClassLabel = properties.showFireClassLabel
      segment.wireLengthM = properties.wireLengthM
      segment.showWireLengthLabel = properties.showWireLengthLabel
    }
    // A physical section is the most specific editable identity. Connection defaults may seed it,
    // but must never overwrite its independently persisted cable, route, or label visibility.
    if (segment.supplySectionKey && rootFeed?.wireSections?.[segment.supplySectionKey]) {
      applySupplySection(segment, segment.supplySectionKey)
    }
    return segment
  }

  const enclosureKey = (enclosure: import('@/types/supplyAssembly').ElectricalEnclosureRef) =>
    enclosure.kind === 'grid'
      ? 'grid'
      : enclosure.kind === 'panel'
        ? `panel:${enclosure.panelId}`
        : `auxiliary:${enclosure.enclosureId}`

  const getDeviceEnclosureKey = (device: TrunkDevice): string | undefined => {
    if (!trunkDeviceCanAppearInPanelGrid(device)) return undefined
    const ref = { kind: 'trunkDevice' as const, id: device.id, scope: 'supply' as const }
    const refKey = `trunkDevice:${device.id}:supply`
    let hidden = false
    let explicitlyShown = false
    const visitPanels = (candidates: Panel[]): void => {
      for (const candidate of candidates) {
        hidden ||= candidate.gridView?.hiddenModuleKeys?.includes(refKey) === true
        explicitlyShown ||=
          candidate.gridView?.shownModuleKeys?.includes(refKey) === true ||
          candidate.gridView?.slots.some((slot) => {
            const module = slot.module
            return (
              module.kind === 'trunkDevice' && module.id === device.id && module.scope === 'supply'
            )
          }) === true ||
          candidate.gridView?.supplyPanelSlots?.some((slot) => {
            const module = slot.module
            return (
              module.kind === 'trunkDevice' && module.id === device.id && module.scope === 'supply'
            )
          }) === true
        visitPanels(candidate.subPanels ?? [])
      }
    }
    visitPanels(panels)
    if (hidden) return undefined
    if (
      !device.panelMounting &&
      !explicitlyShown &&
      !panelGridModuleIsVisibleByDefault(ref, panel, installation, panels)
    ) {
      return undefined
    }
    const resolvedEnclosure = resolveSupplyDeviceEnclosure?.(device.id) ?? device.panelMounting
    if (resolvedEnclosure) return enclosureKey(resolvedEnclosure)
    if (!installation) return 'grid'
    return resolveSupplyFeedScopeForDeviceId(installation, panels, panel, device.id) === 'shared'
      ? 'grid'
      : `panel:${panel.id}`
  }

  const getAssemblyNodeEnclosureKey = (nodeId: string): string | undefined => {
    const node = supplyAssembly?.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return undefined
    if (node.kind === 'utility-source') return 'grid'
    if (node.kind === 'panel-handoff') return `panel:${panel.id}`

    const deviceNode = node.deviceId
      ? panelNode.children.find(
          (candidate) => candidate.type === 'trunkDevice' && candidate.domainId === node.deviceId
        )
      : undefined
    const device = deviceNode?.domainRef as TrunkDevice | undefined
    if (device) return getDeviceEnclosureKey(device)
    if (node.mounting?.enclosure) return enclosureKey(node.mounting.enclosure)
    if (!node.deviceId || !installation) return undefined
    return resolveSupplyFeedScopeForDeviceId(installation, panels, panel, node.deviceId) ===
      'shared'
      ? 'grid'
      : `panel:${panel.id}`
  }

  const explicitlyMarkedConnectionIds = new Set<string>()
  const explicitlyMarkedBoundaryKeys = new Set<string>()
  const getBoundaryKey = (firstEnclosure: string, secondEnclosure: string) =>
    [firstEnclosure, secondEnclosure].sort().join('|')
  const markAssemblyEnclosureBoundaries = (): void => {
    if (!supplyAssembly) return
    for (const connection of supplyAssembly.connections) {
      const endpointNodes = connection.endpoints.map(({ nodeId }) =>
        supplyAssembly.nodes.find((candidate) => candidate.id === nodeId)
      )
      if (endpointNodes.some((node) => node?.kind === 'panel-handoff')) continue
      const fromEnclosure = getAssemblyNodeEnclosureKey(connection.endpoints[0].nodeId)
      const toEnclosure = getAssemblyNodeEnclosureKey(connection.endpoints[1].nodeId)
      if (!fromEnclosure || !toEnclosure || fromEnclosure === toEnclosure) continue
      if (explicitlyMarkedBoundaryKeys.has(getBoundaryKey(fromEnclosure, toEnclosure))) continue
      if (explicitlyMarkedConnectionIds.has(connection.id)) continue
      const candidates = segments.filter((segment) => segment.supplyConnectionId === connection.id)
      const markerSegment = candidates.reduce<WireSegment | undefined>((best, candidate) => {
        const length = Math.hypot(
          candidate.endPoint.x - candidate.startPoint.x,
          candidate.endPoint.y - candidate.startPoint.y
        )
        if (length <= 0) return best
        if (!best) return candidate
        const bestLength = Math.hypot(
          best.endPoint.x - best.startPoint.x,
          best.endPoint.y - best.startPoint.y
        )
        // Keep the enclosure marker local to the boundary device. Long elbow/T legs
        // tend to push it away from the actual ownership transition and can make one
        // transition look like two independent splits.
        return length < bestLength ? candidate : best
      }, undefined)
      if (markerSegment) {
        markerSegment.supplyEnclosureBoundary = true
        // A direct converter's grid and load paths meet at one visible T. Collapse
        // repeated ownership transitions there, while retaining both genuinely
        // independent inputs of a source changeover.
        if (directConverterNodeForBackup) {
          explicitlyMarkedBoundaryKeys.add(getBoundaryKey(fromEnclosure, toEnclosure))
        }
        explicitlyMarkedConnectionIds.add(connection.id)
      }
    }
  }

  // Find supply, ground, and main bus nodes
  const supplyNode = panelNode.children.find((c) => c.type === 'supply')
  const groundNode = panelNode.children.find((c) => c.type === 'ground')
  const mainBusNode = panelNode.children.find((c) => c.type === 'busBar')
  const directConverterNodeForBackup = panelNode.children.find(
    (node) =>
      node.type === 'trunkDevice' &&
      (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'converter-branch'
  )
  let renderedSupplyDeviceNodes: LayoutNode[] = []

  if (!mainBusNode) return segments

  const mainBusY = mainBusNode.bounds.y + mainBusNode.bounds.height / 2
  const mainBusX = mainBusNode.bounds.x
  const mainBusWidth = mainBusNode.bounds.width
  const diagramKey = panelNode.diagramId ?? panel.id
  const isSupplyDiagram = panelNode.diagramId?.endsWith('--supply') ?? false
  const panelIncomingPhaseState = getPanelIncomingPhaseState(
    installation,
    panels,
    panel,
    undefined,
    supplyAssemblies
  )
  const hasMainBusConnections = mainBusNode.children.some((child) => {
    if (child.type !== 'rcd' && child.type !== 'mcb') return false
    const circuit = child.circuitIdForWires
      ? findCircuitByIdInPanel(panel, child.circuitIdForWires)
      : null
    return circuit?.supplySource?.kind !== 'converter-backup'
  })
  const usesInlineEmptySplitAssembly =
    !isSupplyDiagram && hasExplicitPanelBusSections(panel) && !hasMainBusConnections
  const detachedGridGroundY =
    (isSupplyDiagram || usesInlineEmptySplitAssembly) && hasExplicitPanelBusSections(panel)
      ? supplyNode?.bounds.y
      : undefined

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

      waypoints.push({ y: detachedGridGroundY ?? mainBusY }) // End at grid lane or main bus

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
        const adjustedStart = fromNode ? applyNodeWireInset(startPt, endPt, fromNode) : startPt

        // Apply inset on the "to" side (trunk device or main bus — bus has no inset)
        const toNode = allNodes[i + 1] // undefined for the last segment (→ main bus)
        const adjustedEnd = toNode ? applyNodeWireInset(endPt, startPt, toNode) : endPt

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
      const groundEnd = { x: groundNode.bounds.x, y: detachedGridGroundY ?? mainBusY }
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
  const defaultCable = ensurePanelBusCableMinimum(panel.protections[0]?.circuits?.[0]?.cable)

  // Collect X positions of all RCDs/MCBs attached to the main bus.
  const connectionEntries = mainBusNode.children
    .filter((child) => {
      if (child.type !== 'rcd' && child.type !== 'mcb') return false
      const circuit = child.circuitIdForWires
        ? findCircuitByIdInPanel(panel, child.circuitIdForWires)
        : null
      return circuit?.supplySource?.kind !== 'converter-backup'
    })
    .map((child) => ({
      x: child.bounds.x,
      busSectionId: getProtectionBusSectionId(
        panel,
        (child.domainRef as ProtectionDevice | undefined) ?? {}
      ),
    }))
    .sort((a, b) => a.x - b.x)
  const connectionXs = connectionEntries.map((entry) => entry.x)

  // A grouped secondary bus is the visual source of truth for where a section
  // transition is cut. The protection midpoint is only a fallback: it drifts
  // when one section contains a wider RCD trunk than the other.
  const secondaryBusSectionRanges = mainBusNode.children.flatMap((node) => {
    if (node.type !== 'rcd' && node.type !== 'mcb') return []
    const protection = node.domainRef as ProtectionDevice | undefined
    if (!protection) return []
    const sectionId = getProtectionBusSectionId(panel, protection)
    return node.children
      .filter((child) => child.type === 'secondaryBus' && child.bounds.width > 0)
      .map((secondaryBus) => ({
        sectionId,
        startX: secondaryBus.bounds.x,
        endX: secondaryBus.bounds.x + secondaryBus.bounds.width,
      }))
  })

  const busStartX = mainBusX
  const busEndX = mainBusX + mainBusWidth
  const busSegmentStartIndex = segments.length
  if (hasExplicitPanelBusSections(panel) && connectionEntries.length > 0) {
    const splitGap = PANEL_BUS_FEED_GAP
    for (let index = 0; index < connectionEntries.length; index += 1) {
      const entry = connectionEntries[index]!
      const previous = connectionEntries[index - 1]
      const next = connectionEntries[index + 1]
      let startX = previous ? (previous.x + entry.x) / 2 : busStartX
      let endX = next ? (entry.x + next.x) / 2 : busEndX
      if (previous && previous.busSectionId !== entry.busSectionId) {
        const sectionBoundaryX = getSecondaryBusSectionBoundaryX(
          secondaryBusSectionRanges,
          previous.busSectionId,
          entry.busSectionId,
          startX
        )
        startX = sectionBoundaryX + splitGap / 2
      }
      if (next && next.busSectionId !== entry.busSectionId) {
        const sectionBoundaryX = getSecondaryBusSectionBoundaryX(
          secondaryBusSectionRanges,
          entry.busSectionId,
          next.busSectionId,
          endX
        )
        endX = sectionBoundaryX - splitGap / 2
      }
      if (endX <= startX) continue
      const sectionPhaseState = getPanelIncomingPhaseState(
        installation,
        panels,
        panel,
        entry.busSectionId,
        supplyAssemblies
      )
      segments.push({
        id: `mainBus-${diagramKey}-${entry.busSectionId}-${index}`,
        type: 'mainBus',
        startPoint: { x: startX, y: mainBusY },
        endPoint: { x: endX, y: mainBusY },
        cable: defaultCable,
        panelId: panel.id,
        busSectionId: entry.busSectionId,
        busFeedKind: isSupplyDiagram
          ? panel.busSections?.find((section) => section.id === entry.busSectionId)?.role ===
            'backup'
            ? 'backup'
            : 'grid'
          : undefined,
        showBusFeedMarker: isSupplyDiagram,
        busFeedMarkerSide:
          isSupplyDiagram
            ? panel.busSections?.find((section) => section.id === entry.busSectionId)?.role ===
              'backup'
              ? 'below-right'
              : 'below-left'
            : undefined,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        phaseAssignment:
          sectionPhaseState.assignment ??
          getFullInstallationPhaseAssignment(installation?.nominalVoltage.system),
        fromElementType: 'mainBus',
        toElementType: 'mainBus',
      })
    }
  } else if (hasExplicitPanelBusSections(panel)) {
    const splitGap = PANEL_BUS_FEED_GAP
    const sections = [...(panel.busSections ?? [])].sort((left, right) => {
      const leftBackup = left.role === 'backup'
      const rightBackup = right.role === 'backup'
      if (leftBackup === rightBackup) return 0
      return leftBackup ? 1 : -1
    })
    const sectionWidth =
      (mainBusWidth - splitGap * Math.max(0, sections.length - 1)) / Math.max(1, sections.length)
    sections.forEach((section, index) => {
      const startX = busStartX + index * (sectionWidth + splitGap)
      const endX = startX + sectionWidth
      const sectionPhaseState = getPanelIncomingPhaseState(
        installation,
        panels,
        panel,
        section.id,
        supplyAssemblies
      )
      segments.push({
        id: `mainBus-${diagramKey}-${section.id}-empty`,
        type: 'mainBus',
        startPoint: { x: startX, y: mainBusY },
        endPoint: { x: endX, y: mainBusY },
        cable: defaultCable,
        panelId: panel.id,
        busSectionId: section.id,
        busFeedKind:
          isSupplyDiagram || usesInlineEmptySplitAssembly
            ? section.role === 'backup'
              ? 'backup'
              : 'grid'
            : undefined,
        showBusFeedMarker: isSupplyDiagram,
        busFeedMarkerSide:
          isSupplyDiagram
            ? section.role === 'backup'
              ? 'below-right'
              : 'below-left'
            : undefined,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        phaseAssignment:
          sectionPhaseState.assignment ??
          getFullInstallationPhaseAssignment(installation?.nominalVoltage.system),
        fromElementType: 'mainBus',
        toElementType: 'mainBus',
      })
    })
  } else {
    const mainBusPhaseAssignment =
      panelIncomingPhaseState.assignment ??
      getFullInstallationPhaseAssignment(installation?.nominalVoltage.system)
    const waypoints: number[] = [busStartX, ...connectionXs, busEndX]
    const busSectionId = getPrimaryPanelBusSectionId(panel)

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
        busSectionId,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        phaseAssignment: mainBusPhaseAssignment,
        fromElementType: 'mainBus',
        toElementType: 'mainBus',
      })
    }
  }

  const busRuns = segments
    .slice(busSegmentStartIndex)
    .filter((segment) => segment.type === 'mainBus' && segment.busSectionId)
    .sort((left, right) => left.startPoint.x - right.startPoint.x)
    .reduce<WireSegment[]>((runs, segment) => {
      const previous = runs[runs.length - 1]
      if (
        previous &&
        previous.busSectionId === segment.busSectionId &&
        Math.abs(previous.endPoint.x - segment.startPoint.x) < 0.01
      ) {
        previous.endPoint = { ...segment.endPoint }
      } else {
        runs.push({
          ...segment,
          startPoint: { ...segment.startPoint },
          endPoint: { ...segment.endPoint },
        })
      }
      return runs
    }, [])
  const busRunForRole = (role: 'normal' | 'backup') =>
    busRuns.find((run) =>
      panel.busSections?.some((section) => section.id === run.busSectionId && section.role === role)
    )

  const feedOutputWire = panelNode.children.find((child) =>
    child.id?.startsWith('feed-output-wire-')
  )
  if (hasExplicitPanelBusSections(panel) && !isSupplyDiagram) {
    for (const [index, run] of busRuns.entries()) {
      const section = panel.busSections?.find((candidate) => candidate.id === run.busSectionId)
      const stubX = usesInlineEmptySplitAssembly
        ? (run.startPoint.x + run.endPoint.x) / 2
        : getLeftBiasedBusFeedStubX(run.startPoint.x, run.endPoint.x)
      const forceStubPhaseLabel = isPhaseAssignmentLabelVisible(
        run.phaseAssignment,
        installation?.nominalVoltage.system
      )
      segments.push({
        id: `bus-feed-stub-${diagramKey}-${run.busSectionId}-${index}`,
        type: 'vertical',
        startPoint: { x: stubX, y: mainBusY },
        endPoint: { x: stubX, y: mainBusY + 24 },
        cable: defaultCable,
        panelId: panel.id,
        busSectionId: run.busSectionId,
        busFeedKind: section?.role === 'backup' ? 'backup' : 'grid',
        showBusFeedMarker: true,
        busFeedMarkerSide: usesInlineEmptySplitAssembly
          ? 'stub-center'
          : undefined,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        phaseAssignment: run.phaseAssignment,
        forcePhaseLabel: forceStubPhaseLabel,
        phaseLabelAnchor: forceStubPhaseLabel ? { x: stubX + 5, y: mainBusY + 4 } : undefined,
        hideWireLabel: true,
        fromElementType: 'mainBus',
      })
    }
  }

  if (feedOutputWire && !(isSupplyDiagram && busRuns.length > 1)) {
    const outputX = feedOutputWire.bounds.x + feedOutputWire.bounds.width / 2
    segments.push({
      id: generateId(),
      type: 'vertical',
      startPoint: { x: outputX, y: mainBusY },
      endPoint: { x: outputX, y: feedOutputWire.bounds.y },
      cable: defaultCable,
      panelId: panel.id,
      domain: DEFAULT_ELECTRICAL_DOMAIN,
      hideWireLabel: true,
      fromElementType: 'mainBus',
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
      const adjustedStart = fromNode ? applyNodeWireInset(startPt, endPt, fromNode) : startPt
      const adjustedEnd = toNode ? applyNodeWireInset(endPt, startPt, toNode) : endPt
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
    renderedSupplyDeviceNodes = supplyTrunkDeviceNodes
    const verticalSupplyWireNode = findDescendantNode(
      panelNode.children,
      (node) => node.id === `supply-wire-vertical-${panel.id}`
    )
    const resolvedSupplyBendX = verticalSupplyWireNode
      ? verticalSupplyWireNode.bounds.x + verticalSupplyWireNode.bounds.width / 2
      : supplyTrunkDeviceNodes[0]?.bounds.x != null
        ? supplyTrunkDeviceNodes[0].bounds.x - LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
        : supplyNode.bounds.x
    const fullSupplyPhaseAssignment = getFullInstallationPhaseAssignment(
      installation?.nominalVoltage.system
    )
    const supplyDeviceById = new Map(
      [
        ...(installation?.mainSupply.supplyTrunkDevices ?? []),
        ...(feedTopology?.sharedFeed.trunkDevices ?? []),
        ...(rootFeed?.trunkDevices ?? []),
      ].map((device) => [device.id, device])
    )
    const resolveSupplyNodeDevice = (node: LayoutNode): TrunkDevice | undefined => {
      const candidate = node.domainRef as TrunkDevice | undefined
      const idFromLayout = node.id?.replace(/^supplyTrunkDevice-/, '')
      return (
        (node.domainId ? supplyDeviceById.get(node.domainId) : undefined) ??
        (idFromLayout ? supplyDeviceById.get(idFromLayout) : undefined) ??
        candidate
      )
    }
    const serialSupplyProtectionNodes = supplyTrunkDeviceNodes
      .filter((node) => {
        const device = resolveSupplyNodeDevice(node)
        return (
          device?.type === 'protection' &&
          (device.supplyPath == null || device.supplyPath === 'serial')
        )
      })
      .sort((left, right) => right.bounds.x - left.bounds.x)
    const applySupplyPhaseState = (segment: WireSegment, role: SupplyWireRole) => {
      const sampleX = (segment.startPoint.x + segment.endPoint.x) / 2
      const serialAssignment = serialSupplyProtectionNodes
        .filter((node) => node.bounds.x > sampleX)
        .reduce(
          (assignment, node) =>
            getDownstreamProtectionPhaseAssignment(
              resolveSupplyNodeDevice(node)!,
              installation?.nominalVoltage.system,
              assignment
            ),
          fullSupplyPhaseAssignment
        )
      const hasSerialReduction =
        serialAssignment?.phases.join('|') !== fullSupplyPhaseAssignment?.phases.join('|')
      segment.phaseAssignment =
        role === 'downstream' && !hasSerialReduction
          ? (panelIncomingPhaseState.assignment ?? serialAssignment)
          : serialAssignment
      segment.showPhaseLabel = hasSerialReduction && panelIncomingPhaseState.showPhaseLabel === true
    }

    const applySupplyLabelVisibility = (
      verticalSeg: WireSegment | undefined,
      mergeCrossingWithBusDrop: boolean
    ) => {
      if (!installation || !verticalSeg) return
      const hasSectionVisibilityOverride = (segment: WireSegment) =>
        segment.supplySectionKey != null &&
        rootFeed?.wireSections?.[segment.supplySectionKey]?.hideWireLabel !== undefined
      const downstreamHidden = getSupplyWireHideWireLabelForRole(
        installation,
        panels,
        panel,
        'downstream'
      )
      const crossingHidden = getSupplyWireHideWireLabelForRole(
        installation,
        panels,
        panel,
        'crossing'
      )
      const upstreamHidden = getSupplyWireHideWireLabelForRole(
        installation,
        panels,
        panel,
        'upstream'
      )
      if (mergeCrossingWithBusDrop) {
        verticalSeg.supplyMergesCrossingToBus = true
        if (!hasSectionVisibilityOverride(verticalSeg)) {
          verticalSeg.hideWireLabel = downstreamHidden
        }
      } else if (!hasSectionVisibilityOverride(verticalSeg)) {
        verticalSeg.hideWireLabel = true
      }
      for (const seg of segments) {
        if (!seg.isSupplyTrunk || seg.type !== 'branch') continue
        if (seg.supplyMergedIntoBusDrop) {
          if (!hasSectionVisibilityOverride(seg)) seg.hideWireLabel = true
          continue
        }
        if (seg.supplyWireRole === 'upstream') {
          if (!hasSectionVisibilityOverride(seg)) seg.hideWireLabel = upstreamHidden
          continue
        }
        if (seg.supplyWireRole === 'crossing' && !mergeCrossingWithBusDrop) {
          if (!hasSectionVisibilityOverride(seg)) seg.hideWireLabel = crossingHidden
          continue
        }
        if (seg.supplyWireRole === 'downstream' && !mergeCrossingWithBusDrop) {
          if (!hasSectionVisibilityOverride(seg)) seg.hideWireLabel = downstreamHidden
        }
      }
    }

    const pushConverterDcWires = (converterNode: LayoutNode) => {
      const converterX = converterNode.bounds.x
      const converterY = converterNode.bounds.y
      const dcDeviceNodes = supplyTrunkDeviceNodes
        .filter(
          (node) => (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'converter-dc'
        )
        .sort((a, b) => a.bounds.x - b.bounds.x)
      const dcTopDeviceNodes = supplyTrunkDeviceNodes
        .filter(
          (node) => (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'converter-dc-top'
        )
        .sort((a, b) => a.bounds.x - b.bounds.x)
      const converterRight = applyNodeWireInset(
        { x: converterX, y: converterY },
        {
          x:
            dcDeviceNodes[0]?.bounds.x ??
            converterX + LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH,
          y: converterY,
        },
        converterNode
      )
      const dcWaypoints = [
        { point: converterRight, node: undefined as LayoutNode | undefined },
        ...dcDeviceNodes.map((node) => ({ point: { x: node.bounds.x, y: node.bounds.y }, node })),
        ...(dcDeviceNodes.length === 0
          ? [
              {
                point: {
                  x: converterX + LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH,
                  y: converterY,
                },
                node: undefined as LayoutNode | undefined,
              },
            ]
          : []),
      ]
      const dcPathNodeIds = [
        converterNode.domainId,
        ...dcDeviceNodes.map((node) => node.domainId),
      ].filter((id): id is string => !!id)
      const dcSectionEndpoints = [
        `converter:${converterNode.domainId ?? panel.id}:dc-right`,
        ...dcDeviceNodes.map((node) => `device:${node.domainId ?? node.id}`),
        ...(dcDeviceNodes.length === 0
          ? [`dc-open:${converterNode.domainId ?? panel.id}:right`]
          : []),
      ]
      for (let index = 0; index < dcWaypoints.length - 1; index++) {
        const from = dcWaypoints[index]!
        const to = dcWaypoints[index + 1]!
        const start = from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point
        const end = to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point
        segments.push(
          applyAssemblyConnection(
            applySupplySection(
              {
                id: generateId(),
                type: 'branch',
                startPoint: start,
                endPoint: end,
                cable: fallbackCable,
                panelId: panel.id,
                domain: 'DC',
                hideWireLabel: true,
              },
              supplySectionKey(
                'converter-dc-right',
                dcSectionEndpoints[index]!,
                dcSectionEndpoints[index + 1]!
              )
            ),
            findAssemblyConnection(dcPathNodeIds[index], dcPathNodeIds[index + 1])
          )
        )
      }

      const topDcWireNode = findDescendantNode(
        panelNode.children,
        (node) => node.id?.startsWith('supply-direct-converter-dc-top-') === true
      )
      if (dcTopDeviceNodes.length === 0 || !topDcWireNode) return
      const topY = topDcWireNode.bounds.y + topDcWireNode.bounds.height / 2
      const converterTop = applyNodeWireInset(
        { x: converterX, y: converterY },
        { x: converterX, y: topY },
        converterNode
      )
      const topDcPathNodeIds = [
        converterNode.domainId,
        ...dcTopDeviceNodes.map((node) => node.domainId),
      ].filter((id): id is string => !!id)
      const topDcSectionEndpoints = [
        `converter:${converterNode.domainId ?? panel.id}:dc-top`,
        ...dcTopDeviceNodes.map((node) => `device:${node.domainId ?? node.id}`),
      ]
      const firstTopDcSectionKey = supplySectionKey(
        'converter-dc-top',
        topDcSectionEndpoints[0]!,
        topDcSectionEndpoints[1]!
      )
      const firstTopDcConnection = findAssemblyConnection(topDcPathNodeIds[0], topDcPathNodeIds[1])
      segments.push(
        applyAssemblyConnection(
          applySupplySection(
            {
              id: generateId(),
              type: 'vertical',
              startPoint: converterTop,
              endPoint: { x: converterX, y: topY },
              cable: fallbackCable,
              panelId: panel.id,
              domain: 'DC',
              hideWireLabel: true,
            },
            firstTopDcSectionKey
          ),
          firstTopDcConnection
        )
      )
      const topWaypoints = [
        { point: { x: converterX, y: topY }, node: undefined as LayoutNode | undefined },
        ...dcTopDeviceNodes.map((node) => ({
          point: { x: node.bounds.x, y: node.bounds.y },
          node,
        })),
      ]
      for (let index = 0; index < topWaypoints.length - 1; index++) {
        const from = topWaypoints[index]!
        const to = topWaypoints[index + 1]!
        const start = from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point
        const end = to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point
        segments.push(
          applyAssemblyConnection(
            applySupplySection(
              {
                id: generateId(),
                type: 'branch',
                startPoint: start,
                endPoint: end,
                cable: fallbackCable,
                panelId: panel.id,
                domain: 'DC',
                hideWireLabel: true,
              },
              supplySectionKey(
                'converter-dc-top',
                topDcSectionEndpoints[index]!,
                topDcSectionEndpoints[index + 1]!
              )
            ),
            findAssemblyConnection(topDcPathNodeIds[index], topDcPathNodeIds[index + 1])
          )
        )
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
      connection?: SupplyConnection,
      sectionKey?: string
    ) => {
      const spans = splitHorizontalSpanAtSeparator(
        start.x,
        end.x,
        separatorX,
        fromEndpoint,
        toEndpoint
      )
      for (const span of spans) {
        const spanLeft = Math.min(span.x1, span.x2)
        const touchesBend = Math.abs(spanLeft - supplyBendX) < 1
        const mergeThisCrossing =
          mergeCrossingWithBusDrop === true && span.role === 'crossing' && touchesBend

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
                mergeThisCrossing ? 'downstream' : span.role
              )
            : fallbackCable,
          panelId: panel.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
          hideWireLabel: true,
          isSupplyTrunk: true,
          supplyWireRole: span.role,
        }
        if (span.role === 'crossing' && separatorX != null) {
          // Keep the visual panel-boundary anchor on the actual crossing span.
          // Canvas and preview rendering consume this coordinate instead of
          // independently reconstructing it from layout-device positions.
          seg.supplySeparatorX = separatorX
        }
        if (mergeThisCrossing) {
          seg.supplyMergedIntoBusDrop = true
        }
        if (installation) {
          applySupplyWireRoleToSegment(
            seg,
            mergeThisCrossing ? 'downstream' : span.role,
            installation,
            panels,
            panel
          )
          applySupplyPhaseState(seg, mergeThisCrossing ? 'downstream' : span.role)
        } else if (span.role !== 'downstream') {
          seg.hideWireLabel = true
        }
        segments.push(applyAssemblyConnection(applySupplySection(seg, sectionKey), connection))
      }
    }

    const sourceChangeoverNode = supplyTrunkDeviceNodes.find(
      (node) => getNodeSymbolId(node) === 'source_changeover'
    )
    const directConverterNode = supplyTrunkDeviceNodes.find(
      (node) => (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'converter-branch'
    )
    const utilityAssemblyNodeId = supplyAssembly?.nodes.find(
      (node) => node.kind === 'utility-source'
    )?.id
    // Assemblies may fan out to multiple main panels. Select the handoff that
    // targets the panel currently being rendered; using the first handoff made
    // every additional main panel inherit the original panel's wire path.
    const handoffAssemblyNodeId = supplyAssembly?.loadHandoffs.find(
      (handoff) =>
        (handoff.target.kind === 'panel-input' ||
          handoff.target.kind === 'panel-bus-input' ||
          handoff.target.kind === 'circuit-input') &&
        handoff.target.panelId === panel.id
    )?.handoffNodeId ?? supplyAssembly?.nodes.find((node) => node.kind === 'panel-handoff')?.id
    const currentPanelHandoffConnection = supplyAssembly?.connections.find((connection) =>
      connection.endpoints.some(({ nodeId }) => nodeId === handoffAssemblyNodeId)
    )

    if (sourceChangeoverNode) {
      const changeoverX = sourceChangeoverNode.bounds.x
      const changeoverY = sourceChangeoverNode.bounds.y
      const backupBusRun = busRunForRole('backup')
      const gridBusRun = busRunForRole('normal')
      const bendX = backupBusRun
        ? getLeftBiasedBusFeedStubX(backupBusRun.startPoint.x, backupBusRun.endPoint.x)
        : resolvedSupplyBendX
      const portOffset = (LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE * 7) / 24
      const rightPortX = changeoverX + LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE / 2
      const elbowX = rightPortX + LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_ELBOW_LEAD
      const backupConverterNode = supplyTrunkDeviceNodes.find(
        (node) => (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'backup'
      )
      const converterGridInputConnected =
        (backupConverterNode?.domainRef as TrunkDevice | undefined)?.converterGridInputConnected !==
        false
      const backupOutputNodes = supplyTrunkDeviceNodes
        .filter(
          (node) => (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'backup-output'
        )
        .sort((a, b) => a.bounds.x - b.bounds.x)
      const converterGridNodes = supplyTrunkDeviceNodes
        .filter(
          (node) =>
            (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'converter-grid' &&
            (node.domainRef as TrunkDevice | undefined)?.converterGridPlacement !== 'input-leg'
        )
        .sort((a, b) => a.bounds.x - b.bounds.x)
      const converterGridInputLegNodes = supplyTrunkDeviceNodes
        .filter(
          (node) =>
            (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'converter-grid' &&
            (node.domainRef as TrunkDevice | undefined)?.converterGridPlacement === 'input-leg'
        )
        .sort((a, b) => a.bounds.y - b.bounds.y)
      const upperY =
        backupConverterNode?.bounds.y ??
        changeoverY - LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_LANE_OFFSET
      const lowerY = supplyNode.bounds.y
      const slotEndX =
        backupConverterNode?.bounds.x ?? elbowX + LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_SLOT_LENGTH

      const pushChangeoverWire = (
        startPoint: { x: number; y: number },
        endPoint: { x: number; y: number },
        role: SupplyWireRole,
        connection?: SupplyConnection,
        busFeed?: {
          busSectionId: string
          kind: 'grid' | 'backup'
        },
        sectionKey?: string
      ): WireSegment | undefined => {
        if (startPoint.x === endPoint.x && startPoint.y === endPoint.y) return undefined
        const segment: WireSegment = {
          id: generateId(),
          type: startPoint.x === endPoint.x ? 'vertical' : 'branch',
          startPoint,
          endPoint,
          cable: installation
            ? cableForSupplyWireRole(installation, panels, panel, role)
            : fallbackCable,
          panelId: panel.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
          hideWireLabel: true,
          isSupplyTrunk: true,
          supplyWireRole: role,
          supplyFeedScope: role === 'downstream' ? 'root' : 'shared',
          ...(busFeed
            ? {
                busSectionId: busFeed.busSectionId,
                busFeedKind: busFeed.kind,
                fromElementType: 'mainBus' as const,
              }
            : {}),
        }
        if (installation) {
          applySupplyWireRoleToSegment(segment, role, installation, panels, panel)
          applySupplyPhaseState(segment, role)
        }
        const connectedSegment = applyAssemblyConnection(
          applySupplySection(segment, sectionKey),
          connection
        )
        segments.push(connectedSegment)
        return connectedSegment
      }

      const loadConnection = findAssemblyConnection(
        sourceChangeoverNode.domainId,
        handoffAssemblyNodeId,
        'load-ac'
      )
      const loadBusDropSegment = pushChangeoverWire(
        { x: bendX, y: mainBusY },
        { x: bendX, y: changeoverY },
        'downstream',
        loadConnection,
        backupBusRun?.busSectionId
          ? {
              busSectionId: backupBusRun.busSectionId,
              kind: 'backup',
            }
          : undefined
      )

      const outputNodes = supplyTrunkDeviceNodes.filter((node) => {
        const supplyPath = (node.domainRef as TrunkDevice | undefined)?.supplyPath
        return node.bounds.x < changeoverX && (supplyPath == null || supplyPath === 'serial')
      })
      const outputWaypoints = [
        { point: { x: bendX, y: changeoverY }, node: undefined as LayoutNode | undefined },
        ...outputNodes.map((node) => ({ point: { x: node.bounds.x, y: changeoverY }, node })),
        { point: { x: changeoverX, y: changeoverY }, node: sourceChangeoverNode },
      ]
      const outputSectionEndpoints = [
        `backup-bus:${backupBusRun?.busSectionId ?? panel.id}`,
        ...outputNodes.map((node) => `device:${node.domainId ?? node.id}`),
        `changeover:${sourceChangeoverNode.domainId ?? sourceChangeoverNode.id}:load`,
      ]
      const outputSectionKey = (index: number) =>
        supplySectionKey(
          'changeover-load',
          outputSectionEndpoints[index]!,
          outputSectionEndpoints[index + 1]!
        )
      if (loadBusDropSegment) applySupplySection(loadBusDropSegment, outputSectionKey(0))
      for (let index = 0; index < outputWaypoints.length - 1; index++) {
        const from = outputWaypoints[index]!
        const to = outputWaypoints[index + 1]!
        const start = from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point
        const end = to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point
        pushChangeoverWire(
          start,
          end,
          'downstream',
          loadConnection,
          undefined,
          outputSectionKey(index)
        )
      }

      const upperPortY = changeoverY - portOffset
      const backupPathNodeIds = [
        sourceChangeoverNode.domainId,
        ...backupOutputNodes.map((node) => node.domainId),
        backupConverterNode?.domainId,
      ].filter((id): id is string => !!id)
      const firstBackupConnection =
        findAssemblyPortConnection(sourceChangeoverNode.domainId, 'backup') ??
        findAssemblyConnection(backupPathNodeIds[0], backupPathNodeIds[1], 'inverter-backup-ac')
      const backupSectionEndpoints = [
        `changeover:${sourceChangeoverNode.domainId ?? sourceChangeoverNode.id}:backup`,
        ...backupOutputNodes.map((node) => `device:${node.domainId ?? node.id}`),
        backupConverterNode
          ? `converter:${backupConverterNode.domainId ?? backupConverterNode.id}:backup`
          : `backup-slot:${panel.id}`,
      ]
      const backupSectionKey = (index: number) =>
        supplySectionKey(
          'changeover-backup',
          backupSectionEndpoints[index]!,
          backupSectionEndpoints[index + 1]!
        )
      const firstBackupSectionKey = backupSectionKey(0)
      const backupChangeoverInputSegment = pushChangeoverWire(
        { x: rightPortX, y: upperPortY },
        { x: elbowX, y: upperPortY },
        'upstream',
        firstBackupConnection,
        undefined,
        firstBackupSectionKey
      )
      pushChangeoverWire(
        { x: elbowX, y: upperPortY },
        { x: elbowX, y: upperY },
        'upstream',
        firstBackupConnection,
        undefined,
        firstBackupSectionKey
      )
      if (backupConverterNode) {
        const backupWaypoints = [
          { point: { x: elbowX, y: upperY }, node: undefined as LayoutNode | undefined },
          ...backupOutputNodes.map((node) => ({ point: { x: node.bounds.x, y: upperY }, node })),
          {
            point: { x: backupConverterNode.bounds.x, y: upperY },
            node: backupConverterNode,
          },
        ]
        for (let index = 0; index < backupWaypoints.length - 1; index++) {
          const from = backupWaypoints[index]!
          const to = backupWaypoints[index + 1]!
          const start = from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point
          const end = to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point
          pushChangeoverWire(
            start,
            end,
            'upstream',
            findAssemblyConnection(
              backupPathNodeIds[index],
              backupPathNodeIds[index + 1],
              'inverter-backup-ac'
            ),
            undefined,
            backupSectionKey(index)
          )
        }

        // The converter's grid AC connection is its bottom port. The right-hand port is
        // deliberately left free for the shared battery/PV DC connection.
        if (converterGridInputConnected) {
          const converterBottom = applyNodeWireInset(
            { x: backupConverterNode.bounds.x, y: backupConverterNode.bounds.y },
            { x: backupConverterNode.bounds.x, y: lowerY },
            backupConverterNode
          )
          const inputLegWaypoints = [
            { point: converterBottom, node: undefined as LayoutNode | undefined },
            ...converterGridInputLegNodes.map((node) => ({
              point: { x: node.bounds.x, y: node.bounds.y },
              node,
            })),
            {
              point: { x: backupConverterNode.bounds.x, y: lowerY },
              node: undefined as LayoutNode | undefined,
            },
          ]
          const inputLegNodeIds = [
            backupConverterNode.domainId,
            ...converterGridInputLegNodes.map((node) => node.domainId),
            utilityAssemblyNodeId,
          ].filter((id): id is string => !!id)
          const inputLegSectionEndpoints = [
            `converter:${backupConverterNode.domainId ?? backupConverterNode.id}:grid`,
            ...converterGridInputLegNodes.map((node) => `device:${node.domainId ?? node.id}`),
            `converter-grid-tap:${backupConverterNode.domainId ?? backupConverterNode.id}`,
          ]
          for (let index = 0; index < inputLegWaypoints.length - 1; index++) {
            const from = inputLegWaypoints[index]!
            const to = inputLegWaypoints[index + 1]!
            pushChangeoverWire(
              from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point,
              to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point,
              'upstream',
              findAssemblyConnection(
                inputLegNodeIds[index],
                inputLegNodeIds[index + 1],
                'inverter-grid-ac'
              ) ?? findAssemblyPortConnection(backupConverterNode.domainId, 'grid'),
              undefined,
              supplySectionKey(
                'changeover-converter-input',
                inputLegSectionEndpoints[index]!,
                inputLegSectionEndpoints[index + 1]!
              )
            )
          }
        }
        pushConverterDcWires(backupConverterNode)
      } else {
        const backupWaypoints = [
          { point: { x: elbowX, y: upperY }, node: undefined as LayoutNode | undefined },
          ...backupOutputNodes.map((node) => ({ point: { x: node.bounds.x, y: upperY }, node })),
          { point: { x: slotEndX, y: upperY }, node: undefined as LayoutNode | undefined },
        ]
        for (let index = 0; index < backupWaypoints.length - 1; index++) {
          const from = backupWaypoints[index]!
          const to = backupWaypoints[index + 1]!
          const start = from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point
          const end = to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point
          pushChangeoverWire(start, end, 'upstream', undefined, undefined, backupSectionKey(index))
        }
      }

      const lowerPortY = changeoverY + portOffset
      const changeoverGridNodes = supplyTrunkDeviceNodes
        .filter(
          (node) => (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'changeover-grid'
        )
        .sort((a, b) => a.bounds.x - b.bounds.x)
      const changeoverGridPathNodeIds = [
        sourceChangeoverNode.domainId,
        ...changeoverGridNodes.map((node) => node.domainId),
        utilityAssemblyNodeId,
      ].filter((id): id is string => !!id)
      const changeoverGridConnections = changeoverGridPathNodeIds
        .slice(0, -1)
        .map((nodeId, index) =>
          findAssemblyConnection(nodeId, changeoverGridPathNodeIds[index + 1], 'grid-ac')
        )
      const firstChangeoverGridConnection =
        findAssemblyPortConnection(sourceChangeoverNode.domainId, 'grid') ??
        changeoverGridConnections[0]
      const changeoverGridSectionEndpoints = [
        `utility:${utilityAssemblyNodeId ?? panel.id}`,
        ...changeoverGridNodes.map((node) => `device:${node.domainId ?? node.id}`),
        `changeover:${sourceChangeoverNode.domainId ?? sourceChangeoverNode.id}:grid`,
      ]
      const changeoverGridSectionKey = (index: number) =>
        supplySectionKey(
          'changeover-grid',
          changeoverGridSectionEndpoints[index]!,
          changeoverGridSectionEndpoints[index + 1]!
        )
      const changeoverGridSwitchSectionKey = changeoverGridSectionKey(
        changeoverGridSectionEndpoints.length - 2
      )
      const gridChangeoverInputSegment = pushChangeoverWire(
        { x: rightPortX, y: lowerPortY },
        { x: elbowX, y: lowerPortY },
        'upstream',
        firstChangeoverGridConnection,
        undefined,
        changeoverGridSwitchSectionKey
      )
      pushChangeoverWire(
        { x: elbowX, y: lowerPortY },
        { x: elbowX, y: lowerY },
        'upstream',
        firstChangeoverGridConnection,
        undefined,
        changeoverGridSwitchSectionKey
      )

      const backupInputAssignment = backupChangeoverInputSegment?.phaseAssignment
      const gridInputAssignment = gridChangeoverInputSegment?.phaseAssignment
      if (
        backupInputAssignment &&
        gridInputAssignment &&
        backupInputAssignment.phases.join('|') !== gridInputAssignment.phases.join('|')
      ) {
        backupChangeoverInputSegment.forcePhaseLabel = true
        backupChangeoverInputSegment.phaseLabelAnchor = {
          x: elbowX + 5,
          y: upperPortY - 20,
        }
        gridChangeoverInputSegment.forcePhaseLabel = true
        gridChangeoverInputSegment.phaseLabelAnchor = {
          x: elbowX + 5,
          y: lowerPortY + 4,
        }
      }

      if (gridBusRun?.busSectionId) {
        const gridBusX = getLeftBiasedBusFeedStubX(gridBusRun.startPoint.x, gridBusRun.endPoint.x)
        const gridBusConnection =
          findAssemblyConnection(
            utilityAssemblyNodeId,
            changeoverGridNodes[0]?.domainId ?? sourceChangeoverNode.domainId,
            'grid-ac'
          ) ?? firstChangeoverGridConnection
        pushChangeoverWire(
          { x: gridBusX, y: mainBusY },
          { x: gridBusX, y: lowerY },
          'upstream',
          gridBusConnection,
          {
            busSectionId: gridBusRun.busSectionId,
            kind: 'grid',
          },
          changeoverGridSectionKey(0)
        )
        const gridRailWaypoints = [
          {
            point: { x: gridBusX, y: lowerY },
            node: undefined as LayoutNode | undefined,
          },
          ...changeoverGridNodes.map((node) => ({
            point: { x: node.bounds.x, y: lowerY },
            node,
          })),
          {
            point: { x: elbowX, y: lowerY },
            node: undefined as LayoutNode | undefined,
          },
        ]
        const gridRailPathNodeIds = [
          utilityAssemblyNodeId,
          ...changeoverGridNodes.map((node) => node.domainId),
          sourceChangeoverNode.domainId,
        ].filter((id): id is string => !!id)
        for (let index = 0; index < gridRailWaypoints.length - 1; index++) {
          const from = gridRailWaypoints[index]!
          const to = gridRailWaypoints[index + 1]!
          const start = from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point
          const end = to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point
          pushChangeoverWire(
            start,
            end,
            'upstream',
            findAssemblyConnection(
              gridRailPathNodeIds[index],
              gridRailPathNodeIds[index + 1],
              'grid-ac'
            ) ?? firstChangeoverGridConnection,
            undefined,
            changeoverGridSectionKey(index)
          )
        }
      }

      const gridNodes = supplyTrunkDeviceNodes
        .filter(
          (node) =>
            node.bounds.x > changeoverX &&
            ![
              'backup',
              'backup-output',
              'converter-grid',
              'converter-dc',
              'converter-dc-top',
            ].includes((node.domainRef as TrunkDevice | undefined)?.supplyPath ?? '')
        )
        .sort((left, right) => left.bounds.x - right.bounds.x)
      const supplyInset = applyNodeWireInset(
        { x: supplyNode.bounds.x, y: lowerY },
        { x: gridNodes.at(-1)?.bounds.x ?? elbowX, y: lowerY },
        supplyNode
      )
      const gridWaypoints = [
        {
          point: { x: elbowX, y: lowerY },
          node: undefined as LayoutNode | undefined,
          sectionEndpointId: `changeover-grid-tap:${sourceChangeoverNode.domainId ?? sourceChangeoverNode.id}`,
        },
        ...converterGridNodes.map((node) => ({
          point: { x: node.bounds.x, y: lowerY },
          node,
          sectionEndpointId: `device:${node.domainId ?? node.id}`,
        })),
        ...gridNodes.map((node) => ({
          point: { x: node.bounds.x, y: lowerY },
          node,
          sectionEndpointId: `device:${node.domainId ?? node.id}`,
        })),
        ...(backupConverterNode && converterGridInputConnected
          ? [
              {
                point: { x: backupConverterNode.bounds.x, y: lowerY },
                node: undefined as LayoutNode | undefined,
                sectionEndpointId: `converter-grid-tap:${backupConverterNode.domainId ?? backupConverterNode.id}`,
              },
            ]
          : []),
        {
          point: supplyInset,
          node: undefined as LayoutNode | undefined,
          sectionEndpointId: `utility:${utilityAssemblyNodeId ?? panel.id}`,
        },
      ].sort((a, b) => a.point.x - b.point.x)
      for (let index = 0; index < gridWaypoints.length - 1; index++) {
        const from = gridWaypoints[index]!
        const to = gridWaypoints[index + 1]!
        const start = from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point
        const end = to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point
        const midpointX = (start.x + end.x) / 2
        const converterGridPathNodeIds = [
          utilityAssemblyNodeId,
          ...converterGridNodes.map((node) => node.domainId),
          backupConverterNode?.domainId,
        ].filter((id): id is string => !!id)
        const converterGridPathXs = [
          elbowX,
          ...converterGridNodes.map((node) => node.bounds.x),
          backupConverterNode?.bounds.x ?? supplyInset.x,
        ]
        const converterGridPathIndex = converterGridPathXs.findIndex(
          (x, candidateIndex) =>
            candidateIndex < converterGridPathXs.length - 1 &&
            midpointX >= Math.min(x, converterGridPathXs[candidateIndex + 1]!) &&
            midpointX <= Math.max(x, converterGridPathXs[candidateIndex + 1]!)
        )
        pushChangeoverWire(
          start,
          end,
          'upstream',
          converterGridPathIndex >= 0
            ? findAssemblyConnection(
                converterGridPathNodeIds[converterGridPathIndex],
                converterGridPathNodeIds[converterGridPathIndex + 1],
                'inverter-grid-ac'
              )
            : undefined,
          undefined,
          supplySectionKey('changeover-shared-grid', from.sectionEndpointId, to.sectionEndpointId)
        )
      }
    } else if (directConverterNode) {
      const supplyY = supplyNode.bounds.y
      const bendX = resolvedSupplyBendX
      const converterX = directConverterNode.bounds.x
      const converterY = directConverterNode.bounds.y
      const converterGridInputConnected =
        (directConverterNode.domainRef as TrunkDevice | undefined)?.converterGridInputConnected !==
        false
      const backupBusRun = busRunForRole('backup')
      const gridBusRun = busRunForRole('normal')
      const usesDirectSplitFeed = Boolean(backupBusRun && gridBusRun)
      const directGridBusX =
        usesDirectSplitFeed && gridBusRun
          ? getLeftBiasedBusFeedStubX(gridBusRun.startPoint.x, gridBusRun.endPoint.x)
          : undefined
      const converterGridNodes = supplyTrunkDeviceNodes
        .filter(
          (node) =>
            (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'converter-grid' &&
            (node.domainRef as TrunkDevice | undefined)?.converterGridPlacement !== 'input-leg'
        )
        .sort((a, b) => a.bounds.x - b.bounds.x)
      const converterGridInputLegNodes = supplyTrunkDeviceNodes
        .filter(
          (node) =>
            (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'converter-grid' &&
            (node.domainRef as TrunkDevice | undefined)?.converterGridPlacement === 'input-leg'
        )
        .sort((a, b) => a.bounds.y - b.bounds.y)
      const serialNodes = supplyTrunkDeviceNodes.filter(
        (node) =>
          !['converter-branch', 'converter-grid', 'converter-dc', 'converter-dc-top'].includes(
            (node.domainRef as TrunkDevice | undefined)?.supplyPath ?? ''
          )
      )
      // Only devices that actually touch the shared/root supply run may influence
      // its enclosure boundary. DC branch devices move independently.
      const horizontalSupplyNodes = [
        ...serialNodes,
        ...(converterGridInputConnected ? [directConverterNode] : []),
      ]
      const supplyInset = applyNodeWireInset(
        { x: supplyNode.bounds.x, y: supplyY },
        { x: serialNodes.at(-1)?.bounds.x ?? converterX, y: supplyY },
        supplyNode
      )
      const devicePositions = horizontalSupplyNodes.map((node) => ({
        x: node.bounds.x,
        feedScope: installation
          ? resolveSupplyFeedScopeForDeviceId(installation, panels, panel, node.domainId ?? '')
          : ('shared' as const),
      }))
      const separatorX = computeSupplySeparatorX(devicePositions, supplyInset.x, bendX)
      const mergeCrossingWithBusDrop = installation
        ? shouldMergeSupplyCrossingWithBusDrop(bendX, separatorX, devicePositions)
        : false

      const vertical: WireSegment | undefined = usesDirectSplitFeed
        ? undefined
        : {
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
      if (vertical) {
        if (installation) {
          applySupplyWireRoleToSegment(vertical, 'downstream', installation, panels, panel)
          applySupplyPhaseState(vertical, 'downstream')
        }
        segments.push(vertical)
      }

      const horizontalWaypoints: Array<{
        point: { x: number; y: number }
        node?: LayoutNode
        assemblyNodeId?: string
        sectionEndpointId?: string
      }> = [
        ...(directGridBusX != null
          ? [
              {
                point: { x: directGridBusX, y: supplyY },
                sectionEndpointId: `grid-bus:${gridBusRun?.busSectionId ?? panel.id}`,
              },
            ]
          : [
              {
                point: { x: bendX, y: supplyY },
                sectionEndpointId: `panel-bus:${panel.id}`,
              },
            ]),
        ...serialNodes.map((node) => ({
          point: { x: node.bounds.x, y: supplyY },
          node,
          assemblyNodeId: supplyAssembly?.nodes.some(({ id }) => id === node.domainId)
            ? node.domainId
            : undefined,
          sectionEndpointId: node.domainId ? `device:${node.domainId}` : undefined,
        })),
        ...converterGridNodes.map((node) => ({
          point: { x: node.bounds.x, y: supplyY },
          node,
          assemblyNodeId: node.domainId,
          sectionEndpointId: node.domainId ? `device:${node.domainId}` : undefined,
        })),
        ...(converterGridInputConnected
          ? [
              {
                point: { x: converterX, y: supplyY },
                assemblyNodeId: directConverterNode.domainId,
                sectionEndpointId: `converter:${directConverterNode.domainId}`,
              },
            ]
          : []),
        {
          point: supplyInset,
          assemblyNodeId: utilityAssemblyNodeId,
          sectionEndpointId: `utility:${utilityAssemblyNodeId ?? panel.id}`,
        },
      ].sort((a, b) => a.point.x - b.point.x)
      const directGridSectionKey = (index: number): string | undefined => {
        let leftIndex = index
        while (leftIndex >= 0 && !horizontalWaypoints[leftIndex]?.sectionEndpointId) leftIndex--
        let rightIndex = index + 1
        while (
          rightIndex < horizontalWaypoints.length &&
          !horizontalWaypoints[rightIndex]?.sectionEndpointId
        ) {
          rightIndex++
        }
        const left = horizontalWaypoints[leftIndex]?.sectionEndpointId
        const right = horizontalWaypoints[rightIndex]?.sectionEndpointId
        return left && right ? supplySectionKey('direct-grid', left, right) : undefined
      }
      const handoffConnection = findAssemblyConnection(
        directConverterNode.domainId,
        handoffAssemblyNodeId,
        'load-ac'
      )
      const gridHandoffConnection = findAssemblyConnection(
        utilityAssemblyNodeId,
        handoffAssemblyNodeId,
        'grid-only-bypass-ac'
      )
      const utilityConnection = findAssemblyConnection(
        directConverterNode.domainId,
        utilityAssemblyNodeId,
        'inverter-grid-ac'
      )
      for (let index = 0; index < horizontalWaypoints.length - 1; index++) {
        const from = horizontalWaypoints[index]!
        const to = horizontalWaypoints[index + 1]!
        const start = from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point
        const end = to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point
        const touchesGridBus =
          from.sectionEndpointId?.startsWith('grid-bus:') === true ||
          to.sectionEndpointId?.startsWith('grid-bus:') === true
        const exactConnection = findAssemblyConnection(from.assemblyNodeId, to.assemblyNodeId)
        const touchesUnmodeledDevice = [from, to].some(
          (waypoint) =>
            waypoint.sectionEndpointId?.startsWith('device:') === true && !waypoint.assemblyNodeId
        )
        const connection =
          exactConnection ??
          (touchesGridBus || touchesUnmodeledDevice
            ? undefined
            : usesDirectSplitFeed
              ? utilityConnection
              : (start.x + end.x) / 2 < converterX
                ? (handoffConnection ?? gridHandoffConnection)
                : utilityConnection)
        pushSupplyHorizontal(
          bendX,
          start,
          end,
          separatorX,
          index === 0 ? 'bend' : undefined,
          index === horizontalWaypoints.length - 2 ? 'supply' : undefined,
          mergeCrossingWithBusDrop,
          connection,
          directGridSectionKey(index)
        )
      }
      if (vertical) {
        const bendWaypointIndex = horizontalWaypoints.findIndex(
          ({ point }) => Math.abs(point.x - bendX) < 1
        )
        applySupplySection(
          vertical,
          bendWaypointIndex >= 0 ? directGridSectionKey(bendWaypointIndex) : undefined
        )
      }

      const pushDirectAcWire = (
        startPoint: { x: number; y: number },
        endPoint: { x: number; y: number },
        connection?: SupplyConnection,
        options?: {
          role?: SupplyWireRole
          busSectionId?: string
          busFeedKind?: 'grid' | 'backup'
          sectionKey?: string
        }
      ): WireSegment | undefined => {
        if (startPoint.x === endPoint.x && startPoint.y === endPoint.y) return undefined
        const role = options?.role ?? 'upstream'
        const segment: WireSegment = {
          id: generateId(),
          type: startPoint.x === endPoint.x ? 'vertical' : 'branch',
          startPoint,
          endPoint,
          cable: installation
            ? cableForSupplyWireRole(installation, panels, panel, role)
            : fallbackCable,
          panelId: panel.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
          hideWireLabel: true,
          isSupplyTrunk: true,
          supplyWireRole: role,
          supplyFeedScope: 'root',
          ...(options?.busSectionId
            ? {
                busSectionId: options.busSectionId,
                busFeedKind: options.busFeedKind,
                fromElementType: 'mainBus' as const,
              }
            : {}),
        }
        if (installation) {
          applySupplyWireRoleToSegment(segment, role, installation, panels, panel)
          applySupplyPhaseState(segment, role)
        }
        const connectedSegment = applyAssemblyConnection(
          applySupplySection(segment, options?.sectionKey),
          connection
        )
        segments.push(connectedSegment)
        return connectedSegment
      }
      if (usesDirectSplitFeed && backupBusRun && gridBusRun) {
        const backupBusX = getLeftBiasedBusFeedStubX(
          backupBusRun.startPoint.x,
          backupBusRun.endPoint.x
        )
        const gridBusX = getLeftBiasedBusFeedStubX(gridBusRun.startPoint.x, gridBusRun.endPoint.x)
        const backupConnection = findAssemblyConnection(
          directConverterNode.domainId,
          handoffAssemblyNodeId,
          'inverter-backup-ac'
        )
        const converterBackupInset = applyNodeWireInset(
          { x: converterX, y: converterY },
          { x: backupBusX, y: converterY },
          directConverterNode
        )
        const directBackupProtectionNode = mainBusNode.children.find((child) => {
          if (child.type !== 'mcb' || !child.circuitIdForWires) return false
          const circuit = findCircuitByIdInPanel(panel, child.circuitIdForWires)
          return (
            circuit?.supplySource?.kind === 'converter-backup' &&
            circuit.supplySource.converterId === directConverterNode.domainId
          )
        })
        const backupLaneBusSideEnd = directBackupProtectionNode
          ? applyNodeWireInset(
              {
                x: directBackupProtectionNode.bounds.x,
                y: directBackupProtectionNode.bounds.y,
              },
              { x: backupBusX, y: converterY },
              directBackupProtectionNode
            )
          : converterBackupInset
        const backupSectionEnd = directBackupProtectionNode?.domainId
          ? `protection:${directBackupProtectionNode.domainId}`
          : `converter:${directConverterNode.domainId}`
        const backupSectionKey = supplySectionKey(
          'direct-backup',
          `backup-bus:${backupBusRun.busSectionId}`,
          backupSectionEnd
        )
        const backupBusSideConnection = directBackupProtectionNode ? undefined : backupConnection
        pushDirectAcWire(
          { x: backupBusX, y: mainBusY },
          { x: backupBusX, y: converterY },
          backupBusSideConnection,
          {
            role: 'downstream',
            busSectionId: backupBusRun.busSectionId,
            busFeedKind: 'backup',
            sectionKey: backupSectionKey,
          }
        )
        pushDirectAcWire(
          { x: backupBusX, y: converterY },
          backupLaneBusSideEnd,
          backupBusSideConnection,
          {
            role: 'downstream',
            sectionKey: backupSectionKey,
          }
        )
        const gridWaypointIndex = horizontalWaypoints.reduce(
          (closestIndex, waypoint, index) =>
            Math.abs(waypoint.point.x - gridBusX) <
            Math.abs(horizontalWaypoints[closestIndex]!.point.x - gridBusX)
              ? index
              : closestIndex,
          0
        )
        const gridAdjacentSegmentIndex = Math.min(gridWaypointIndex, horizontalWaypoints.length - 2)
        pushDirectAcWire({ x: gridBusX, y: mainBusY }, { x: gridBusX, y: supplyY }, undefined, {
          busSectionId: gridBusRun.busSectionId,
          busFeedKind: 'grid',
          sectionKey: directGridSectionKey(gridAdjacentSegmentIndex),
        })
      }
      if (converterGridInputConnected) {
        const converterBottom = applyNodeWireInset(
          { x: converterX, y: converterY },
          { x: converterX, y: supplyY },
          directConverterNode
        )
        const inputLegWaypoints = [
          { point: converterBottom, node: undefined as LayoutNode | undefined },
          ...converterGridInputLegNodes.map((node) => ({
            point: { x: node.bounds.x, y: node.bounds.y },
            node,
          })),
          { point: { x: converterX, y: supplyY }, node: undefined as LayoutNode | undefined },
        ]
        const inputLegNodeIds = [
          directConverterNode.domainId,
          ...converterGridInputLegNodes.map((node) => node.domainId),
          utilityAssemblyNodeId,
        ].filter((id): id is string => !!id)
        for (let index = 0; index < inputLegWaypoints.length - 1; index++) {
          const from = inputLegWaypoints[index]!
          const to = inputLegWaypoints[index + 1]!
          pushDirectAcWire(
            from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point,
            to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point,
            findAssemblyConnection(
              inputLegNodeIds[index],
              inputLegNodeIds[index + 1],
              'inverter-grid-ac'
            ) ?? findAssemblyPortConnection(directConverterNode.domainId, 'grid')
          )
        }
      }

      pushConverterDcWires(directConverterNode)
      if (vertical) applySupplyLabelVisibility(vertical, mergeCrossingWithBusDrop)
    } else if (supplyTrunkDeviceNodes.length > 0) {
      const supplyY = supplyNode.bounds.y
      const firstSupplyTrunkNode = supplyTrunkDeviceNodes[0]
      if (!firstSupplyTrunkNode) return segments
      const bendX = firstSupplyTrunkNode.bounds.x - LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
      const lastSupplyTrunkNode = supplyTrunkDeviceNodes[supplyTrunkDeviceNodes.length - 1]
      if (!lastSupplyTrunkNode) return segments
      const supplyInset = applyNodeWireInset(
        { x: supplyNode.bounds.x, y: supplyY },
        { x: lastSupplyTrunkNode.bounds.x, y: supplyY },
        supplyNode
      )

      const devicePositions = supplyTrunkDeviceNodes.map((node) => ({
        x: node.bounds.x,
        feedScope: installation
          ? resolveSupplyFeedScopeForDeviceId(installation, panels, panel, node.domainId ?? '')
          : ('shared' as const),
      }))
      const separatorX = computeSupplySeparatorX(devicePositions, supplyInset.x, bendX)
      const mergeCrossingWithBusDrop = installation
        ? shouldMergeSupplyCrossingWithBusDrop(bendX, separatorX, devicePositions)
        : false
      const busEndpointId = `panel-bus:${panel.id}`
      const firstSupplyEndpointId = firstSupplyTrunkNode.domainId
        ? `device:${firstSupplyTrunkNode.domainId}`
        : `utility:${panel.id}`
      const busSideSectionKey = supplySectionKey('serial', busEndpointId, firstSupplyEndpointId)

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
        applySupplyPhaseState(vertical, 'downstream')
      }
      applySupplySection(vertical, busSideSectionKey)
      segments.push(vertical)

      const waypoints: { x: number; deviceId?: string }[] = [{ x: bendX }]
      for (const td of supplyTrunkDeviceNodes) {
        waypoints.push({ x: td.bounds.x, deviceId: td.domainId })
      }
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
        const adjustedStart = fromDevice ? applyNodeWireInset(startPt, endPt, fromDevice) : startPt
        const adjustedEnd = toDevice ? applyNodeWireInset(endPt, startPt, toDevice) : endPt
        const fromSectionEndpoint = from.deviceId ? `device:${from.deviceId}` : busEndpointId
        const toSectionEndpoint = to.deviceId ? `device:${to.deviceId}` : `utility:${panel.id}`
        pushSupplyHorizontal(
          bendX,
          adjustedStart,
          adjustedEnd,
          separatorX,
          waypointScopes[i],
          waypointScopes[i + 1],
          mergeCrossingWithBusDrop,
          undefined,
          supplySectionKey('serial', fromSectionEndpoint, toSectionEndpoint)
        )
      }
      applySupplyLabelVisibility(vertical, mergeCrossingWithBusDrop)
    } else {
      const supplyY = supplyNode.bounds.y
      const isTextOnlyContinuation =
        supplyNode.visual?.type === 'symbol' && supplyNode.visual.opacity === 0
      const bendX = isTextOnlyContinuation
        ? resolvedSupplyBendX
        : supplyNode.bounds.x - LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
      const supplyInset = !isTextOnlyContinuation
        ? applyNodeWireInset(
            { x: supplyNode.bounds.x, y: supplyY },
            { x: bendX, y: supplyY },
            supplyNode
          )
        : undefined
      const separatorX = computeSupplySeparatorX([], supplyInset?.x ?? bendX, bendX)
      const mergeCrossingWithBusDrop = installation
        ? shouldMergeSupplyCrossingWithBusDrop(bendX, separatorX, [])
        : false

      const suppressDetachedSplitContinuation =
        isTextOnlyContinuation && hasExplicitPanelBusSections(panel) && !isSupplyDiagram
      if (!suppressDetachedSplitContinuation) {
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
          applySupplyPhaseState(vertical, 'downstream')
        }
        segments.push(vertical)

        if (!isTextOnlyContinuation) {
          pushSupplyHorizontal(
            bendX,
            { x: bendX, y: supplyY },
            { x: supplyInset!.x, y: supplyY },
            separatorX,
            'bend',
            'supply',
            mergeCrossingWithBusDrop,
            currentPanelHandoffConnection
          )
        }
        applySupplyLabelVisibility(vertical, mergeCrossingWithBusDrop)
      }
    }
  }

  // 4. Process main bus children (RCDs, MCBs)
  for (const child of mainBusNode.children) {
    if (child.type === 'rcd') {
      const rcdSegments = deriveRcdWires(
        child,
        panel,
        mainBusY,
        installation?.nominalVoltage.system
      )
      segments.push(...rcdSegments)
    } else if (child.type === 'mcb') {
      const circuit = child.circuitIdForWires
        ? findCircuitByIdInPanel(panel, child.circuitIdForWires)
        : null
      const converterSource =
        circuit?.supplySource?.kind === 'converter-backup' &&
        directConverterNodeForBackup?.domainId === circuit.supplySource.converterId
          ? {
              node: directConverterNodeForBackup,
              assemblyId: supplyAssembly?.id,
              connection: findAssemblyConnection(
                directConverterNodeForBackup.domainId,
                `converter-backup-protection-${(child.domainRef as ProtectionDevice | undefined)?.id}`,
                'inverter-backup-ac'
              ),
            }
          : undefined
      const mcbSegments = deriveMcbWires(child, panel, mainBusY, null, converterSource)
      segments.push(...mcbSegments)
    }
  }

  // Final pass: enforce per-section overrides on all vertical circuit segments.
  for (const segment of segments) {
    if (segment.type !== 'vertical' || !segment.circuitId) continue
    const circuit =
      findCircuitByIdInPanel(panel, segment.circuitId) ??
      panels
        .map((candidatePanel) => findCircuitByIdInPanel(candidatePanel, segment.circuitId))
        .find((candidate): candidate is Circuit => candidate !== null)
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
      sectionRef
    )
    segment.showFireClassLabel = wireProps.showFireClassLabel
    segment.wireLengthM = wireProps.wireLengthM
    segment.showWireLengthLabel = wireProps.showWireLengthLabel
  }

  // Carry the effective phase assignment and label visibility onto every derived
  // segment. Explicit child assignments win; otherwise a concrete lock from a
  // parent circuit feeds the complete nested/secondary-panel chain.
  for (const segment of segments) {
    if (!segment.circuitId) continue
    const circuit =
      findCircuitByIdInPanel(panel, segment.circuitId) ??
      panels
        .map((candidatePanel) => findCircuitByIdInPanel(candidatePanel, segment.circuitId))
        .find((candidate): candidate is Circuit => candidate !== null)
    if (!circuit) continue
    const sectionRef = getSectionRefFromWireSegment(segment)
    const wireProps = getCircuitWirePropertiesForDomain(
      circuit,
      segment.domain ?? DEFAULT_ELECTRICAL_DOMAIN,
      sectionRef
    )
    const inheritedPhaseState = getInheritedCircuitPhaseState(
      circuit,
      panels,
      installation?.nominalVoltage.system,
      installation
    )
    const effectivePhaseState = getEffectiveCircuitPhaseState(
      circuit,
      panels,
      installation?.nominalVoltage.system,
      installation
    )
    const outputPhaseState = getDomoticaOutputPhaseState(circuit, segment)
    const crossesProtectionBoundary =
      segment.fromElementType === 'protection' || segment.toElementType === 'protection'
    segment.phaseAssignment =
      inheritedPhaseState.assignment ??
      outputPhaseState?.phaseAssignment ??
      (crossesProtectionBoundary
        ? effectivePhaseState.assignment
        : (wireProps.phaseAssignment ?? effectivePhaseState.assignment))
    segment.showPhaseLabel = outputPhaseState?.showPhaseLabel ?? circuit.showPhaseLabel
  }

  // A panel-distribution endpoint is an electrical boundary, so a narrowed
  // phase set must be visible on the feeder that reaches it. Keep this
  // independent from the user's ordinary phase-label preference: on a
  // three-phase installation the annotation is required to make the supplied
  // phases of the downstream panel unambiguous.
  const downstreamPanelFeeders = panel.protections.flatMap((protection) =>
    protection.subPanelId
      ? (protection.circuits ?? []).map((circuit) => ({
          circuitId: circuit.id,
          protectionId: protection.id,
          endpointIds: new Set(
            circuit.endpoints
              .filter((endpoint) => endpoint.symbol === 'panel_distribution')
              .map((endpoint) => endpoint.id)
          ),
        }))
      : []
  )
  for (const feeder of downstreamPanelFeeders) {
    const candidates = segments.filter(
      (segment) =>
        segment.panelId === panel.id &&
        segment.circuitId === feeder.circuitId &&
        segment.toElementType !== 'protection'
    )
    const feederSegment =
      candidates.find(
        (segment) =>
          segment.toElementType === 'endpoint' &&
          !!segment.toElementId &&
          feeder.endpointIds.has(segment.toElementId)
      ) ??
      candidates.find(
        (segment) =>
          segment.toElementType === 'endpoint' ||
          (segment.fromElementType === 'protection' &&
            segment.fromElementId === feeder.protectionId)
      )
    if (feederSegment) {
      feederSegment.forcePhaseLabel = isPhaseAssignmentLabelVisible(
        feederSegment.phaseAssignment,
        installation?.nominalVoltage.system
      )
    }
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
    const incomingBusStub = segments
      .filter(
        (segment) =>
          segment.type === 'vertical' &&
          segment.panelId === panel.id &&
          segment.circuitId === parentFeedCircuitId &&
          segment.isSubPanelSupply === true
      )
      .sort(
        (left, right) =>
          Math.min(Math.abs(left.startPoint.y - mainBusY), Math.abs(left.endPoint.y - mainBusY)) -
          Math.min(Math.abs(right.startPoint.y - mainBusY), Math.abs(right.endPoint.y - mainBusY))
      )[0]
    if (incomingBusStub) {
      incomingBusStub.forcePhaseLabel = isPhaseAssignmentLabelVisible(
        incomingBusStub.phaseAssignment,
        installation?.nominalVoltage.system
      )
    }
  }

  if (supplyNode && renderedSupplyDeviceNodes.length > 0) {
    const horizontalDeviceLanes: Array<{
      y: number
      devices: Array<{ x: number; enclosure: string }>
    }> = []
    for (const node of renderedSupplyDeviceNodes) {
      const device = node.domainRef as TrunkDevice | undefined
      const enclosure = device ? getDeviceEnclosureKey(device) : undefined
      if (!enclosure) continue
      let lane = horizontalDeviceLanes.find(
        (candidate) => Math.abs(candidate.y - node.bounds.y) < 1
      )
      if (!lane) {
        lane = { y: node.bounds.y, devices: [] }
        horizontalDeviceLanes.push(lane)
      }
      lane.devices.push({ x: node.bounds.x, enclosure })
    }
    for (const lane of horizontalDeviceLanes) {
      lane.devices.sort((left, right) => left.x - right.x)
      for (let index = 0; index < lane.devices.length - 1; index++) {
        const left = lane.devices[index]!
        const right = lane.devices[index + 1]!
        if (left.enclosure === right.enclosure) continue
        const candidates = segments.filter((segment) => {
          if (!segment.isSupplyTrunk || segment.type !== 'branch') return false
          if (
            Math.abs(segment.startPoint.y - lane.y) >= 1 ||
            Math.abs(segment.endPoint.y - lane.y) >= 1
          ) {
            return false
          }
          const centerX = (segment.startPoint.x + segment.endPoint.x) / 2
          return centerX > left.x && centerX < right.x
        })
        const markerSegment = candidates.reduce<WireSegment | undefined>((best, candidate) => {
          if (!best) return candidate
          const candidateCenter = (candidate.startPoint.x + candidate.endPoint.x) / 2
          const bestCenter = (best.startPoint.x + best.endPoint.x) / 2
          return candidateCenter > bestCenter ? candidate : best
        }, undefined)
        if (markerSegment) {
          markerSegment.supplyEnclosureBoundary = true
          const midpointX = (left.x + right.x) / 2
          markerSegment.supplySeparatorX = Math.max(
            midpointX,
            right.x - LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
          )
          explicitlyMarkedBoundaryKeys.add(getBoundaryKey(left.enclosure, right.enclosure))
          if (markerSegment.supplyConnectionId) {
            explicitlyMarkedConnectionIds.add(markerSegment.supplyConnectionId)
          }
        }
      }
    }
  }
  markAssemblyEnclosureBoundaries()
  propagateSupplySectionsAcrossSimpleJoints()
  if (installation) {
    // The shared utility run is physically upstream of the assembly graph. Its serial
    // protections therefore need a geometry-ordered phase pass of their own. Derive a
    // device's center from the wire gaps on both sides so this also covers shared-feed
    // devices that are not represented as ordinary panel layout children.
    const allSupplyDevices = new Map(
      [
        ...(installation.mainSupply.supplyTrunkDevices ?? []),
        ...(feedTopology?.sharedFeed.trunkDevices ?? []),
        ...(rootFeed?.trunkDevices ?? []),
      ].map((device) => [device.id, device])
    )
    const serialProtectionPositions = Array.from(allSupplyDevices.values())
      .filter(
        (device) =>
          device.type === 'protection' &&
          (device.supplyPath == null || device.supplyPath === 'serial')
      )
      .map((device) => {
        const adjacentXs = segments
          .filter(
            (segment) =>
              segment.domain !== 'DC' && segment.supplySectionKey?.includes(`device:${device.id}`)
          )
          .flatMap((segment) => [segment.startPoint.x, segment.endPoint.x])
          .sort((left, right) => left - right)
        if (adjacentXs.length === 0) return undefined
        const middle = adjacentXs.length / 2
        const x =
          adjacentXs.length % 2 === 0
            ? (adjacentXs[middle - 1]! + adjacentXs[middle]!) / 2
            : adjacentXs[Math.floor(middle)]!
        return { device, x }
      })
      .filter((candidate): candidate is { device: TrunkDevice; x: number } => !!candidate)
      .sort((left, right) => right.x - left.x)
    for (const segment of segments) {
      if (segment.supplyConnectionId) continue
      if (
        !segment.supplySectionKey?.includes(':changeover-shared-grid:') &&
        !segment.supplySectionKey?.includes(':direct-grid:')
      ) {
        continue
      }
      const sampleX = (segment.startPoint.x + segment.endPoint.x) / 2
      segment.phaseAssignment = serialProtectionPositions
        .filter((candidate) => candidate.x > sampleX)
        .reduce(
          (assignment, candidate) =>
            getDownstreamProtectionPhaseAssignment(
              candidate.device,
              installation.nominalVoltage.system,
              assignment
            ),
          getFullInstallationPhaseAssignment(installation.nominalVoltage.system)
        )
    }

    const phaseSignature = (assignment: CircuitPhaseAssignment | undefined) =>
      assignment?.phases.filter((phase) => phase !== 'PE').join('|') ?? ''
    const connectionSignature = (connection: SupplyConnection | undefined) =>
      connection?.conductors
        .filter(
          (phase): phase is 'L1' | 'L2' | 'L3' | 'N' =>
            phase === 'L1' || phase === 'L2' || phase === 'L3' || phase === 'N'
        )
        .join('|') ?? ''
    const distanceToPoint = (segment: WireSegment, point: { x: number; y: number }) =>
      Math.min(
        Math.hypot(segment.startPoint.x - point.x, segment.startPoint.y - point.y),
        Math.hypot(segment.endPoint.x - point.x, segment.endPoint.y - point.y)
      )
    const markPhaseTransition = (
      candidates: WireSegment[],
      devicePoint: { x: number; y: number }
    ) => {
      const labelSegment = candidates
        .filter((segment) => !!phaseSignature(segment.phaseAssignment))
        .sort(
          (left, right) => distanceToPoint(left, devicePoint) - distanceToPoint(right, devicePoint)
        )[0]
      if (!labelSegment) return
      const startDistance = Math.hypot(
        labelSegment.startPoint.x - devicePoint.x,
        labelSegment.startPoint.y - devicePoint.y
      )
      const endDistance = Math.hypot(
        labelSegment.endPoint.x - devicePoint.x,
        labelSegment.endPoint.y - devicePoint.y
      )
      const near = startDistance <= endDistance ? labelSegment.startPoint : labelSegment.endPoint
      const far = startDistance <= endDistance ? labelSegment.endPoint : labelSegment.startPoint
      const horizontal = Math.abs(far.y - near.y) < 0.01
      labelSegment.forcePhaseLabel = true
      // Keep the mandatory transition label beside the device, never in the middle of
      // the run where cable and routing properties are drawn.
      labelSegment.phaseLabelAnchor = horizontal
        ? {
            x: far.x < near.x ? near.x - 53 : near.x + 5,
            y: near.y - 20,
          }
        : {
            x: near.x - 53,
            y: far.y < near.y ? near.y - 12 : near.y + 4,
          }
    }

    // Shared/root serial protections are not always graph nodes. Mark only the first
    // section after the device when that device itself changes the available phases.
    let serialInputAssignment = getFullInstallationPhaseAssignment(
      installation.nominalVoltage.system
    )
    for (const candidate of serialProtectionPositions) {
      const serialOutputAssignment = getDownstreamProtectionPhaseAssignment(
        candidate.device,
        installation.nominalVoltage.system,
        serialInputAssignment
      )
      if (phaseSignature(serialOutputAssignment) !== phaseSignature(serialInputAssignment)) {
        const node = renderedSupplyDeviceNodes.find(
          (layoutNode) => layoutNode.domainId === candidate.device.id
        )
        const downstreamSegments = segments.filter(
          (segment) =>
            segment.supplySectionKey?.includes(`device:${candidate.device.id}`) === true &&
            segment.domain !== 'DC' &&
            phaseSignature(segment.phaseAssignment) === phaseSignature(serialOutputAssignment) &&
            (segment.startPoint.x + segment.endPoint.x) / 2 < candidate.x
        )
        markPhaseTransition(downstreamSegments, {
          x: node?.bounds.x ?? candidate.x,
          y: node?.bounds.y ?? downstreamSegments[0]?.startPoint.y ?? mainBusY,
        })
      }
      serialInputAssignment = serialOutputAssignment
    }

    // Graph-backed protections and inverters have explicit input/output connections.
    // A phase annotation belongs to the outgoing physical section only when the node
    // changes the phase set (narrowing or widening).
    if (supplyAssembly) {
      // Multiplied inverter units are rendered as one collapsed physical device. Use
      // the same unioned connection that renders that device when deciding whether a
      // phase transition exists; comparing one internal unit at a time creates false
      // full-phase labels on otherwise unchanged three-phase runs.
      const connectionAtPort = (nodeId: string, portId: string) =>
        findAssemblyPortConnection(nodeId, portId)
      const markConnectionTransition = (connection: SupplyConnection, nodeId: string) => {
        const node = renderedSupplyDeviceNodes.find((candidate) => candidate.domainId === nodeId)
        const candidates = segments.filter(
          (segment) => segment.supplyConnectionId === connection.id
        )
        markPhaseTransition(candidates, {
          x: node?.bounds.x ?? candidates[0]?.startPoint.x ?? 0,
          y: node?.bounds.y ?? candidates[0]?.startPoint.y ?? 0,
        })
      }
      for (const node of supplyAssembly.nodes) {
        if (node.kind === 'protection') {
          const input = connectionAtPort(node.id, 'source')
          const output = connectionAtPort(node.id, 'load')
          if (input && output && connectionSignature(input) !== connectionSignature(output)) {
            markConnectionTransition(output, node.deviceId ?? node.id)
          }
          continue
        }
        if (node.kind !== 'inverter-unit') continue
        const gridPort = node.ports.find((port) => port.role === 'inverter-grid-ac')
        const backupPort = node.ports.find((port) => port.role === 'inverter-backup-ac')
        const input = gridPort ? connectionAtPort(node.id, gridPort.id) : undefined
        const output = backupPort ? connectionAtPort(node.id, backupPort.id) : undefined
        if (input && output && connectionSignature(input) !== connectionSignature(output)) {
          markConnectionTransition(output, node.deviceId ?? node.id)
        }
      }
    }

    // Do not force labels merely because a downstream section remains limited. The
    // actual transition above is mandatory; subsequent wires retain the electrical
    // phase assignment without repeatedly annotating it. Explicit bus, panel-handoff,
    // and differing changeover-input labels are assigned at their own boundaries.
  }
  const primaryBusSectionId = getPrimaryPanelBusSectionId(panel)
  for (const segment of segments) {
    if (
      !segment.busSectionId &&
      segment.supplyWireRole === 'downstream' &&
      segment.supplyFeedScope === 'root'
    ) {
      segment.busSectionId = primaryBusSectionId
    }
    if (!supplyAssembly || !segment.supplyConnectionId) continue
    const connection = supplyAssembly.connections.find(
      (candidate) => candidate.id === segment.supplyConnectionId
    )
    const handoff = supplyAssembly.loadHandoffs.find((candidate) =>
      connection?.endpoints.some(({ nodeId }) => nodeId === candidate.handoffNodeId)
    )
    if (handoff?.target.kind === 'panel-bus-input' && handoff.target.panelId === panel.id) {
      segment.busSectionId = handoff.target.busSectionId
    }
  }
  return segments
}

/**
 * Derive wires for an RCD node
 */
function deriveRcdWires(
  rcdNode: LayoutNode,
  panel: Panel,
  mainBusY: number,
  phaseSystem?: Installation['nominalVoltage']['system']
): WireSegment[] {
  const segments: WireSegment[] = []
  const rcdY = rcdNode.bounds.y
  // bounds.x IS the center of the RCD symbol (from bottomUpLayout position.x)
  const rcdX = rcdNode.bounds.x

  const protection = rcdNode.domainRef as ProtectionDevice | undefined
  const phaseAssignment = protection
    ? getMainBusProtectionPhaseAssignment(panel, protection, phaseSystem)
    : undefined
  const cable = ensurePanelBusCableMinimum(protection?.circuits?.[0]?.cable)

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
    phaseAssignment,
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
      phaseAssignment,
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
        phaseAssignment,
        fromElementType: 'rcd',
        fromElementId: protection?.id,
        ...(secondaryBusReferenceLabel
          ? { secondaryBusReferenceExportLabel: secondaryBusReferenceLabel }
          : {}),
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
  parentSecondaryBus: LayoutNode | null,
  converterSource?: {
    node: LayoutNode
    assemblyId?: string
    connection?: SupplyConnection
  }
): WireSegment[] {
  const segments: WireSegment[] = []
  const protection = mcbNode.domainRef as ProtectionDevice | undefined
  const circuit =
    mcbNode.circuitIdForWires != null
      ? findCircuitByIdInPanel(panel, mcbNode.circuitIdForWires)
      : findCircuitForProtection(panel, protection?.id)

  if (!circuit) return segments
  const isHorizontalConverterBackup = circuit.supplySource?.kind === 'converter-backup'

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
  const panelBusCable = ensurePanelBusCableMinimum(cable)

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
    const sourcePoint = converterSource
      ? applyNodeWireInset(
          { x: converterSource.node.bounds.x, y: converterSource.node.bounds.y },
          connEnd,
          converterSource.node
        )
      : connStart
    const targetPoint = converterSource
      ? applyNodeWireInset(connEnd, sourcePoint, mcbNode)
      : applyNodeWireInset(connEnd, connStart, mcbNode)
    const sourceSegment: WireSegment = {
      id: generateId(),
      type: converterSource ? 'branch' : 'vertical',
      startPoint: sourcePoint,
      endPoint: targetPoint,
      cable: converterSource ? cable : panelBusCable,
      panelId: panel.id,
      domain: DEFAULT_ELECTRICAL_DOMAIN,
      fromElementType: converterSource ? undefined : connectFromType,
      fromElementId: converterSource?.node.domainId,
      toElementType: 'protection',
      toElementId: protection?.id,
      circuitId: circuit.id,
      inTube: defaultWireProps.inTube,
      wireRoute: defaultWireProps.wireRoute,
      inWall: defaultWireProps.inWall,
      hideWireLabel: defaultWireProps.hideWireLabel,
      ...(panelOnlyFeederStub ? { showWireLabelOnBusStub: true } : {}),
    }
    if (converterSource?.assemblyId && converterSource.connection) {
      sourceSegment.supplyAssemblyId = converterSource.assemblyId
      sourceSegment.supplyConnectionId = converterSource.connection.id
      const properties = converterSource.connection.wireProperties
      if (properties) {
        sourceSegment.cable = properties.cable
        sourceSegment.wireRoute = properties.wireRoute
        sourceSegment.inTube = properties.inTube
        sourceSegment.inWall = properties.inWall
        sourceSegment.hideWireLabel = properties.hideWireLabel
        sourceSegment.showFireClassLabel = properties.showFireClassLabel
        sourceSegment.wireLengthM = properties.wireLengthM
        sourceSegment.showWireLengthLabel = properties.showWireLengthLabel
      }
    }
    segments.push(sourceSegment)
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
        topmostEndpoint
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

        const adjustedStart = fromNode ? applyNodeWireInset(startPt, endPt, fromNode) : startPt
        const adjustedEnd = toNode ? applyNodeWireInset(endPt, startPt, toNode) : endPt

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
    } else if (branchNodes.length > 0 && !isHorizontalConverterBackup) {
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

      if (isHorizontalConverterBackup) {
        const mcbToEndpointStart = { x: mcbX, y: mcbY }
        const mcbToEndpointEnd = { x: topmostEndpoint.bounds.x, y: mcbY }
        const directEndpointWireProps = getCircuitWirePropertiesForDomain(
          circuit,
          DEFAULT_ELECTRICAL_DOMAIN,
          directEndpointSectionRef
        )
        segments.push({
          id: generateId(),
          type: 'branch',
          startPoint: applyNodeWireInset(mcbToEndpointStart, mcbToEndpointEnd, mcbNode),
          endPoint: applyNodeWireInset(mcbToEndpointEnd, mcbToEndpointStart, topmostEndpoint),
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
      } else if (mergePanelOnlyFeederBusToEndpoint) {
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
        cable: panelBusCable,
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
          cable: panelBusCable,
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
      const panelWireProps = getCircuitWirePropertiesForDomain(circuit, DEFAULT_ELECTRICAL_DOMAIN, {
        fromElementType: 'secondaryBus',
        toElementType: 'endpoint',
        toElementId: panelEndpoint.domainId,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
      })
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

  // Follow the visual flow away from the protection. Ordinary circuits run right;
  // standalone converter-backup circuits are mirrored and run left.
  const isHorizontalConverterBackup = circuit.supplySource?.kind === 'converter-backup'
  const endpointNodes = branchNode.children
    .filter((c) => c.type === 'endpoint')
    .sort((a, b) =>
      isHorizontalConverterBackup ? b.bounds.x - a.bounds.x : a.bounds.x - b.bounds.x
    )

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
            (childProps?.outputGroup === group || childProps?.outputGroup === 'control') &&
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
        endPoint: firstNode ? applyNodeWireInset(firstEnd, start, firstNode) : firstEnd,
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
  if (
    (isHorizontalConverterBackup && trunkX > firstEndpointX) ||
    (!isHorizontalConverterBackup && trunkX < firstEndpointX)
  ) {
    // For the last (top-most) branch, nudge the horizontal start a tiny
    // bit to the left so the corner visually overlaps the vertical trunk.
    const trunkStartX = isLastBranchOnCircuit
      ? trunkX + ((isHorizontalConverterBackup ? 1 : -1) * LAYOUT_CONSTANTS.BRANCH_LINE_WIDTH) / 2
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
