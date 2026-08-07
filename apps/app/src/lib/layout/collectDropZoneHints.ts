/**
 * Collect visual drop-zone hint positions for the active library symbol.
 * Uses layout-tree hit zones filtered by per-symbol validTargets from dropBehaviors.
 */

import { dropBehaviors } from '@/handlers/eendraad/dropBehaviors'
import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import { getCircuitBranches } from '@/lib/layout/endpointChains'
import { getEndpointTypeFromSymbol } from '@/utils'
import type { SymbolMetadata } from '@/lib/symbols'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { getHitZoneBounds } from '@/lib/layout/findDropTarget'
import type { LayoutNode, LayoutTree } from '@/lib/layout/layoutTree'
import type { Circuit, Endpoint, Panel, ProtectionDevice } from '@/types/schema'
import type { Point } from '@/types/ui'
import {
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

export interface DropZoneHintMatch {
  panelId?: string
  supplyFeedScope?: 'shared' | 'root'
  supplyDeviceInsertIndex?: number
  circuitId?: string
  /** Vertical trunk insertion slot (aligns with DropTarget.circuitTrunkSegmentIndex). */
  circuitTrunkSegmentIndex?: number
}

export interface DropZoneHint {
  nodeId: string
  x: number
  y: number
  targetType: NonNullable<DropTarget['type']>
  match?: DropZoneHintMatch
}

interface HintWalkContext {
  panelId: string
  circuitId?: string
  panelIsMain?: boolean
}

const PROTECTION_DRAG_SYMBOL_IDS = new Set<string>(PROTECTION_SYMBOL_IDS)

const TRUNK_ONLY_ON_CIRCUIT_SYMBOLS = new Set([
  'energy_meter',
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
])

const TRUNK_CAPABLE_ENDPOINT_SYMBOLS = new Set(['junction_box', 'junction_panel'])

function isProtectionDragSymbol(symbol: SymbolMetadata): boolean {
  return PROTECTION_DRAG_SYMBOL_IDS.has(symbol.id)
}

function isEndpointDragSymbol(symbol: SymbolMetadata): boolean {
  return !!getEndpointTypeFromSymbol(symbol)
}

function findCircuitInProject(
  project: ProjectWithOptionalV2Electrical,
  circuitId: string
): Circuit | undefined {
  const stack: Panel[] = [...getElectricalPanelsFromProject(project)]
  while (stack.length) {
    const panel = stack.pop()!
    const direct = panel.circuits?.find((c) => c.id === circuitId)
    if (direct) return direct
    for (const protection of panel.protections ?? []) {
      const underProtection = protection.circuits?.find((c) => c.id === circuitId)
      if (underProtection) return underProtection
    }
    if (panel.subPanels?.length) {
      stack.push(...panel.subPanels)
    }
  }
  return undefined
}

function circuitFeedsSubPanel(
  project: ProjectWithOptionalV2Electrical,
  circuitId: string
): boolean {
  const stack: Panel[] = [...getElectricalPanelsFromProject(project)]
  while (stack.length) {
    const panel = stack.pop()!
    for (const protection of panel.protections ?? []) {
      if (protection.subPanelId && protection.circuits?.some((c) => c.id === circuitId)) {
        return true
      }
    }
    if (panel.subPanels?.length) {
      stack.push(...panel.subPanels)
    }
  }
  return false
}

function hintCenter(node: LayoutNode): { x: number; y: number } {
  const bounds = getHitZoneBounds(node, 'core')
  return {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
  }
}

function parseCircuitTrunkSegmentId(
  nodeId: string
): { circuitId: string; segmentIndex: number } | null {
  const match = nodeId.match(/^circuit-trunk-(.+)-segment-(\d+)$/)
  if (!match) return null
  return {
    circuitId: match[1]!,
    segmentIndex: Number.parseInt(match[2]!, 10),
  }
}

/** Highest segment index + 1 per circuit (from layout-tree trunk wire nodes). */
function buildTrunkSegmentCountByCircuit(layoutTree: LayoutTree): Map<string, number> {
  const counts = new Map<string, number>()
  const visit = (node: LayoutNode) => {
    const parsed = node.id ? parseCircuitTrunkSegmentId(node.id) : null
    if (parsed) {
      counts.set(
        parsed.circuitId,
        Math.max(counts.get(parsed.circuitId) ?? 0, parsed.segmentIndex + 1)
      )
    }
    for (const child of node.children) {
      visit(child)
    }
  }
  for (const panel of layoutTree.panels) {
    visit(panel)
  }
  return counts
}

function isLastCircuitTrunkSegment(
  nodeId: string,
  trunkSegmentCounts: Map<string, number>
): boolean {
  const parsed = parseCircuitTrunkSegmentId(nodeId)
  if (!parsed) return false
  const count = trunkSegmentCounts.get(parsed.circuitId) ?? 0
  return count > 0 && parsed.segmentIndex === count - 1
}

function circuitHasTrunkBranchContent(circuit: Circuit | undefined): boolean {
  if (!circuit) return false
  return getCircuitBranches(circuit).some((branch) => branch.length > 0)
}

/**
 * Legal trunk insertion indices for energy conversion / meters.
 * Matches drop reordering: one slot per trunk device gap, plus an extra top slot when
 * branches already occupy the trunk so the open wire above them is still droppable.
 */
function trunkInsertionSlotCount(circuit: Circuit | undefined): number {
  const deviceCount = circuit?.trunkDevices?.length ?? 0
  const extraTopSlot = circuitHasTrunkBranchContent(circuit) ? 1 : 0
  return deviceCount + 1 + extraTopSlot
}

type LastTrunkSegmentInfo = {
  nodeId: string
  bounds: LayoutNode['bounds']
  segmentIndex: number
}

function collectLastTrunkSegmentByCircuit(
  layoutTree: LayoutTree
): Map<string, LastTrunkSegmentInfo> {
  const map = new Map<string, LastTrunkSegmentInfo>()
  const visit = (node: LayoutNode) => {
    const parsed = node.id ? parseCircuitTrunkSegmentId(node.id) : null
    if (parsed && node.type === 'wire' && node.hitZone?.type === 'circuit') {
      const existing = map.get(parsed.circuitId)
      if (!existing || parsed.segmentIndex > existing.segmentIndex) {
        map.set(parsed.circuitId, {
          nodeId: node.id,
          bounds: node.bounds,
          segmentIndex: parsed.segmentIndex,
        })
      }
    }
    for (const child of node.children) visit(child)
  }
  for (const panel of layoutTree.panels) visit(panel)
  return map
}

function appendTrunkTopSlotHints(
  symbol: SymbolMetadata,
  project: ProjectWithOptionalV2Electrical,
  layoutTree: LayoutTree,
  trunkSegmentCounts: Map<string, number>,
  hints: HintWithSpan[]
): void {
  if (
    !TRUNK_ONLY_ON_CIRCUIT_SYMBOLS.has(symbol.id) &&
    !TRUNK_CAPABLE_ENDPOINT_SYMBOLS.has(symbol.id)
  )
    return

  const lastSegmentByCircuit = collectLastTrunkSegmentByCircuit(layoutTree)
  const existingSlots = new Set<string>()
  for (const hint of hints) {
    const circuitId = hint.match?.circuitId
    const seg = hint.match?.circuitTrunkSegmentIndex
    if (circuitId != null && typeof seg === 'number') {
      existingSlots.add(`${circuitId}|${seg}`)
    }
  }

  for (const [circuitId, segmentCount] of trunkSegmentCounts) {
    if (segmentCount <= 0) continue
    const circuit = findCircuitInProject(project, circuitId)
    if (circuitFeedsSubPanel(project, circuitId)) continue

    const slotCount = trunkInsertionSlotCount(circuit)
    const last = lastSegmentByCircuit.get(circuitId)
    if (!last) continue

    for (let slot = segmentCount; slot < slotCount; slot++) {
      const key = `${circuitId}|${slot}`
      if (existingSlots.has(key)) continue

      const bounds = last.bounds
      hints.push({
        nodeId: `circuit-trunk-${circuitId}-slot-${slot}`,
        x: bounds.x + bounds.width / 2,
        y: bounds.y + 8,
        targetType: 'circuit',
        match: {
          circuitId,
          circuitTrunkSegmentIndex: slot,
        },
        span: Math.max(bounds.width, bounds.height),
      })
      existingSlots.add(key)
    }
  }
}

function hintAnchor(node: LayoutNode): { x: number; y: number } {
  const bounds = getHitZoneBounds(node, 'core')
  if (node.id?.startsWith('circuit-nest-') || node.id?.startsWith('circuit-trunk-')) {
    return {
      x: (bounds.left + bounds.right) / 2,
      y: bounds.top + 8,
    }
  }
  if (node.type === 'branch') {
    return {
      x: bounds.left + 14,
      y: (bounds.top + bounds.bottom) / 2,
    }
  }
  return hintCenter(node)
}

function hintSpan(node: LayoutNode): number {
  const bounds = getHitZoneBounds(node, 'core')
  return Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top)
}

