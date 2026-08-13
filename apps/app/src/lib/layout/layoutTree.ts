/**
 * Unified Layout Tree (Scene Graph)
 *
 * This module defines the LayoutNode tree structure that serves as the single
 * source of truth for layout, rendering, hit testing, and wire generation.
 *
 * Phase 0: Adapter from existing BottomUpLayoutResult
 * Phase 2+: Direct generation via NodeLayouter pattern
 */

import type {
  Panel,
  Circuit,
  ProtectionDevice,
  Endpoint,
  CableSpec,
  TrunkDevice,
} from '@/types/schema'
import { getSubPanelMainBusFeedDevice } from '@/lib/panel/subPanelFeed'
import { resolvePanelSupplyLinkForProtection } from '@/lib/eendraad/panelSupplyLink'
import {
  getEndpointNoteMaximumRightX,
  getEndpointNoteMinimumLeftX,
} from '@/lib/eendraad/endpointNoteLabelCollision'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import {
  DOMOTICA_BASE_HEIGHT,
  DOMOTICA_BOX_WIDTH,
  DOMOTICA_BRANCH_LEAD,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_OUTPUT_SPACING,
} from '@/lib/domoticaLayout'

/**
 * Node types in the layout tree
 */
export type LayoutNodeType =
  | 'panel'
  | 'busBar'
  | 'rcd'
  | 'mcb'
  | 'branch'
  | 'endpoint'
  | 'wire'
  | 'label'
  | 'supply'
  | 'ground'
  | 'trunk'
  | 'secondaryBus'
  | 'trunkDevice'

/**
 * Drop target types for hit testing
 */
export type DropTargetType =
  | 'circuit'
  | 'protection'
  | 'endpoint'
  | 'mainBus'
  | 'rcd'
  | 'supplyWire'
  | 'supplyBackupWire'
  | 'supplyBackupOutputWire'
  | 'supplyChangeoverGridWire'
  | 'supplyConverterGridWire'
  | 'supplyConverterBackupWire'
  | 'supplyConverterDcWire'
  | 'groundWire'
  | null

/**
 * Visual properties for different node types
 */
export interface SymbolVisual {
  type: 'symbol'
  symbolId: string
  label?: string
  opacity?: number
  /** Whether this endpoint is the final symbol on its horizontal branch. */
  isEndpointAtBranchEnd?: boolean
  /** Mirror artwork for an endpoint connected by a left-running branch. */
  mirrorHorizontally?: boolean
  /** For a bottom label, keep its left edge clear of a nearby branch wire. */
  bottomLabelMinimumLeftX?: number
  /** For a bottom label, truncate before crossing the circuit's right boundary. */
  bottomLabelMaximumRightX?: number
}

export interface WireVisual {
  type: 'wire'
  cable: CableSpec
  wireType: 'trunk' | 'branch' | 'vertical' | 'mainBus' | 'secondaryBus'
  inTube?: boolean
  inWall?: boolean
  wireRoute?: 'wall' | 'ground' | 'air'
  hideWireLabel?: boolean
}

export interface BusBarVisual {
  type: 'busBar'
  thickness: number
}

export interface LabelVisual {
  type: 'label'
  text: string
  translationKey?: string
  fontSize?: number
  variant?: 'circuit-notes' | 'default' // 'circuit-notes' for italic, gray styling
  /** When 'left', label is drawn with left edge at bounds.x (e.g. to the right of domotica endpoints). */
  align?: 'left' | 'center' | 'right'
  /** For circuit-notes: draw text horizontal or vertical (90° rotated). */
  notesOrientation?: 'horizontal' | 'vertical'
  /** For circuit-notes: if false, do not draw (slot reserved for layout stability). */
  notesVisible?: boolean
}

export type NodeVisual = SymbolVisual | WireVisual | BusBarVisual | LabelVisual

/**
 * Hit zone configuration for drop target detection
 */
export interface HitZone {
  type: DropTargetType
  padding: number
  outputGroup?: 'control' | 'endpoint'
  outputIndex?: number
  outputExpands?: boolean
  supplyFeedScope?: 'shared' | 'root'
  supplyInsertIndex?: number
  supplyPanelId?: string
  supplyConverterDcBranch?: 'right' | 'top'
  /** The single direct-converter junction where a source changeover may be inserted. */
  supplyConverterChangeoverSlot?: boolean
}

/**
 * Bounds rectangle for a layout node
 */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The unified layout tree node
 *
 * This is the single source of truth for:
 * - Element positions (bounds)
 * - Visual properties (visual)
 * - Hit testing zones (hitZone)
 * - Domain references (domainId, domainRef)
 * - Hierarchical structure (children)
 */
export interface LayoutNode {
  id: string
  type: LayoutNodeType
  bounds: Bounds
  domainId?: string // panel.id, circuit.id, endpoint.id, protection.id
  /** Unique frame identity when one electrical panel renders in multiple frames. */
  diagramId?: string
  domainRef?: Panel | Circuit | ProtectionDevice | Endpoint | TrunkDevice // Typed domain reference
  /** When set on an `mcb` node, wires for this column use this circuit (multi-circuit protections / merged sub-panel feed). */
  circuitIdForWires?: string
  visual?: NodeVisual
  hitZone?: HitZone
  children: LayoutNode[]
  /** Nested child X positions on secondary bus nodes (insertion logic metadata). */
  nestedChildXs?: number[]
}

/**
 * Root layout tree structure
 * Contains all panels as top-level nodes
 */
export interface LayoutTree {
  panels: LayoutNode[] // Each panel is a LayoutNode with type='panel'
  totalWidth: number
  totalHeight: number
}

/**
 * Adapter: Convert flat BottomUpLayoutResult to hierarchical LayoutTree
 *
 * This is a pure mapping function - no layout math, just restructuring.
 * Used in Phase 0-1 as a bridge while we migrate to direct tree generation.
 */
import type {
  BottomUpLayoutResult,
  BottomUpPanelLayout,
  BottomUpLayoutElement,
  BottomUpCircuitLayout,
} from './bottomUpLayout'
import type { BranchLayout } from './wireSegments'
import { clamp } from '@/lib/geometry'
import {
  LAYOUT_CONSTANTS,
  PROTECTION_LABEL_DEFAULT_BOX_WIDTH,
  estimateProtectionNameLabelWidth,
  getPanelDiagramId,
  hasPanelAttachmentOnSecondaryBus,
  isPanelOnlySubPanelFeeder,
} from './bottomUpLayout'

/** Minimum vertical segment length on sub-panel incoming feeder (matches virtual MCB anchor math). */
export const MIN_SUBPANEL_INCOMING_SEGMENT_LENGTH = 60
/** Sub-panel incoming feeder: circuit code, then parent panel name (Y grows downward, from virtual MCB anchor). */
export const SUBPANEL_FEED_CIRCUIT_LABEL_Y = 0
export const SUBPANEL_FEED_PARENT_TAG_Y = 28

/**
 * Scene anchors for sub-panel feeder labels — same geometry as `buildPanelNode` parent-MCB branch
 * (export / PDF must not use raw `bottomUpLayout` element Y for these).
 */
export function getSubPanelIncomingFeedLabelAnchors(
  panelLayout: BottomUpPanelLayout
): { centerX: number; circuitAnchorY: number; parentTagAnchorY: number } | null {
  const parentMcbEl = panelLayout.elements.find((e) => e.id === 'parent-mcb')
  if (!parentMcbEl) return null

  const mainBusY = panelLayout.mainBus.y
  const parentMcbBaseY = parentMcbEl.position.y
  const parentMcbAnchorY = Math.max(
    parentMcbBaseY,
    mainBusY + MIN_SUBPANEL_INCOMING_SEGMENT_LENGTH * 2
  )

  return {
    centerX: parentMcbEl.position.x,
    circuitAnchorY: parentMcbAnchorY + SUBPANEL_FEED_CIRCUIT_LABEL_Y,
    parentTagAnchorY: parentMcbAnchorY + SUBPANEL_FEED_PARENT_TAG_Y,
  }
}

/** Map ProtectionType enum to the canvas symbol ID used for rendering & wire insets */
function protectionTypeToSymbolId(type?: string): string {
  switch (type) {
    case 'RCBO':
      return 'rcbo'
    case 'RCD':
      return 'rcd'
    case 'FUSE':
      return 'fuse'
    case 'MAIN_SWITCH':
      return 'main_switch'
    case 'ROTATING_SWITCH':
      return 'rotating_switch'
    case 'SPD':
      return 'spd'
    default:
      return 'mcb'
  }
}

export function buildLayoutTree(layout: BottomUpLayoutResult): LayoutTree {
  const panelNodes: LayoutNode[] = layout.panels.map((panelLayout) => buildPanelNode(panelLayout))

  return {
    panels: panelNodes,
    totalWidth: layout.totalWidth,
    totalHeight: layout.totalHeight,
  }
}

function buildPanelNode(panelLayout: BottomUpPanelLayout): LayoutNode {
  const children: LayoutNode[] = []

  // Find supply and ground elements
  const supplyElement = panelLayout.elements.find((e) => e.type === 'supply')
  const groundElement = panelLayout.elements.find((e) => e.type === 'ground')
  const mainBusElement = panelLayout.elements.find((e) => e.type === 'mainBus')

  // Add supply
  if (supplyElement) {
    children.push({
      id: supplyElement.id,
      type: 'supply',
      bounds: {
        x: supplyElement.position.x,
        y: supplyElement.position.y,
        width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
      },
      visual: {
        type: 'symbol',
        symbolId: 'mains',
        opacity: panelLayout.supplyEndpointKind === 'continuation' ? 0 : undefined,
      },
      hitZone: {
        type: panelLayout.supplyEndpointKind === 'continuation' ? null : 'supplyWire',
        padding: 0,
        supplyFeedScope: 'shared',
        supplyInsertIndex: 0,
        supplyPanelId: panelLayout.panel.id,
      },
      children: [],
    })
  }

  const supplyContinuationLabel = panelLayout.elements.find(
    (element) => element.id === 'supply-continuation-label'
  )
  if (supplyContinuationLabel) {
    children.push({
      id: supplyContinuationLabel.id,
      type: 'label',
      bounds: {
        x: supplyContinuationLabel.position.x,
        y: supplyContinuationLabel.position.y,
        width: 120,
        height: 20,
      },
      visual: {
        type: 'label',
        text: supplyContinuationLabel.label ?? '',
        translationKey: supplyContinuationLabel.translationKey,
        align: 'center',
      },
      children: [],
    })
  }

  // Add supply trunk device nodes (energy meters, protections on the supply wire)
  const supplyTrunkDeviceElements = panelLayout.elements.filter(
    (e) => e.type === 'trunkDevice' && e.id?.startsWith('supplyTrunkDevice-')
  )
  for (const stdElement of supplyTrunkDeviceElements) {
    const supplyDeviceData = panelLayout.supplyDevices?.find(
      (sd) => sd.device.id === stdElement.trunkDeviceId
    )
    if (supplyDeviceData) {
      children.push({
        id: stdElement.id,
        type: 'trunkDevice',
        bounds: {
          x: stdElement.position.x,
          y: stdElement.position.y,
          width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
          height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        },
        domainId: supplyDeviceData.device.id,
        domainRef: supplyDeviceData.device,
        visual: {
          type: 'symbol',
          symbolId: supplyDeviceData.device.symbol || 'energy_meter',
          label: supplyDeviceData.device.label,
        },
        hitZone: {
          // Branch devices keep their own insertion lane. The converter itself remains
          // selectable, but is not another insertion slot.
          type:
            supplyDeviceData.device.supplyPath === 'backup'
              ? null
              : supplyDeviceData.device.supplyPath === 'converter-branch' ||
                  supplyDeviceData.device.supplyPath === 'converter-dc' ||
                  supplyDeviceData.device.supplyPath === 'converter-dc-top'
                ? null
                : supplyDeviceData.device.supplyPath === 'backup-output'
                  ? 'supplyBackupOutputWire'
                  : supplyDeviceData.device.supplyPath === 'changeover-grid'
                    ? 'supplyChangeoverGridWire'
                    : supplyDeviceData.device.supplyPath === 'converter-grid'
                      ? 'supplyConverterGridWire'
                      : 'supplyWire',
          // Make supply trunk devices easy to hit while dragging/dropping.
          padding: 10,
          supplyFeedScope: supplyDeviceData.feedScope,
          supplyInsertIndex: supplyDeviceData.feedIndex,
          supplyPanelId: panelLayout.panel.id,
        },
        children: [],
      })
    }
  }

  // Add ground
  if (groundElement) {
    children.push({
      id: groundElement.id,
      type: 'ground',
      bounds: {
        x: groundElement.position.x,
        y: groundElement.position.y,
        width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
      },
      visual: {
        type: 'symbol',
        symbolId: 'earthing',
      },
      hitZone: {
        type: null,
        padding: 0,
      },
      children: [],
    })
  }

  // Add ground trunk device nodes (earthing separators on the ground wire)
  const groundTrunkDeviceElements = panelLayout.elements.filter(
    (e) => e.type === 'trunkDevice' && e.id?.startsWith('groundTrunkDevice-')
  )
  for (const gtdElement of groundTrunkDeviceElements) {
    const groundDeviceData = panelLayout.groundDevices?.find(
      (gd) => gd.device.id === gtdElement.trunkDeviceId
    )
    if (groundDeviceData) {
      children.push({
        id: gtdElement.id,
        type: 'trunkDevice',
        bounds: {
          x: gtdElement.position.x,
          y: gtdElement.position.y,
          width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
          height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        },
        domainId: groundDeviceData.device.id,
        domainRef: groundDeviceData.device,
        visual: {
          type: 'symbol',
          symbolId: groundDeviceData.device.symbol || 'earthing_separator',
          label: groundDeviceData.device.label,
        },
        hitZone: {
          type: 'groundWire', // Trunk devices on ground wire target the ground wire
          // Slightly larger hit zone for easier selection.
          padding: 10,
        },
        children: [],
      })
    }
  }

  // For sub-panels: add parent MCB node (instead of supply)
  // This is the mirrored copy of the MCB from the parent panel that feeds this sub-panel.
  const parentMcbElement = panelLayout.elements.find((e) => e.id === 'parent-mcb')
  const panelFeed = getSubPanelMainBusFeedDevice(panelLayout.panel)
  const panelSupplyDevices = panelFeed ? [panelFeed.device] : []
  if (parentMcbElement) {
    const parentMcbLabelElement = panelLayout.elements.find((e) => e.id === 'parent-mcb-label')
    // Sub-panel feeder geometry notes:
    // - `parentMcbElement.position.y` comes from bottomUpLayout (legacy fixed supply root depth).
    // - For local feeder protection rendering we need a taller incoming wire so we can draw 1A2.
    // - We therefore define a virtual/visual MCB anchor (`parentMcbAnchorY`) used by
    //   the mirrored parent MCB, its label, and the incoming wire hit zone in this tree.
    // - This does not mutate panel data; it only affects layout-tree rendering/hit-testing.
    const parentMcbAnchorY = mainBusElement
      ? Math.max(
          parentMcbElement.position.y,
          // Ensure the total feeder height can fit two minimum wire segments
          // (below + above inserted protection): 2 * minSegmentLength.
          mainBusElement.position.y + MIN_SUBPANEL_INCOMING_SEGMENT_LENGTH * 2
        )
      : parentMcbElement.position.y

    // Resolve the protection type for correct symbol rendering
    const parentMcbProtection = panelLayout.parentMcb?.protection
    const protectionSymbolId = protectionTypeToSymbolId(parentMcbProtection?.type)

    children.push({
      id: 'parent-mcb',
      type: 'mcb',
      bounds: {
        x: parentMcbElement.position.x,
        y: parentMcbAnchorY,
        width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
      },
      domainId: parentMcbElement.protectionId,
      domainRef: parentMcbProtection,
      circuitIdForWires: parentMcbElement.circuitId,
      visual: {
        type: 'symbol',
        symbolId: protectionSymbolId,
        label: parentMcbProtection?.label || '',
      },
      hitZone: {
        // Parent feeder protection is only a mirrored reference from the parent panel.
        // It should not be selectable/editable inside the sub-panel canvas.
        type: null,
        padding: 0,
      },
      children: [],
    })

    // Sub-panel incoming supply trunk devices:
    // use the sub-panel's local PANEL circuit trunkDevices so they only exist/appear in this panel.
    if (panelSupplyDevices.length > 0 && mainBusElement) {
      // Keep the local feeder device between parent MCB and busbar (1A2),
      // with enough wire length on both sides for regular wire labels.
      const mcbY = parentMcbAnchorY
      const busY = mainBusElement.position.y
      const minSegmentLength = MIN_SUBPANEL_INCOMING_SEGMENT_LENGTH
      const midpointY = (mcbY + busY) / 2
      // Clamp insertion zone so both wire segments stay >= minSegmentLength.
      const minY = busY + minSegmentLength
      const maxY = mcbY - minSegmentLength
      const pinnedDeviceY = minY <= maxY ? clamp(maxY, minY, midpointY) : midpointY
      // Show at most one local feeder protection/device on sub-panel incoming wire.
      panelSupplyDevices.forEach((device) => {
        children.push({
          id: `subpanelSupplyTrunkDevice-${device.id}`,
          type: 'trunkDevice',
          bounds: {
            x: parentMcbElement.position.x,
            y: pinnedDeviceY,
            width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
            height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
          },
          domainId: device.id,
          domainRef: device,
          visual: {
            type: 'symbol',
            symbolId: device.symbol || 'energy_meter',
            label: device.label,
          },
          hitZone: {
            type: 'supplyWire',
            padding: 10,
          },
          children: [],
        })
      })
    }

    // Add parent MCB label. If the panel has a local incoming protection, keep
    // the feeder label near that visible device instead of the hidden mirrored
    // parent MCB anchor.
    if (parentMcbLabelElement) {
      children.push({
        id: 'parent-mcb-label',
        type: 'label',
        bounds: {
          x: parentMcbElement.position.x,
          y: parentMcbAnchorY + SUBPANEL_FEED_CIRCUIT_LABEL_Y,
          width: 100,
          height: 20,
        },
        visual: {
          type: 'label',
          text: parentMcbLabelElement.label || '',
          fontSize: 12,
          align: 'center',
        },
        children: [],
      })
    }
  }

  // For sub-panels: add parent panel tag label (e.g. "← Main Panel")
  const parentTagElement = panelLayout.elements.find((e) => e.id?.startsWith('parent-tag-'))
  if (parentTagElement) {
    const parentMcbNode = children.find((c) => c.id === 'parent-mcb')
    const parentMcbAnchorY = parentMcbNode?.bounds.y
    const localFeederDeviceNode = children.find((c) =>
      c.id?.startsWith('subpanelSupplyTrunkDevice-')
    )
    const parentTagY =
      localFeederDeviceNode?.bounds.y != null
        ? parentMcbAnchorY != null
          ? parentMcbAnchorY + SUBPANEL_FEED_CIRCUIT_LABEL_Y
          : localFeederDeviceNode.bounds.y + SUBPANEL_FEED_PARENT_TAG_Y + 20
        : parentMcbAnchorY != null
          ? parentMcbAnchorY + SUBPANEL_FEED_CIRCUIT_LABEL_Y
          : parentTagElement.position.y
    const parentMcbX = parentMcbElement?.position.x ?? parentTagElement.position.x
    children.push({
      id: parentTagElement.id,
      type: 'label',
      bounds: {
        x: parentMcbX,
        y: parentTagY,
        width: 150,
        height: 20,
      },
      visual: {
        type: 'label',
        text: parentTagElement.label || '',
        fontSize: 10,
        align: 'center',
      },
      children: [],
    })
  }

  // Build main bus node with all its children (RCDs, MCBs, etc.)
  if (mainBusElement) {
    const mainBusNode = buildMainBusNode(panelLayout, mainBusElement, groundElement)
    children.push(mainBusNode)
  }

  const outputLabel = panelLayout.elements.find((element) => element.id === 'feed-output-label')
  if (panelLayout.feedOutput) {
    children.push({
      id: `feed-output-wire-${panelLayout.panel.id}`,
      type: 'wire',
      bounds: {
        x: panelLayout.feedOutput.x - 4,
        y: panelLayout.feedOutput.endY,
        width: 8,
        height: panelLayout.feedOutput.busY - panelLayout.feedOutput.endY,
      },
      hitZone: { type: null, padding: 0 },
      children: [],
    })
  }
  if (outputLabel) {
    children.push({
      id: outputLabel.id,
      type: 'label',
      bounds: {
        x: outputLabel.position.x,
        y: outputLabel.position.y,
        width: 140,
        height: 20,
      },
      visual: {
        type: 'label',
        text: outputLabel.label ?? '',
        translationKey: outputLabel.translationKey,
        align: 'center',
      },
      children: [],
    })
  }

  // Sub-panel incoming feeder wire hit zone (parent MCB -> child panel main bus).
  // This enables drop/preview for protections and trunk devices on that local wire.
  if (parentMcbElement && mainBusElement) {
    const pad = 10
    const parentMcbNode = children.find((c) => c.id === 'parent-mcb')
    const incomingWireEndY = parentMcbNode?.bounds.y ?? parentMcbElement.position.y
    const wireTop = Math.min(mainBusElement.position.y, incomingWireEndY)
    const wireHeight = Math.abs(incomingWireEndY - mainBusElement.position.y)
    children.unshift({
      id: `subpanel-supply-wire-${panelLayout.panel.id}`,
      type: 'wire',
      bounds: {
        x: parentMcbElement.position.x - pad,
        y: wireTop,
        width: pad * 2,
        height: wireHeight,
      },
      hitZone: {
        type: 'supplyWire',
        padding: 0,
      },
      children: [],
    })
  }

  return {
    id: `panel-${getPanelDiagramId(panelLayout)}`,
    type: 'panel',
    bounds: {
      x: panelLayout.frame.x,
      y: panelLayout.frame.y,
      width: panelLayout.frame.width,
      height: panelLayout.frame.height,
    },
    domainId: panelLayout.panel.id,
    diagramId: getPanelDiagramId(panelLayout),
    domainRef: panelLayout.panel,
    children,
  }
}