function hasChildMatching(node: LayoutNode, predicate: (child: LayoutNode) => boolean): boolean {
  return node.children.some(predicate)
}

function shouldSkipContainerNode(node: LayoutNode): boolean {
  if (node.type === 'busBar' && node.hitZone?.type === 'mainBus') {
    return hasChildMatching(node, (c) => c.id?.startsWith('main-bus-segment-') === true)
  }
  if (node.type === 'secondaryBus') {
    return hasChildMatching(node, (c) => c.id?.startsWith('secondary-bus-segment-') === true)
  }
  return false
}

function supplySegmentSuffix(nodeId: string, panelId: string): string | null {
  const prefix = `supply-wire-segment-${panelId}-`
  if (!nodeId.startsWith(prefix)) return null
  return nodeId.slice(prefix.length)
}

function isSupplyWireSlotSegment(node: LayoutNode, panelNode: LayoutNode): boolean {
  if (node.type !== 'wire' || node.hitZone?.type !== 'supplyWire') return false

  const id = node.id ?? ''
  const panelId = panelNode.domainId ?? panelNode.id
  if (id.includes('supply-wire-vertical')) return false

  const hasHorizontalSegments = panelNode.children.some((c) =>
    c.id?.startsWith(`supply-wire-segment-${panelId}-`)
  )

  const suffix = supplySegmentSuffix(id, panelId)
  if (suffix != null) {
    if (suffix === 'entry-root' || suffix === 'entry-shared') return false
    if (suffix.endsWith('-root') || suffix.endsWith('-shared')) return false
    return suffix === 'entry' || /^\d+$/.test(suffix) || suffix === 'supply' || suffix === 'stub'
  }

  if (!hasHorizontalSegments && id === `supply-wire-${panelId}`) {
    return true
  }

  return false
}

function buildHintMatch(
  node: LayoutNode,
  hitType: NonNullable<DropTarget['type']>,
  ctx: HintWalkContext
): DropZoneHintMatch | undefined {
  if (hitType === 'supplyWire') {
    return {
      panelId: node.hitZone?.supplyPanelId ?? ctx.panelId,
      supplyFeedScope: node.hitZone?.supplyFeedScope ?? 'shared',
      supplyDeviceInsertIndex: node.hitZone?.supplyInsertIndex,
    }
  }
  if (hitType === 'mainBus' || hitType === 'circuit' || hitType === 'rcd') {
    return { panelId: ctx.panelId, circuitId: ctx.circuitId }
  }
  return ctx.panelId ? { panelId: ctx.panelId, circuitId: ctx.circuitId } : undefined
}

type HintWithSpan = DropZoneHint & { span: number }

function dedupeSupplyWireHints(hints: HintWithSpan[]): DropZoneHint[] {
  const supplyHints: HintWithSpan[] = []
  const otherHints: DropZoneHint[] = []

  for (const hint of hints) {
    if (hint.targetType === 'supplyWire') {
      supplyHints.push(hint)
    } else {
      otherHints.push(hint)
    }
  }

  const bestBySlot = new Map<string, HintWithSpan>()
  for (const hint of supplyHints) {
    const panelId = hint.match?.panelId ?? ''
    const scope = hint.match?.supplyFeedScope ?? 'shared'
    const index = hint.match?.supplyDeviceInsertIndex ?? 0
    const key = `${panelId}|${scope}|${index}`
    const existing = bestBySlot.get(key)
    if (!existing || hint.span > existing.span) {
      bestBySlot.set(key, hint)
    }
  }

  return [
    ...otherHints,
    ...[...bestBySlot.values()].map(({ nodeId, x, y, targetType, match }) => ({
      nodeId,
      x,
      y,
      targetType,
      match,
    })),
  ]
}