function buildMainBusNode(
  panelLayout: BottomUpPanelLayout,
  mainBusElement: BottomUpLayoutElement,
  groundElement?: BottomUpLayoutElement
): LayoutNode {
  const children: LayoutNode[] = []

  // Group circuits by their parent RCD (if any)
  const rcdGroups = new Map<string, BottomUpCircuitLayout[]>()
  const directMcbs: BottomUpCircuitLayout[] = []

  for (const circuitLayout of panelLayout.circuits) {
    // Skip nested circuits - they'll be handled under their parent circuit
    if (circuitLayout.parentCircuit) {
      continue
    }

    if (circuitLayout.parentRcd) {
      const rcdId = circuitLayout.parentRcd.id
      if (!rcdGroups.has(rcdId)) {
        rcdGroups.set(rcdId, [])
      }
      rcdGroups.get(rcdId)!.push(circuitLayout)
    } else {
      directMcbs.push(circuitLayout)
    }
  }

  // Build RCD nodes (each RCD has a trunk/secondaryBus with MCBs)
  for (const [rcdId, circuits] of rcdGroups.entries()) {
    const rcdElement = panelLayout.elements.find(
      (e) => e.type === 'rcd' && e.protectionId === rcdId
    )
    if (rcdElement) {
      const rcdNode = buildRcdNode(panelLayout, rcdElement, circuits)
      children.push(rcdNode)
    }
  }

  // Build RCD nodes for RCDs with 0 circuits (freshly dropped, not yet populated)
  for (const protection of panelLayout.panel.protections) {
    if (
      (protection.type === 'RCD' || protection.type === 'RCBO') &&
      !rcdGroups.has(protection.id)
    ) {
      const rcdElement = panelLayout.elements.find(
        (e) => e.type === 'rcd' && e.protectionId === protection.id
      )
      if (rcdElement) {
        const rcdNode = buildRcdNode(panelLayout, rcdElement, [])
        children.push(rcdNode)
      }
    }
  }

  // Build direct MCB nodes (not under RCD)
  for (const circuitLayout of directMcbs) {
    const mcbNode = buildMcbNode(panelLayout, circuitLayout)
    if (mcbNode) {
      children.push(mcbNode)
    }
  }

  // Supply wire: drop target for inserting energy meters and protection devices.
  // The wire goes from main bus down to the bend point, then optionally horizontal to the supply symbol.
  // When devices exist, the supply symbol is at the END (rightmost) of the horizontal chain.
  const supply = panelLayout.supply
  const supplyBend = panelLayout.supplyBend
  if (supply && mainBusElement.position) {
    const pad = 10
    const supplyDevicesSorted = [...(panelLayout.supplyDevices ?? [])]
      .filter(
        ({ device }) =>
          panelLayout.supplyChangeoverBranches ||
          !panelLayout.supplyConverterBranch ||
          !['converter-grid', 'converter-dc', 'converter-dc-top'].includes(device.supplyPath ?? '')
      )
      .sort((a, b) => a.x - b.x)
    const hasSupplyDevices = supplyDevicesSorted.length > 0

    if (supplyBend) {
      const bendX = supplyBend.x
      const bendY = supplyBend.y
      const rootDevices = hasSupplyDevices
        ? supplyDevicesSorted.filter((device) => device.feedScope === 'root')
        : []
      const sharedDevices = hasSupplyDevices
        ? supplyDevicesSorted.filter((device) => device.feedScope === 'shared')
        : []
      const rootCount = rootDevices.length
      const sharedCount = sharedDevices.length
      const leftmostDevice = supplyDevicesSorted[0]
      const rightmostDevice = supplyDevicesSorted[supplyDevicesSorted.length - 1]
      const leftmostSharedDevice = sharedDevices[0]

      const pushSupplySegment = (
        id: string,
        x1: number,
        x2: number,
        scope: 'shared' | 'root',
        insertIndex: number,
        supplyConverterChangeoverSlot = false
      ) => {
        // A changeover owns lane-aware hit zones below. Do not leave stale zones
        // behind on the former centerline after its source-side symbols move down.
        if (panelLayout.supplyChangeoverBranches) return
        if (x2 <= x1) return
        children.unshift({
          id,
          type: 'wire',
          bounds: {
            x: x1 - pad,
            y: bendY - pad,
            width: x2 - x1 + pad * 2,
            height: pad * 2,
          },
          hitZone: {
            type: 'supplyWire',
            padding: 0,
            supplyFeedScope: scope,
            supplyInsertIndex: insertIndex,
            supplyPanelId: panelLayout.panel.id,
            supplyConverterChangeoverSlot,
          },
          children: [],
        })
      }

      // Vertical segment from main bus down to bend point always belongs to the panel-local feed
      // when present; otherwise it is part of the shared path.
      children.unshift({
        id: `supply-wire-vertical-${panelLayout.panel.id}`,
        type: 'wire',
        bounds: {
          x: bendX - pad,
          y: mainBusElement.position.y,
          width: pad * 2,
          height: bendY - mainBusElement.position.y,
        },
        hitZone: {
          type: 'supplyWire',
          padding: 0,
          supplyFeedScope: 'root',
          supplyInsertIndex: rootCount > 0 || sharedCount > 0 ? rootCount : sharedCount,
          supplyPanelId: panelLayout.panel.id,
        },
        children: [],
      })

      if (hasSupplyDevices) {
        if (leftmostDevice) {
          if (rootCount === 0 && leftmostSharedDevice) {
            const separatorX = (bendX + leftmostSharedDevice.x) / 2
            pushSupplySegment(
              `supply-wire-segment-${panelLayout.panel.id}-entry-root`,
              bendX,
              separatorX,
              'root',
              0
            )
            pushSupplySegment(
              `supply-wire-segment-${panelLayout.panel.id}-entry-shared`,
              separatorX,
              leftmostSharedDevice.x,
              'shared',
              sharedCount
            )
          } else {
            pushSupplySegment(
              `supply-wire-segment-${panelLayout.panel.id}-entry`,
              bendX,
              leftmostDevice.x,
              leftmostDevice.feedScope,
              leftmostDevice.feedIndex + 1,
              leftmostDevice.device.supplyPath === 'converter-branch'
            )
          }
        }

        for (let i = 0; i < supplyDevicesSorted.length - 1; i++) {
          const left = supplyDevicesSorted[i]!
          const right = supplyDevicesSorted[i + 1]!

          if (left.feedScope === right.feedScope) {
            pushSupplySegment(
              `supply-wire-segment-${panelLayout.panel.id}-${i}`,
              left.x,
              right.x,
              right.feedScope,
              right.feedIndex + 1,
              right.device.supplyPath === 'converter-branch'
            )
            continue
          }

          const separatorX = (left.x + right.x) / 2
          pushSupplySegment(
            `supply-wire-segment-${panelLayout.panel.id}-${i}-root`,
            left.x,
            separatorX,
            'root',
            0
          )
          pushSupplySegment(
            `supply-wire-segment-${panelLayout.panel.id}-${i}-shared`,
            separatorX,
            right.x,
            'shared',
            sharedCount
          )
        }

        const supplyEndX = supply.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        if (rightmostDevice) {
          if (sharedCount === 0 && rightmostDevice.feedScope === 'root') {
            const separatorX = (rightmostDevice.x + supplyEndX) / 2
            pushSupplySegment(
              `supply-wire-segment-${panelLayout.panel.id}-supply-root`,
              rightmostDevice.x,
              separatorX,
              'root',
              0
            )
            pushSupplySegment(
              `supply-wire-segment-${panelLayout.panel.id}-supply-shared`,
              separatorX,
              supplyEndX,
              'shared',
              0
            )
          } else {
            pushSupplySegment(
              `supply-wire-segment-${panelLayout.panel.id}-supply`,
              rightmostDevice.x,
              supplyEndX,
              rightmostDevice.feedScope,
              0
            )
          }
        }
      } else if (panelLayout.supplyEndpointKind !== 'continuation') {
        const supplyEndX = supply.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        const separatorX = (bendX + supplyEndX) / 2
        pushSupplySegment(
          `supply-wire-segment-${panelLayout.panel.id}-stub-root`,
          bendX,
          separatorX,
          'root',
          0
        )
        pushSupplySegment(
          `supply-wire-segment-${panelLayout.panel.id}-stub-shared`,
          separatorX,
          supplyEndX,
          'shared',
          0
        )
      }
    } else {
      // Sub-panel / no bend metadata: single vertical hit zone at the feeder X
      const wireY = Math.min(supply.y, mainBusElement.position.y)
      const wireHeight = Math.abs(supply.y - mainBusElement.position.y)
      children.unshift({
        id: `supply-wire-${panelLayout.panel.id}`,
        type: 'wire',
        bounds: {
          x: supply.x - pad,
          y: wireY,
          width: pad * 2,
          height: wireHeight,
        },
        hitZone: {
          type: 'supplyWire',
          padding: 0,
          supplyFeedScope: 'shared',
          supplyInsertIndex: 0,
          supplyPanelId: panelLayout.panel.id,
        },
        children: [],
      })
    }
  }

  const changeoverBranches = panelLayout.supplyChangeoverBranches
  if (changeoverBranches) {
    const pad = 10
    const devices = [...(panelLayout.supplyDevices ?? [])].sort((a, b) => a.x - b.x)
    const changeover = devices.find(
      (candidate) => candidate.device.id === changeoverBranches.deviceId
    )
    const backupConverter = devices.find((candidate) => candidate.device.supplyPath === 'backup')
    const isBranchDevice = (candidate: (typeof devices)[number]) =>
      ['backup', 'backup-output', 'changeover-grid', 'converter-grid'].includes(
        candidate.device.supplyPath ?? ''
      )
    const pushLaneSegment = (
      id: string,
      x1: number,
      x2: number,
      y: number,
      insertIndex: number,
      feedScope: 'shared' | 'root',
      type:
        | 'supplyWire'
        | 'supplyBackupWire'
        | 'supplyBackupOutputWire'
        | 'supplyChangeoverGridWire' = 'supplyWire'
    ) => {
      if (x2 <= x1) return
      children.unshift({
        id,
        type: 'wire',
        bounds: { x: x1 - pad, y: y - pad, width: x2 - x1 + pad * 2, height: pad * 2 },
        hitZone: {
          type,
          padding: 0,
          supplyFeedScope: feedScope,
          supplyInsertIndex: insertIndex,
          supplyPanelId: panelLayout.panel.id,
        },
        children: [],
      })
    }

    if (changeover) {
      const outputDevices = devices.filter(
        (candidate) => candidate.x < changeover.x && !isBranchDevice(candidate)
      )
      let previousX = panelLayout.supplyBend?.x ?? changeover.x
      for (const candidate of [...outputDevices, changeover]) {
        pushLaneSegment(
          `supply-changeover-load-slot-${panelLayout.panel.id}-${candidate.device.id}`,
          previousX,
          candidate.x,
          changeoverBranches.y,
          candidate.feedIndex + 1,
          candidate.feedScope
        )
        previousX = candidate.x
      }

      const changeoverGridDevices = devices
        .filter((candidate) => candidate.device.supplyPath === 'changeover-grid')
        .sort((a, b) => a.x - b.x)
      const gridRailX = groundElement?.position.x ?? mainBusElement.position.x + 20
      previousX = gridRailX
      for (const candidate of changeoverGridDevices) {
        pushLaneSegment(
          `supply-changeover-grid-rail-slot-${panelLayout.panel.id}-${candidate.device.id}`,
          previousX,
          candidate.x,
          changeoverBranches.lowerY,
          candidate.feedIndex + 1,
          'root',
          'supplyChangeoverGridWire'
        )
        previousX = candidate.x
      }
      pushLaneSegment(
        `supply-changeover-grid-rail-slot-${panelLayout.panel.id}-append`,
        previousX,
        changeoverBranches.elbowX,
        changeoverBranches.lowerY,
        changeoverGridDevices.at(-1)?.feedIndex != null
          ? changeoverGridDevices.at(-1)!.feedIndex + 1
          : changeover.feedIndex + 1,
        'root',
        'supplyChangeoverGridWire'
      )
      const gridTapX = backupConverter?.x ?? changeoverBranches.slotEndX
      previousX = changeoverBranches.elbowX
      if (backupConverter) {
        pushLaneSegment(
          `supply-changeover-grid-slot-${panelLayout.panel.id}-tap`,
          previousX,
          gridTapX,
          changeoverBranches.lowerY,
          backupConverter.feedIndex,
          'root',
          'supplyChangeoverGridWire'
        )
        previousX = gridTapX
      }

      const gridDevices = devices.filter(
        (candidate) => candidate.x > changeover.x && !isBranchDevice(candidate)
      )
      for (const candidate of gridDevices) {
        pushLaneSegment(
          `supply-changeover-grid-slot-${panelLayout.panel.id}-${candidate.device.id}`,
          previousX,
          candidate.x,
          changeoverBranches.lowerY,
          candidate.feedIndex + 1,
          candidate.feedScope
        )
        previousX = candidate.x
      }
      pushLaneSegment(
        `supply-changeover-grid-slot-${panelLayout.panel.id}-supply`,
        previousX,
        supply.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
        changeoverBranches.lowerY,
        0,
        'shared'
      )

      const backupOutputDevices = devices
        .filter((candidate) => candidate.device.supplyPath === 'backup-output')
        .sort((a, b) => a.x - b.x)
      if (backupConverter) {
        previousX = changeoverBranches.elbowX
        for (const candidate of [...backupOutputDevices, backupConverter]) {
          pushLaneSegment(
            `supply-changeover-backup-output-slot-${panelLayout.panel.id}-${candidate.device.id}`,
            previousX,
            candidate.x,
            changeoverBranches.upperY,
            candidate.device.supplyPath === 'backup'
              ? changeover.feedIndex
              : candidate.feedIndex + 1,
            'root',
            'supplyBackupOutputWire'
          )
          previousX = candidate.x
        }

        const converterGridDevices = devices
          .filter((candidate) => candidate.device.supplyPath === 'converter-grid')
          .sort((a, b) => a.y - b.y)
        const verticalWaypoints = [
          {
            y: backupConverter.y + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
            index: backupConverter.feedIndex,
          },
          ...converterGridDevices.map((candidate) => ({
            y: candidate.y,
            index: candidate.feedIndex + 1,
          })),
          { y: changeoverBranches.lowerY, index: backupConverter.feedIndex },
        ]
        for (let index = 0; index < verticalWaypoints.length - 1; index++) {
          const from = verticalWaypoints[index]!
          const to = verticalWaypoints[index + 1]!
          if (to.y <= from.y) continue
          children.unshift({
            id: `supply-changeover-converter-grid-slot-${panelLayout.panel.id}-${index}`,
            type: 'wire',
            bounds: {
              x: backupConverter.x - pad,
              y: from.y - pad,
              width: pad * 2,
              height: to.y - from.y + pad * 2,
            },
            hitZone: {
              type: 'supplyConverterGridWire',
              padding: 0,
              supplyFeedScope: 'root',
              supplyInsertIndex: to.index,
              supplyPanelId: panelLayout.panel.id,
            },
            children: [],
          })
        }
      } else {
        previousX = changeoverBranches.elbowX
        for (const candidate of backupOutputDevices) {
          pushLaneSegment(
            `supply-changeover-backup-slot-${panelLayout.panel.id}-${candidate.device.id}`,
            previousX,
            candidate.x,
            changeoverBranches.upperY,
            candidate.feedIndex,
            'root',
            'supplyBackupOutputWire'
          )
          previousX = candidate.x
        }
        pushLaneSegment(
          `supply-changeover-backup-slot-${panelLayout.panel.id}-append`,
          previousX,
          changeoverBranches.slotEndX,
          changeoverBranches.upperY,
          backupOutputDevices.at(-1)?.feedIndex != null
            ? backupOutputDevices.at(-1)!.feedIndex + 1
            : (changeover?.feedIndex ?? 0) + 1,
          'root',
          'supplyBackupWire'
        )
      }
    }
  }

  const converterBranch = panelLayout.supplyConverterBranch
  if (converterBranch) {
    const pad = 10
    const devices = panelLayout.supplyDevices ?? []
    const converter = devices.find((candidate) => candidate.device.id === converterBranch.deviceId)
    const gridDevices = devices
      .filter((candidate) => candidate.device.supplyPath === 'converter-grid')
      .sort((a, b) => a.y - b.y)
    if (converter) {
      const backup = panelLayout.supplyConverterBackup
      if (backup && !backup.circuitId && backup.x2 > backup.x1) {
        children.unshift({
          id: `supply-direct-converter-backup-slot-${panelLayout.panel.id}`,
          type: 'wire',
          bounds: {
            x: backup.x1 - pad,
            y: backup.y - pad,
            width: backup.x2 - backup.x1 + pad * 2,
            height: pad * 2,
          },
          hitZone: {
            type: 'supplyConverterBackupWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyPanelId: panelLayout.panel.id,
          },
          children: [],
        })
      }
      const verticalWaypoints = [
        {
          y: converter.y + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
          index: converter.feedIndex,
        },
        ...gridDevices.map((candidate) => ({
          y: candidate.y,
          index: candidate.feedIndex + 1,
        })),
        { y: converterBranch.lineY, index: converter.feedIndex },
      ]
      for (let index = 0; index < verticalWaypoints.length - 1; index++) {
        const from = verticalWaypoints[index]!
        const to = verticalWaypoints[index + 1]!
        if (to.y <= from.y) continue
        children.unshift({
          id: `supply-direct-converter-grid-slot-${panelLayout.panel.id}-${index}`,
          type: 'wire',
          bounds: {
            x: converter.x - pad,
            y: from.y - pad,
            width: pad * 2,
            height: to.y - from.y + pad * 2,
          },
          hitZone: {
            type: 'supplyConverterGridWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyInsertIndex: to.index,
            supplyPanelId: panelLayout.panel.id,
          },
          children: [],
        })
      }

      const dcDevices = devices
        .filter((candidate) => candidate.device.supplyPath === 'converter-dc')
        .sort((a, b) => a.x - b.x)
      const dcTopDevices = devices
        .filter((candidate) => candidate.device.supplyPath === 'converter-dc-top')
        .sort((a, b) => a.x - b.x)
      const pushDcInsertionSegment = (
        branch: 'right' | 'top',
        segmentIndex: number,
        x1: number,
        x2: number,
        y: number,
        insertIndex: number
      ) => {
        if (x2 <= x1) return
        children.unshift({
          id: `supply-direct-converter-dc-${branch}-slot-${panelLayout.panel.id}-${segmentIndex}`,
          type: 'wire',
          bounds: {
            x: x1 - pad,
            y: y - pad,
            width: x2 - x1 + pad * 2,
            height: pad * 2,
          },
          hitZone: {
            type: 'supplyConverterDcWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyInsertIndex: insertIndex,
            supplyPanelId: panelLayout.panel.id,
            supplyConverterDcBranch: branch,
          },
          children: [],
        })
      }
      const pushDcLaneInsertionSegments = (
        branch: 'right' | 'top',
        branchDevices: typeof dcDevices,
        startX: number,
        endX: number,
        y: number
      ) => {
        let previousX = startX
        branchDevices.forEach((candidate, index) => {
          const nextX = candidate.x - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
          pushDcInsertionSegment(branch, index, previousX, nextX, y, candidate.feedIndex)
          previousX = candidate.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        })
        const appendIndex =
          branchDevices.at(-1)?.feedIndex != null
            ? branchDevices.at(-1)!.feedIndex + 1
            : converter.feedIndex + 1
        pushDcInsertionSegment(branch, branchDevices.length, previousX, endX, y, appendIndex)
      }
      pushDcLaneInsertionSegments(
        'right',
        dcDevices,
        converter.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
        converterBranch.dcEndX,
        converter.y
      )
      if ((dcDevices.length > 0 || dcTopDevices.length > 0) && converterBranch.dcTopY != null) {
        if (dcTopDevices.length === 0) {
          pushDcInsertionSegment(
            'top',
            0,
            converter.x - 1,
            converter.x + 1,
            converterBranch.dcTopY,
            converter.feedIndex + 1
          )
        } else {
          pushDcLaneInsertionSegments(
            'top',
            dcTopDevices,
            converter.x,
            converterBranch.dcTopEndX ?? converterBranch.dcEndX,
            converterBranch.dcTopY
          )
        }
      }
    }
  }

  // Add ground wire hit zone (vertical wire from main bus to ground symbol)
  // This must be added AFTER supply wire so it's checked first in hit detection
  if (groundElement && mainBusElement.position) {
    const pad = 10
    const wireY = Math.min(groundElement.position.y, mainBusElement.position.y)
    const wireHeight = Math.abs(groundElement.position.y - mainBusElement.position.y)
    children.unshift({
      id: `ground-wire-${panelLayout.panel.id}`,
      type: 'wire',
      bounds: {
        x: groundElement.position.x - pad,
        y: wireY,
        width: pad * 2,
        height: wireHeight,
      },
      hitZone: {
        type: 'groundWire',
        padding: 0,
      },
      children: [],
    })
  }

  // Add per-segment hit zones along the main bus so that hitboxes visually
  // match the segmented bus rendering in deriveWires. Segments span the gaps
  // between protections (RCD/MCB) on the main bus.
  if (mainBusElement.position) {
    const busYTop = mainBusElement.position.y
    const busThickness = mainBusElement.height || LAYOUT_CONSTANTS.BUS_THICKNESS
    const busStartX = mainBusElement.position.x
    const busEndX = busStartX + (mainBusElement.width || 0)

    const connectionXs: number[] = children
      .filter((child) => {
        if (child.type !== 'rcd' && child.type !== 'mcb') return false
        const circuit = panelLayout.circuits.find(
          (candidate) => candidate.circuit.id === child.circuitIdForWires
        )?.circuit
        return circuit?.supplySource?.kind !== 'converter-backup'
      })
      .map((child) => child.bounds.x)
      .sort((a, b) => a - b)

    const waypoints: number[] = [busStartX, ...connectionXs, busEndX]

    for (let i = 0; i < waypoints.length - 1; i++) {
      const startX = waypoints[i]!
      const endX = waypoints[i + 1]!
      if (endX <= startX) continue

      children.push({
        id: `main-bus-segment-${panelLayout.panel.id}-${i}`,
        type: 'wire',
        bounds: {
          x: startX,
          y: busYTop,
          width: endX - startX,
          height: busThickness,
        },
        visual: {
          type: 'busBar',
          thickness: LAYOUT_CONSTANTS.BUS_THICKNESS,
        },
        hitZone: {
          type: panelLayout.frameRole === 'supply' ? null : 'mainBus',
          padding: 0,
        },
        children: [],
      })
    }
  }

  return {
    id: mainBusElement.id,
    type: 'busBar',
    bounds: {
      x: mainBusElement.position.x,
      y: mainBusElement.position.y,
      width: mainBusElement.width || 0,
      height: mainBusElement.height || LAYOUT_CONSTANTS.BUS_THICKNESS,
    },
    visual: {
      type: 'busBar',
      thickness: LAYOUT_CONSTANTS.BUS_THICKNESS,
    },
    hitZone: {
      type: panelLayout.frameRole === 'supply' ? null : 'mainBus',
      padding: panelLayout.frameRole === 'supply' ? 0 : 12,
    },
    children,
  }
}