function shouldIncludeHintNode(
  node: LayoutNode,
  hitType: NonNullable<DropTarget['type']>,
  ctx: HintWalkContext,
  symbol: SymbolMetadata,
  project: ProjectWithOptionalV2Electrical,
  panelNode: LayoutNode,
  trunkSegmentCounts: Map<string, number>
): boolean {
  if (shouldSkipContainerNode(node)) return false
  if (node.hitZone?.type !== hitType) return false

  if (hitType === 'supplyWire') {
    if (node.type === 'trunkDevice' || node.type === 'supply') return false
    if (!isSupplyWireSlotSegment(node, panelNode)) return false
  }

  if (TRUNK_ONLY_ON_CIRCUIT_SYMBOLS.has(symbol.id)) {
    if (hitType === 'supplyWire') return false
    if (node.id?.startsWith('circuit-nest-')) return false
    if (node.id?.startsWith('circuit-trunk-') && hitType === 'circuit') return true
  }

  if (isProtectionDragSymbol(symbol)) {
    if (hitType === 'protection') return false
    if (node.type === 'mcb' || node.type === 'rcd') return false
    if (hitType === 'circuit') {
      if (node.type === 'branch' || node.type === 'trunkDevice') return false
      if (node.id?.startsWith('circuit-trunk-')) return false
      if (node.id?.startsWith('circuit-nest-')) return true
      if (node.id?.startsWith('secondary-bus-segment-')) {
        const circuit = ctx.circuitId ? findCircuitInProject(project, ctx.circuitId) : undefined
        return (circuit?.subCircuitIds?.length ?? 0) >= 2
      }
      return false
    }
  }

  if (isEndpointDragSymbol(symbol)) {
    if (hitType === 'protection') return false
    if (node.type === 'mcb' || node.type === 'rcd') return false
    if (node.id?.startsWith('secondary-bus-segment-')) return false
    if (node.id?.startsWith('circuit-nest-')) return false
    if (node.type === 'trunkDevice') return false
    if (node.id?.startsWith('circuit-trunk-')) {
      if (TRUNK_CAPABLE_ENDPOINT_SYMBOLS.has(symbol.id)) return true
      const circuit = ctx.circuitId ? findCircuitInProject(project, ctx.circuitId) : undefined
      if ((circuit?.subCircuitIds?.length ?? 0) === 0) return false
      return isLastCircuitTrunkSegment(node.id, trunkSegmentCounts)
    }
    if (hitType === 'circuit' && node.type !== 'branch') return false
    if (hitType === 'circuit' && node.type === 'branch') {
      // Domotica output wires have their own hints; skip the horizontal lead-in branch wire.
      const hasDomoticaParent = node.children.some(
        (child) =>
          child.type === 'endpoint' &&
          (child.domainRef as Endpoint | undefined)?.symbol === 'domotica' &&
          !(child.domainRef as Endpoint | undefined)?.domoticaChildProps
      )
      if (hasDomoticaParent) return false

      const circuit = ctx.circuitId ? findCircuitInProject(project, ctx.circuitId) : undefined
      const hasNested = (circuit?.subCircuitIds?.length ?? 0) > 0
      const hasOwnEndpoints = (circuit?.endpoints?.length ?? 0) > 0
      if (hasNested && !hasOwnEndpoints) return false
    }
  }

  if (ctx.circuitId && circuitFeedsSubPanel(project, ctx.circuitId)) {
    const isEndpointSymbol = !!getEndpointTypeFromSymbol(symbol)
    const isTrunkOnlySymbol = TRUNK_ONLY_ON_CIRCUIT_SYMBOLS.has(symbol.id)
    if (
      isEndpointSymbol ||
      isTrunkOnlySymbol ||
      (hitType === 'circuit' && node.type === 'branch')
    ) {
      return false
    }
  }

  if (hitType === 'groundWire' && !ctx.panelIsMain) {
    return false
  }

  if (symbol.id === 'earthing' && hitType === 'mainBus' && !ctx.panelIsMain) {
    return false
  }

  if (TRUNK_ONLY_ON_CIRCUIT_SYMBOLS.has(symbol.id) && node.type === 'branch') {
    return false
  }

  if (
    TRUNK_ONLY_ON_CIRCUIT_SYMBOLS.has(symbol.id) &&
    hitType === 'circuit' &&
    node.type === 'wire' &&
    !node.id?.includes('circuit-trunk-') &&
    !node.id?.startsWith('supply-wire-')
  ) {
    return false
  }

  if (node.type === 'trunkDevice') {
    if (
      node.id?.startsWith('supplyTrunkDevice-') ||
      node.id?.startsWith('subpanelSupplyTrunkDevice-')
    ) {
      return false
    }
    if (node.id?.startsWith('groundTrunkDevice-')) {
      return hitType === 'groundWire'
    }
    return hitType === 'circuit'
  }

  return true
}

function accumulateHintContext(node: LayoutNode, ctx: HintWalkContext): HintWalkContext {
  if (node.type === 'mcb' && node.domainRef) {
    const protection = node.domainRef as ProtectionDevice
    const circuitId = node.circuitIdForWires ?? protection.circuits?.[0]?.id
    if (circuitId) {
      return { ...ctx, circuitId }
    }
  }
  if (node.type === 'panel' && node.domainRef) {
    const panel = node.domainRef as Panel
    return { ...ctx, panelId: panel.id, panelIsMain: panel.isMain }
  }
  return ctx
}

function visitForHints(
  node: LayoutNode,
  ctx: HintWalkContext,
  panelNode: LayoutNode,
  validTargets: Set<NonNullable<DropTarget['type']>>,
  symbol: SymbolMetadata,
  project: ProjectWithOptionalV2Electrical,
  trunkSegmentCounts: Map<string, number>,
  hints: HintWithSpan[]
): void {
  const nextCtx = accumulateHintContext(node, ctx)

  if (node.hitZone?.type && validTargets.has(node.hitZone.type)) {
    if (
      shouldIncludeHintNode(
        node,
        node.hitZone.type,
        nextCtx,
        symbol,
        project,
        panelNode,
        trunkSegmentCounts
      )
    ) {
      const { x, y } = hintAnchor(node)
      const trunkParsed = node.id ? parseCircuitTrunkSegmentId(node.id) : null
      const baseMatch = buildHintMatch(node, node.hitZone.type, nextCtx)
      hints.push({
        nodeId: node.id,
        x,
        y,
        targetType: node.hitZone.type,
        match:
          trunkParsed != null
            ? { ...baseMatch, circuitTrunkSegmentIndex: trunkParsed.segmentIndex }
            : baseMatch,
        span: hintSpan(node),
      })
    }
  }

  for (const child of node.children) {
    visitForHints(
      child,
      nextCtx,
      panelNode,
      validTargets,
      symbol,
      project,
      trunkSegmentCounts,
      hints
    )
  }
}

/**
 * True when the cursor is already targeting this hint (hide it while hovering).
 */
export function isDropZoneHintActive(
  hint: DropZoneHint,
  dropTarget: DropTarget | null,
  matchedNodeId: string | null
): boolean {
  if (!dropTarget || dropTarget.type !== hint.targetType) return false
  if (matchedNodeId && matchedNodeId === hint.nodeId) return true

  if (dropTarget.type === 'supplyWire' && hint.match) {
    const scope = dropTarget.supplyFeedScope ?? 'shared'
    const hintScope = hint.match.supplyFeedScope ?? 'shared'
    return (
      dropTarget.panelId === hint.match.panelId &&
      scope === hintScope &&
      dropTarget.supplyDeviceInsertIndex === hint.match.supplyDeviceInsertIndex
    )
  }

  if (
    dropTarget.type === 'circuit' &&
    hint.match?.circuitId &&
    dropTarget.circuitId === hint.match.circuitId &&
    hint.nodeId.startsWith('circuit-nest-') &&
    typeof dropTarget.secondaryBusInsertIndex !== 'number'
  ) {
    return true
  }

  if (
    dropTarget.type === 'circuit' &&
    hint.match?.circuitId &&
    dropTarget.circuitId === hint.match.circuitId &&
    typeof hint.match.circuitTrunkSegmentIndex === 'number' &&
    typeof dropTarget.circuitTrunkSegmentIndex === 'number'
  ) {
    return dropTarget.circuitTrunkSegmentIndex === hint.match.circuitTrunkSegmentIndex
  }

  return false
}