function buildRcdNode(
  panelLayout: BottomUpPanelLayout,
  rcdElement: BottomUpLayoutElement,
  circuits: BottomUpCircuitLayout[]
): LayoutNode {
  const children: LayoutNode[] = []
  const protection = panelLayout.panel.protections.find((p) => p.id === rcdElement.protectionId)

  // Find trunk for this RCD
  const trunk = panelLayout.trunks.find((t) => t.protectionId === rcdElement.protectionId)

  if (trunk) {
    // Build trunk/secondaryBus node
    const trunkElement = panelLayout.elements.find(
      (e) => e.type === 'trunk' && e.trunkId === trunk.id
    )

    if (trunkElement) {
      const trunkNode: LayoutNode = {
        id: `trunk-${trunk.id}`,
        type: 'secondaryBus',
        bounds: {
          x: trunkElement.position.x,
          y: trunkElement.position.y,
          width: trunkElement.width || 0,
          height: trunkElement.height || LAYOUT_CONSTANTS.BUS_THICKNESS,
        },
        visual: {
          type: 'busBar',
          thickness: LAYOUT_CONSTANTS.BUS_THICKNESS,
        },
        hitZone: {
          type: 'rcd',
          padding: 0,
        },
        domainId: protection?.id,
        domainRef: protection,
        children: circuits
          .map((cl) => buildMcbNode(panelLayout, cl))
          .filter((n): n is LayoutNode => n !== null),
      }
      children.push(trunkNode)
    }
  }

  return {
    id: rcdElement.id,
    type: 'rcd',
    bounds: {
      x: rcdElement.position.x,
      y: rcdElement.position.y,
      width: LAYOUT_CONSTANTS.RCD_WIDTH,
      height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
    },
    domainId: rcdElement.protectionId,
    domainRef: protection,
    visual: {
      type: 'symbol',
      symbolId: protection?.type === 'RCBO' ? 'rcbo' : 'rcd',
      label: protection?.label,
    },
    hitZone: {
      type: 'rcd',
      padding: 5,
    },
    children,
  }
}

function buildMcbNode(
  panelLayout: BottomUpPanelLayout,
  circuitLayout: BottomUpCircuitLayout
): LayoutNode | null {
  if (!circuitLayout.protection) {
    return null
  }
  const circuitProtection = circuitLayout.protection

  const subPanelSymbolElement = panelLayout.elements.find(
    (e) =>
      e.type === 'endpoint' &&
      e.id?.startsWith('subpanel-symbol-') &&
      e.circuitId === circuitLayout.circuit.id
  )

  const protectionElement =
    panelLayout.elements.find(
      (e) =>
        e.type === 'protection' &&
        e.protectionId === circuitProtection.id &&
        e.circuitId === circuitLayout.circuit.id
    ) ??
    panelLayout.elements.find(
      (e) =>
        e.type === 'protection' &&
        e.protectionId === circuitProtection.id &&
        e.id === `protection-${circuitProtection.id}-nest-${circuitLayout.circuit.id}`
    )

  if (!protectionElement) {
    if (subPanelSymbolElement) {
      const protectionId = subPanelSymbolElement.id.replace('subpanel-symbol-', '')
      const linkedProtection = panelLayout.panel.protections.find((p) => p.id === protectionId)
      const link = linkedProtection
        ? resolvePanelSupplyLinkForProtection(
            { panels: [panelLayout.panel] } satisfies ProjectWithOptionalV2Electrical,
            panelLayout.panel,
            linkedProtection
          )
        : null
      const subPanel = link?.targetPanel
      const panelEndpoint = subPanelSymbolElement.endpointId
        ? circuitLayout.circuit.endpoints.find(
            (endpoint) => endpoint.id === subPanelSymbolElement.endpointId
          )
        : undefined

      return {
        id: subPanelSymbolElement.id,
        type: 'endpoint',
        bounds: {
          x: subPanelSymbolElement.position.x,
          y: subPanelSymbolElement.position.y,
          width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
          height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        },
        domainId: panelEndpoint?.id ?? subPanel?.id,
        domainRef: panelEndpoint,
        visual: {
          type: 'symbol',
          symbolId: 'panel_distribution',
          label: subPanel?.name ?? panelEndpoint?.label ?? '',
        },
        hitZone: {
          type: null,
          padding: 5,
        },
        children: [],
      }
    }
    return null
  }

  const children: LayoutNode[] = []
  const isHorizontalConverterBackup =
    circuitLayout.circuit.supplySource?.kind === 'converter-backup'
  const trunkDeviceElements = panelLayout.elements.filter(
    (e) => e.type === 'trunkDevice' && e.circuitId === circuitLayout.circuit.id
  )

  // Circuit trunk wire (vertical from MCB up to first branch/device top) — drop on wire = circuit target.
  // Keep this in sync with deriveWires/top-of-trunk behavior so hitboxes match rendered wire length.
  const circuitBranchesForWire = panelLayout.branches.filter(
    (b) => b.circuitId === circuitLayout.circuit.id
  )
  const baseWidth = Math.max(LAYOUT_CONSTANTS.PROTECTION_WIDTH, LAYOUT_CONSTANTS.SYMBOL_SIZE)
  const protectionAnchorX = circuitLayout.x + circuitLayout.leftReserve + baseWidth / 2
  const wireX = circuitBranchesForWire[0]?.trunkX ?? protectionAnchorX
  // Use actual MCB element position (not circuitLayout.protectionY which is wrong for nested circuits)
  const mcbActualY = protectionElement.position.y
  const topBranchY =
    circuitBranchesForWire.length > 0
      ? Math.min(...circuitBranchesForWire.map((b) => b.branchY))
      : mcbActualY - LAYOUT_CONSTANTS.BRANCH_START_OFFSET
  const sortedTrunkDeviceElements = [...trunkDeviceElements].sort(
    (a, b) => b.position.y - a.position.y
  ) // bottom -> top
  const topTrunkDeviceY =
    sortedTrunkDeviceElements.length > 0
      ? (sortedTrunkDeviceElements[sortedTrunkDeviceElements.length - 1]?.position.y ?? null)
      : null
  const topCandidates = [topBranchY, topTrunkDeviceY].filter((y): y is number => y !== null)
  const topmostContentY =
    topCandidates.length > 0
      ? Math.min(...topCandidates)
      : mcbActualY - LAYOUT_CONSTANTS.BRANCH_START_OFFSET
  let topWireY =
    topTrunkDeviceY !== null && topTrunkDeviceY === topmostContentY
      ? topmostContentY - LAYOUT_CONSTANTS.BRANCH_START_OFFSET
      : topmostContentY
  // Only when parent has both endpoints and subcircuits: extend wire to secondary bus above endpoints
  const hasEndpointBranches = circuitBranchesForWire.some((b) => b.endpoints.length > 0)
  if (
    hasEndpointBranches &&
    circuitLayout.secondaryBusY != null &&
    (circuitLayout.circuit.subCircuitIds?.length ?? 0) > 0
  ) {
    topWireY = Math.min(topWireY, circuitLayout.secondaryBusY)
  }
  const wirePad = 10
  // Build one hit zone per visible trunk segment so drop targeting aligns with rendered wire pieces.
  const trunkWaypointsY = [
    mcbActualY,
    ...sortedTrunkDeviceElements.map((td) => td.position.y),
    topWireY,
  ]
  if (isHorizontalConverterBackup) {
    if (subPanelSymbolElement) {
      const panelX = subPanelSymbolElement.position.x
      const left = Math.min(panelX, protectionElement.position.x)
      const right = Math.max(panelX, protectionElement.position.x)
      children.push({
        id: `circuit-trunk-${circuitLayout.circuit.id}-horizontal`,
        type: 'wire',
        bounds: {
          x: left,
          y: protectionElement.position.y - wirePad,
          width: right - left,
          height: wirePad * 2,
        },
        hitZone: {
          type: 'circuit',
          padding: 0,
        },
        children: [],
      })
    }
  } else {
    for (let i = 0; i < trunkWaypointsY.length - 1; i++) {
      const startY = trunkWaypointsY[i]
      const endY = trunkWaypointsY[i + 1]
      if (startY == null || endY == null) continue
      const segmentTopY = Math.min(startY, endY)
      const segmentHeight = Math.abs(startY - endY)
      if (segmentHeight <= 0) continue
      children.push({
        id: `circuit-trunk-${circuitLayout.circuit.id}-segment-${i}`,
        type: 'wire',
        bounds: {
          x: wireX - wirePad,
          y: segmentTopY,
          width: wirePad * 2,
          height: segmentHeight,
        },
        hitZone: {
          type: 'circuit',
          padding: 0,
        },
        children: [],
      })
    }

    // Single nest slot at the top of the trunk (nested MCB / secondary-bus insertion).
    // Trunk segment hit zones remain for trunk devices; this zone is prioritized for protection drops.
    const nestZoneHeight = 40
    children.push({
      id: `circuit-nest-${circuitLayout.circuit.id}`,
      type: 'wire',
      bounds: {
        x: wireX - wirePad,
        y: topWireY - nestZoneHeight / 2,
        width: wirePad * 2,
        height: nestZoneHeight,
      },
      hitZone: {
        type: 'circuit',
        padding: 10,
      },
      children: [],
    })
  }

  // Add circuit label (exclude circuit-notes, they're handled separately)
  const labelElement = panelLayout.elements.find(
    (e) =>
      e.type === 'label' &&
      e.circuitId === circuitLayout.circuit.id &&
      !e.branchId &&
      !e.id?.startsWith('circuit-notes-')
  )
  const circuitLetterVisibleOnOneWire = circuitLayout.circuit.eendraadLetterVisible !== false
  if (labelElement && circuitLetterVisibleOnOneWire) {
    const isProtectionLabel = !!circuitLayout.protection
    const labelWidth = isProtectionLabel
      ? Math.max(
          PROTECTION_LABEL_DEFAULT_BOX_WIDTH,
          estimateProtectionNameLabelWidth(labelElement.label)
        )
      : 100
    children.push({
      id: labelElement.id,
      type: 'label',
      bounds: {
        x: labelElement.position.x,
        y: labelElement.position.y,
        width: labelWidth,
        height: 20,
      },
      visual: {
        type: 'label',
        text: labelElement.label || circuitLayout.circuit.code,
        fontSize: 12,
        align: isHorizontalConverterBackup ? 'center' : isProtectionLabel ? 'right' : 'center',
      },
      children: [],
    })
  }

  // Add circuit notes (if any) — use dedicated panelLayout.circuitNotes (single source of truth).
  const circuitNotes = panelLayout.circuitNotes?.find(
    (n) => n.circuitId === circuitLayout.circuit.id
  )
  if (circuitNotes && (circuitNotes.label ?? '').trim() && circuitNotes.notesVisible !== false) {
    const orientation = circuitNotes.notesOrientation ?? 'horizontal'
    const isVertical = orientation === 'vertical'
    const notesVisible = true

    children.push({
      id: `circuit-notes-${circuitLayout.circuit.id}`,
      type: 'label',
      bounds: {
        x: circuitNotes.x,
        y: circuitNotes.y,
        width: isVertical ? 80 : 200,
        height: isVertical ? 200 : 20,
      },
      visual: {
        type: 'label',
        text: circuitNotes.label || '',
        fontSize: 10,
        variant: 'circuit-notes',
        notesOrientation: orientation,
        notesVisible,
      },
      children: [],
    })
  }

  // Check if this circuit connects to a sub-panel (panel symbol goes directly on MCB, not on a branch)
  if (subPanelSymbolElement) {
    // Sub-panel symbol: add directly as child of MCB (no branch needed)
    const protectionId = subPanelSymbolElement.id.replace('subpanel-symbol-', '')
    const linkedProtection = panelLayout.panel.protections.find((p) => p.id === protectionId)
    const link = linkedProtection
      ? resolvePanelSupplyLinkForProtection(
          { panels: [panelLayout.panel] } satisfies ProjectWithOptionalV2Electrical,
          panelLayout.panel,
          linkedProtection
        )
      : null
    const subPanel = link?.targetPanel

    children.push({
      id: subPanelSymbolElement.id,
      type: 'endpoint',
      bounds: {
        x: subPanelSymbolElement.position.x,
        y: subPanelSymbolElement.position.y,
        width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
      },
      domainId: subPanelSymbolElement.endpointId ?? subPanel?.id,
      domainRef: subPanelSymbolElement.endpointId
        ? circuitLayout.circuit.endpoints.find(
            (endpoint) => endpoint.id === subPanelSymbolElement.endpointId
          )
        : undefined,
      visual: {
        type: 'symbol',
        symbolId: 'panel_distribution',
        label: subPanel?.name ?? '',
      },
      hitZone: {
        type: null,
        padding: 5,
      },
      children: [],
    })
  }

  // Add branches for this circuit (skip branches that only exist for sub-panel wiring)
  const circuitBranches = panelLayout.branches.filter(
    (b) => b.circuitId === circuitLayout.circuit.id
  )
  for (const branch of circuitBranches) {
    // Skip empty branches for sub-panel circuits (the vertical wire is handled via the MCB → panel symbol)
    if (subPanelSymbolElement && branch.endpoints.length === 0) {
      continue
    }
    const branchNode = buildBranchNode(panelLayout, branch, circuitLayout.circuit.id)
    if (branchNode) {
      children.push(branchNode)
    }
  }

  // Add trunk device nodes (energy meters etc. on the vertical wire)
  for (const tdElement of trunkDeviceElements) {
    const trunkDevice = circuitLayout.circuit.trunkDevices?.find(
      (d) => d.id === tdElement.trunkDeviceId
    )
    if (trunkDevice) {
      children.push({
        id: tdElement.id,
        type: 'trunkDevice',
        bounds: {
          x: tdElement.position.x,
          y: tdElement.position.y,
          width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
          height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        },
        domainId: trunkDevice.id,
        domainRef: trunkDevice,
        visual: {
          type: 'symbol',
          symbolId: trunkDevice.symbol || 'energy_meter',
          label: trunkDevice.label,
        },
        hitZone: {
          type: 'circuit', // Clicking a trunk device targets the circuit
          // Larger padding so trunk devices (energy conversion, meters) are easy to click.
          padding: 10,
        },
        children: [],
      })
    }
  }

  // Only when circuit has both endpoint branches and subcircuits: add node at secondary bus Y so
  // deriveWires extends the vertical wire above endpoints (avoids overlap; no change when subcircuits only).
  const hasEndpointBranchesForWireEnd = circuitBranchesForWire.some((b) => b.endpoints.length > 0)
  if (
    hasEndpointBranchesForWireEnd &&
    circuitLayout.secondaryBusY != null &&
    (circuitLayout.circuit.subCircuitIds?.length ?? 0) > 0
  ) {
    children.push({
      id: `parent-wire-end-${circuitLayout.circuit.id}`,
      type: 'secondaryBus',
      bounds: {
        x: wireX,
        y: circuitLayout.secondaryBusY,
        width: 0,
        height: 0,
      },
      hitZone: { type: null, padding: 0 },
      children: [],
    })
  }

  // Add nested circuits (sub-circuits) — look up by ID, not duplicated objects
  if (circuitLayout.circuit.subCircuitIds && circuitLayout.circuit.subCircuitIds.length > 0) {
    // When there are multiple nested circuits, create a secondary bus node for them.
    // Use the subCircuitIds list itself to find their layouts, so this works even
    // when parentCircuit metadata is missing or not set.
    const nestedLayouts = circuitLayout.circuit.subCircuitIds
      .map((nestedId) => panelLayout.circuits.find((cl) => cl.circuit.id === nestedId))
      .filter((cl): cl is (typeof panelLayout.circuits)[number] => cl !== undefined)

    if (nestedLayouts.length > 1) {
      const baseWidth = Math.max(LAYOUT_CONSTANTS.PROTECTION_WIDTH, LAYOUT_CONSTANTS.SYMBOL_SIZE)
      const nestedXs = nestedLayouts.map((cl) => {
        const protEl =
          panelLayout.elements.find(
            (e) =>
              e.type === 'protection' &&
              e.protectionId === cl.protection?.id &&
              e.circuitId === cl.circuit.id
          ) ??
          (cl.protection
            ? panelLayout.elements.find(
                (e) =>
                  e.type === 'protection' &&
                  e.protectionId === cl.protection!.id &&
                  e.id === `protection-${cl.protection!.id}-nest-${cl.circuit.id}`
              )
            : undefined)
        return protEl ? protEl.position.x : cl.x + cl.leftReserve + baseWidth / 2
      })

      if (nestedXs.length > 0) {
        const secondaryBusAttachmentXs =
          hasPanelAttachmentOnSecondaryBus(circuitLayout.protection, circuitLayout.circuit) &&
          subPanelSymbolElement
            ? [subPanelSymbolElement.position.x, ...nestedXs]
            : nestedXs
        const leftmostX = Math.min(...secondaryBusAttachmentXs)
        const rightmostX = Math.max(...secondaryBusAttachmentXs)
        const extension = LAYOUT_CONSTANTS.SECONDARY_BUS_EXTENSION
        const busStartX = leftmostX - extension
        const busEndX = rightmostX + extension

        const busThickness = LAYOUT_CONSTANTS.BUS_THICKNESS
        const busYTop = topWireY - busThickness / 2

        // Build per-segment hit zones for the secondary bus so they align with
        // the segmented bus rendering in deriveWires.
        const busWaypoints: number[] = [
          busStartX,
          ...[...secondaryBusAttachmentXs].sort((a, b) => a - b),
          busEndX,
        ]
        const secondaryBusSegments: LayoutNode[] = []
        for (let i = 0; i < busWaypoints.length - 1; i++) {
          const startX = busWaypoints[i]!
          const endX = busWaypoints[i + 1]!
          if (endX <= startX) continue

          secondaryBusSegments.push({
            id: `secondary-bus-segment-${circuitLayout.circuit.id}-${i}`,
            type: 'wire',
            bounds: {
              x: startX,
              // Core hitbox exactly matches the visual bus segment thickness.
              y: busYTop,
              width: endX - startX,
              height: busThickness,
            },
            visual: {
              type: 'busBar',
              thickness: LAYOUT_CONSTANTS.BUS_THICKNESS,
            },
            hitZone: {
              type: 'circuit',
              // Per-segment safety margin around the visual core, rendered as
              // the dashed outline in hitbox debug (like other hit zones).
              padding: 20,
            },
            children: [],
          })
        }

        const secondaryBusNode: LayoutNode = {
          id: `secondary-bus-${circuitLayout.circuit.id}`,
          type: 'secondaryBus',
          bounds: {
            x: busStartX,
            // Align hitbox so that the bus wire (at topWireY) runs through
            // the vertical CENTER of the rectangle, mirroring the main bus.
            y: topWireY - busThickness / 2,
            width: busEndX - busStartX,
            height: busThickness,
          },
          visual: {
            type: 'busBar',
            thickness: LAYOUT_CONSTANTS.BUS_THICKNESS,
          },
          hitZone: {
            // Parent secondaryBus node is just a container; per-segment wire
            // children carry the actual hit zones so padding is applied per
            // segment instead of one big padded box.
            type: null,
            padding: 0,
          },
          // Child wire segments model the individual visual bus sections.
          // Store nested child X positions as metadata for insertion logic.
          children: secondaryBusSegments,
          nestedChildXs: nestedXs,
        }

        children.push(secondaryBusNode)
      }
    }

    for (const nestedId of circuitLayout.circuit.subCircuitIds) {
      const nestedLayout = panelLayout.circuits.find((cl) => cl.circuit.id === nestedId)
      if (!nestedLayout) continue

      const mergeNestedFeederOntoParentMcb =
        !!nestedLayout.protection &&
        !!circuitLayout.protection &&
        nestedLayout.protection.id === circuitLayout.protection.id &&
        (circuitLayout.circuit.subCircuitIds?.length ?? 0) === 1 &&
        isPanelOnlySubPanelFeeder(nestedLayout.protection, nestedLayout.circuit)

      if (mergeNestedFeederOntoParentMcb) {
        const nestedMcb = buildMcbNode(panelLayout, nestedLayout)
        if (nestedMcb && nestedMcb.type === 'mcb' && nestedMcb.children.length > 0) {
          for (const c of nestedMcb.children) {
            if (c.type === 'endpoint' && c.visual?.type === 'symbol') {
              children.push(c)
            }
          }
        }
        continue
      }

      const nestedMcb = buildMcbNode(panelLayout, nestedLayout)
      if (nestedMcb) {
        children.push(nestedMcb)
      }
    }
  }

  // Resolve symbol ID from protection type
  const protectionSymbolId = protectionTypeToSymbolId(circuitLayout.protection.type)

  return {
    id: protectionElement.id,
    type: 'mcb',
    bounds: {
      x: protectionElement.position.x,
      y: protectionElement.position.y,
      width: LAYOUT_CONSTANTS.PROTECTION_WIDTH,
      height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
    },
    domainId: circuitLayout.protection.id,
    domainRef: circuitLayout.protection,
    circuitIdForWires: circuitLayout.circuit.id,
    visual: {
      type: 'symbol',
      symbolId: protectionSymbolId,
      label: circuitLayout.protection.label,
    },
    hitZone: {
      type: 'protection',
      padding: 5,
    },
    children,
  }
}