function isHintCompatibleWithDropTarget(hint: DropZoneHint, dropTarget: DropTarget): boolean {
  if (!dropTarget.type || hint.targetType !== dropTarget.type) return false

  const match = hint.match
  if (!match) return true
  if (match.panelId && dropTarget.panelId && match.panelId !== dropTarget.panelId) return false
  if (match.circuitId && dropTarget.circuitId && match.circuitId !== dropTarget.circuitId) {
    return false
  }
  if (
    typeof match.circuitTrunkSegmentIndex === 'number' &&
    typeof dropTarget.circuitTrunkSegmentIndex === 'number' &&
    match.circuitTrunkSegmentIndex !== dropTarget.circuitTrunkSegmentIndex
  ) {
    return false
  }
  if (
    typeof match.supplyDeviceInsertIndex === 'number' &&
    typeof dropTarget.supplyDeviceInsertIndex === 'number' &&
    match.supplyDeviceInsertIndex !== dropTarget.supplyDeviceInsertIndex
  ) {
    return false
  }
  if (
    match.supplyFeedScope &&
    dropTarget.supplyFeedScope &&
    match.supplyFeedScope !== dropTarget.supplyFeedScope
  ) {
    return false
  }
  return true
}

/** Resolve the single hint represented by the current concrete drop preview. */
export function resolveActiveDropZoneHintNodeId(
  hints: DropZoneHint[],
  dropTarget: DropTarget | null,
  matchedNodeId: string | null,
  position: Point | null
): string | null {
  if (!dropTarget?.type) return null

  const exactMatch = matchedNodeId
    ? hints.find((hint) => hint.nodeId === matchedNodeId && hint.targetType === dropTarget.type)
    : undefined
  if (exactMatch) return exactMatch.nodeId

  const semanticMatches = hints.filter((hint) =>
    isDropZoneHintActive(hint, dropTarget, matchedNodeId)
  )
  const candidates =
    semanticMatches.length > 0
      ? semanticMatches
      : hints.filter((hint) => isHintCompatibleWithDropTarget(hint, dropTarget))

  if (candidates.length === 0) return null
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return candidates.length === 1 ? candidates[0]!.nodeId : null
  }

  return candidates.reduce((closest, hint) => {
    const closestDistance = (closest.x - position.x) ** 2 + (closest.y - position.y) ** 2
    const hintDistance = (hint.x - position.x) ** 2 + (hint.y - position.y) ** 2
    return hintDistance < closestDistance ? hint : closest
  }).nodeId
}

/**
 * Returns hint markers for every legal drop target of the given symbol on the current layout.
 */
export function collectDropZoneHints(
  symbol: SymbolMetadata,
  layoutTree: LayoutTree,
  project: ProjectWithOptionalV2Electrical
): DropZoneHint[] {
  const behavior = dropBehaviors[symbol.id]
  if (!behavior) return []

  const validTargets = new Set(
    behavior.validTargets.filter((t): t is NonNullable<DropTarget['type']> => t !== null)
  )
  if (validTargets.size === 0) return []

  const rawHints: HintWithSpan[] = []
  const trunkSegmentCounts = buildTrunkSegmentCountByCircuit(layoutTree)

  for (const panelNode of layoutTree.panels) {
    const panelId = panelNode.domainId ?? panelNode.id
    visitForHints(
      panelNode,
      { panelId, panelIsMain: (panelNode.domainRef as Panel | undefined)?.isMain },
      panelNode,
      validTargets,
      symbol,
      project,
      trunkSegmentCounts,
      rawHints
    )
  }

  appendTrunkTopSlotHints(symbol, project, layoutTree, trunkSegmentCounts, rawHints)

  return dedupeSupplyWireHints(rawHints)
}