function buildBranchNode(
  panelLayout: BottomUpPanelLayout,
  branch: BranchLayout,
  circuitId: string
): LayoutNode | null {
  const children: LayoutNode[] = []
  const circuitLayout = panelLayout.circuits.find((candidate) => candidate.circuit.id === circuitId)
  const constrainSingleEndpointLabel =
    branch.endpoints.length === 1 && branch.endpoints[0]?.type !== 'switch'

  // Find branch visual element
  const branchElement = panelLayout.elements.find(
    (e) => e.type === 'branch' && e.branchId === branch.id
  )

  if (!branchElement) {
    return null
  }

  // Add endpoints on this branch
  for (const [endpointIndex, endpoint] of branch.endpoints.entries()) {
    const endpointElement = panelLayout.elements.find(
      (e) => e.type === 'endpoint' && e.endpointId === endpoint.id
    )

    if (endpointElement) {
      const isDomoticaParent = endpoint.symbol === 'domotica' && !endpoint.domoticaChildProps
      const domoticaEndpointCount = isDomoticaParent
        ? Math.max(
            DOMOTICA_MIN_ENDPOINT_OUTPUTS,
            Math.min(
              DOMOTICA_MAX_ENDPOINT_OUTPUTS,
              Math.trunc(endpoint.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS)
            )
          )
        : DOMOTICA_MIN_ENDPOINT_OUTPUTS
      const domoticaHeight =
        DOMOTICA_BASE_HEIGHT + Math.max(0, domoticaEndpointCount - 1) * DOMOTICA_OUTPUT_SPACING

      // Domotica box is drawn with center at position (EndpointSymbol: x = position.x - BOX_WIDTH/2)
      children.push({
        id: endpointElement.id,
        type: 'endpoint',
        bounds: {
          x: endpointElement.position.x,
          y: isDomoticaParent
            ? endpointElement.position.y - domoticaHeight / 2 + DOMOTICA_BASE_HEIGHT / 2
            : endpointElement.position.y,
          width: isDomoticaParent ? DOMOTICA_BOX_WIDTH : LAYOUT_CONSTANTS.SYMBOL_SIZE,
          height: isDomoticaParent ? domoticaHeight : LAYOUT_CONSTANTS.SYMBOL_SIZE,
        },
        domainId: endpoint.id,
        domainRef: endpoint,
        visual: {
          type: 'symbol',
          symbolId: endpoint.symbol || getDefaultSymbolForEndpointType(endpoint.type),
          label: endpoint.label,
          isEndpointAtBranchEnd: endpointIndex === branch.endpoints.length - 1,
          mirrorHorizontally: endpointElement.mirrorEndpointHorizontally,
          bottomLabelMinimumLeftX: constrainSingleEndpointLabel
            ? getEndpointNoteMinimumLeftX(endpointElement.position.x, branch.branchX)
            : undefined,
          bottomLabelMaximumRightX:
            constrainSingleEndpointLabel && circuitLayout
              ? getEndpointNoteMaximumRightX(
                  endpointElement.position.x,
                  circuitLayout.x + circuitLayout.width
                )
              : undefined,
        },
        hitZone: isDomoticaParent
          ? {
              // Domotica parent hitbox = just its box; wires have their own separate hit zones.
              type: 'endpoint',
              padding: 4,
            }
          : {
              type: 'endpoint',
              // Generous padding for regular endpoints so dropping ON the socket (and nearby) reliably targets it.
              padding: 15,
            },
        children: [],
      })

      // Domotica child endpoints: label to the right of the symbol (A1.1, A1.2, …)
      const isDomoticaChild = !!endpoint.domoticaChildProps
      if (isDomoticaChild && endpoint.label) {
        const ref = endpoint.domoticaChildProps!
        const rowEndpoints = branch.endpoints.filter(
          (ep) =>
            ep.domoticaChildProps?.parentEndpointId === ref.parentEndpointId &&
            ep.domoticaChildProps.outputGroup === ref.outputGroup &&
            ep.domoticaChildProps.outputIndex === ref.outputIndex
        )
        const rightmostEndpoint = rowEndpoints.reduce<Endpoint | null>((rightmost, candidate) => {
          const candidateElement = panelLayout.elements.find(
            (element) => element.type === 'endpoint' && element.endpointId === candidate.id
          )
          const rightmostElement = rightmost
            ? panelLayout.elements.find(
                (element) => element.type === 'endpoint' && element.endpointId === rightmost.id
              )
            : null
          if (!candidateElement) return rightmost
          if (!rightmostElement || candidateElement.position.x > rightmostElement.position.x) {
            return candidate
          }
          return rightmost
        }, null)

        if (rightmostEndpoint?.id === endpoint.id) {
          const labelX = endpointElement.position.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 + 8
          children.push({
            id: `${endpointElement.id}-label`,
            type: 'label',
            bounds: {
              x: labelX,
              y: endpointElement.position.y,
              width: 80,
              height: 20,
            },
            visual: {
              type: 'label',
              text: endpoint.label,
              align: 'left',
            },
            children: [],
          })
        }
      }

      if (isDomoticaParent) {
        // Match deriveWires: variable part only (no BASE_HEIGHT) for output Y positioning
        const domoticaVariableHeight =
          Math.max(0, domoticaEndpointCount - 1) * DOMOTICA_OUTPUT_SPACING
        // Box center = position.x (EndpointSymbol draws box centered at position)
        const boxRightX = endpointElement.position.x + DOMOTICA_BOX_WIDTH / 2

        // Same as deriveWires: firstOutputY = branchY - domoticaVariableHeight
        const firstOutputY = endpointElement.position.y - domoticaVariableHeight
        for (let index = 0; index < domoticaEndpointCount; index++) {
          const outputY = firstOutputY + index * DOMOTICA_OUTPUT_SPACING
          // Hit zone overlaps box right edge and extends right along the wire for reliable drop detection
          const zoneWidth = DOMOTICA_BRANCH_LEAD + 30
          children.push({
            id: `${endpointElement.id}-domotica-endpoint-output-${index}`,
            type: 'wire',
            bounds: {
              x: boxRightX,
              y: outputY - 7.5,
              width: zoneWidth,
              height: 15,
            },
            domainId: endpoint.id,
            domainRef: endpoint,
            hitZone: {
              type: 'endpoint',
              padding: 14,
              outputGroup: 'endpoint',
              outputIndex: index,
            },
            children: [],
          })
        }

        const endpointSlots = endpoint.domoticaProps?.endpointChildEndpointIds ?? []
        const currentSlotsAreFull = Array.from({ length: domoticaEndpointCount }).every(
          (_, index) => {
            const childId = endpointSlots[index]
            return typeof childId === 'string' && childId.trim().length > 0
          }
        )
        if (currentSlotsAreFull && domoticaEndpointCount < DOMOTICA_MAX_ENDPOINT_OUTPUTS) {
          children.push({
            id: `${endpointElement.id}-domotica-endpoint-output-expand`,
            type: 'wire',
            bounds: {
              x: boxRightX,
              y: endpointElement.position.y + DOMOTICA_OUTPUT_SPACING / 2 - 10,
              width: DOMOTICA_BRANCH_LEAD + 18,
              height: 20,
            },
            domainId: endpoint.id,
            domainRef: endpoint,
            hitZone: {
              type: 'endpoint',
              padding: 12,
              outputGroup: 'endpoint',
              outputIndex: domoticaEndpointCount,
              outputExpands: true,
            },
            children: [],
          })
        }
      }
    }
  }

  // Note: sub-panel symbols are handled in buildMcbNode (directly on MCB, not on a branch)

  // Add branch label
  const branchLabelElement = panelLayout.elements.find(
    (e) => e.type === 'label' && e.branchId === branch.id
  )
  if (branchLabelElement) {
    children.push({
      id: branchLabelElement.id,
      type: 'label',
      bounds: {
        x: branchLabelElement.position.x,
        y: branchLabelElement.position.y,
        width: 100,
        height: 20,
      },
      visual: {
        type: 'label',
        text: branchLabelElement.label || '',
        fontSize: 12,
        // Right-align branch labels so the right edge of the text box
        // sits at the layout-provided X (offset from trunk wire).
        align: 'right',
      },
      children: [],
    })
  }

  // Bounds include full horizontal wire: from trunk to end of branch (so drop on wire = circuit)
  const pad = 10
  const wireLeft = Math.min(branch.trunkX, branch.branchX)
  const wireRight = branch.branchX + branch.branchWidth
  const wireTop = branch.branchY - pad
  const wireHeight = pad * 2

  return {
    id: branchElement.id,
    type: 'branch',
    bounds: {
      x: wireLeft,
      y: wireTop,
      width: wireRight - wireLeft,
      height: wireHeight,
    },
    domainId: branch.id,
    hitZone: {
      type: 'circuit',
      padding: 0,
    },
    children,
  }
}

function getDefaultSymbolForEndpointType(type: string): string {
  switch (type) {
    case 'socket':
      return 'socket_gnd_child'
    case 'light_point':
      return 'light_point'
    case 'switch':
      return 'switch'
    case 'fixed_appliance':
      return 'fixed_appliance_generic'
    case 'domotica':
      return 'domotica'
    default:
      return 'light_point'
  }
}
