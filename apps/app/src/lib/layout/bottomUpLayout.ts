import { logger } from '@/lib/logger'
/**
 * Bottom-Up Eendraad Layout Engine
 *
 * Implements automatic bottom-up layout for single-line electrical diagrams.
 * Layout flows from supply (bottom) upward to endpoints (top).
 */

import type { Circuit, ProtectionDevice, Panel, Installation, TrunkDevice } from '@/types/schema'
import type { Point } from '@/types/ui'
import { getCircuitBranches } from './endpointChains'
import type { TrunkLayout, BranchLayout } from './wireSegments'
import {
  DOMOTICA_BASE_HEIGHT,
  DOMOTICA_BRANCH_LEAD,
  DOMOTICA_BOX_WIDTH,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_OUTPUT_SPACING,
} from '@/components/canvas/eendraad/canvasSymbols'
import {
  getInfoBlockMinFrameSize,
  INFO_BLOCK_HEIGHT,
  INFO_BLOCK_TOTAL_WIDTH,
  INFO_BLOCK_FRAME_MARGIN,
} from '@/lib/infoBlockLayout'
import { ensureInstallationFeedTopology, getPanelFeedProjection } from '@/lib/feedTopology'
import {
  type PanelSupplyLink,
  resolvePanelSupplyLinkForPanel,
  resolvePanelSupplyLinksForSourcePanel,
} from '@/lib/eendraad/panelSupplyLink'
import {
  getProtectionOneWireLabelLines,
  getVisibleProtectionLabelLines,
} from '@/lib/protectionLabels'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { getVisibleConversionLabelParts } from '@/lib/conversionLabels'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'
import { countSymbolLabelVisualLines } from '@/lib/symbolLabelMetrics'
import { shouldUseSupplyMetadataCallout } from '@/lib/supplyMetadataCallout'
import { getSupplyDeviceMultiplier } from '@/utils/inverterMultipliers'
import { getPanelFrameTitlePadding } from '@/lib/panel/panelDiagramLabels'
import { hasExplicitPanelBusSections } from '@/lib/panel/panelBusSections'
import { collectCircuits } from '@/lib/panel/panelTree'
import { clamp } from '@/lib/geometry'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import {
  calculateBranchLayoutPass,
  getBranchProtectionAnchorOffset,
  type BranchPassConstants,
} from './bottomUpBranchPass'
import {
  calculateBranchWidth,
  getDomoticaRowChainIndex,
  getEndpointXOffsets,
} from './bottomUpBranchWidths'

// Layout constants (bottom-up, but Y increases DOWNWARD on screen)
// Supply is at bottom (high Y), everything grows UP (lower Y values)
export const LAYOUT_CONSTANTS = {
  // Vertical spacing (from bottom, supply has high Y, going UP means decreasing Y)
  SUPPLY_Y: 800, // Supply at bottom (high Y value)
  MAIN_BUS_Y: 700, // Main bus above supply (lower Y)
  MCB_Y_OFFSET: 25, // MCB sits on vertical branch slightly up from main bus (going UP = subtract)
  PROTECTION_Y: 700, // Base Y for MCB calculation (will be mainBusY - MCB_Y_OFFSET)
  RCD_VERTICAL_OFFSET: 50, // Vertical distance from main bus to RCD symbol (going UP = subtract)
  RCD_TRUNK_OFFSET: 100, // Vertical distance from main bus to RCD trunk (above RCD, going UP = subtract)
  TRUNK_Y_SPACING: 120, // Spacing between trunk levels (going UP = subtract)
  BRANCH_START_OFFSET: 80, // Vertical spacing from MCB to first endpoint branch (going UP = subtract) - DOUBLED
  ENDPOINT_BRANCH_SPACING: 50, // Vertical spacing between endpoint horizontal branches (going UP = subtract)

  // Horizontal spacing — main bus cheat sheet (top-level circuits in a row):
  //
  //   nextCircuit.x = previousCircuit.x + previousCircuit.width + gap
  //
  //   width ≈ max(CIRCUIT_MIN_WIDTH, PROTECTION_WIDTH + maxBranchWidth + CIRCUIT_PADDING)
  //   (nested circuits on a secondary bus use + CIRCUIT_PADDING * 2; parents with several nested
  //   children use a wider formula — see calculateBottomUpPanelLayout.)
  //
  //   maxBranchWidth = widest single endpoint branch (stacked branches do not add horizontally).
  //   Tune with BRANCH_LEAD_IN, ENDPOINT_HORIZONTAL_SPACING, APPLIANCE_AFTER_SOCKET_GAP, MULTI_SOCKET_OFFSET.
  //
  //   gap = CIRCUIT_SPACING if the circuit has any endpoints (incl. fixed_appliance), else
  //   CIRCUIT_SPACING_NO_ENDPOINTS. Parent with multiple nested subcircuits: GAP_AFTER_SECONDARY_BUS.
  //
  // CIRCUIT_SPACING only changes the narrow gap between columns; most whitespace is usually padding
  // + branch + protection labels.
  LEFT_MARGIN: 30,
  /** Gap between [end of top-level circuit N] and [start of top-level circuit N+1] on the main bus. */
  CIRCUIT_SPACING: 0,
  /** Same as CIRCUIT_SPACING but when the circuit has no endpoints (slightly tighter). */
  CIRCUIT_SPACING_NO_ENDPOINTS: 0,
  /** Margin: (1) left/right inside a circuit, (2) between nested circuits on secondary bus (A→B), (3) after last nested (B→parent right edge). */
  CIRCUIT_PADDING: 40,
  /** Same as CIRCUIT_PADDING but when the relevant circuit has no endpoints (tighter). */
  CIRCUIT_PADDING_NO_ENDPOINTS: 7,
  /** Extra gap between [parent's right edge] and [next main-bus circuit C]. Parent width already includes lastGap; use 0 to avoid double padding. */
  GAP_AFTER_SECONDARY_BUS: 0,
  /**
   * Floor for top-level main-bus circuit column width (applied before advancing `currentX`).
   * Nested secondary-bus columns do not use this floor.
   */
  CIRCUIT_MIN_WIDTH: 40,
  TRUNK_PADDING: 20,
  BRANCH_LEAD_IN: 20, // Space before first endpoint on branch (was 80, now 1/4)
  ENDPOINT_HORIZONTAL_SPACING: 30, // Between endpoints on same branch
  /** Extra gap between socket and fixed appliance (0 = same spacing as between switch and socket) */
  APPLIANCE_AFTER_SOCKET_GAP: 0,
  HORIZONTAL_BRANCH_LENGTH: 20, // Fallback / min width for empty circuits (kept for layout width)
  SUPPLY_LEFT_OFFSET: 30, // Offset from left edge of main bus for supply symbol
  // Empty inline grid/backup rails need enough title clearance that their
  // selectable padding does not compete with the panel heading.
  INLINE_EMPTY_SPLIT_RAIL_DROP: 18,
  SUPPLY_MAX_OFFSET: 150, // Maximum distance from left edge of main bus

  // Element dimensions
  SYMBOL_SIZE: 30,
  PROTECTION_WIDTH: 60,
  RCD_WIDTH: 60,
  BUS_THICKNESS: 5, // Thick line for main bus and trunks
  SECONDARY_BUS_EXTENSION: 15, // Extension left and right for secondary bus bars (wider start/end pads)
  /** Dedicated first column for a panel that shares a secondary bus with nested protections. */
  SECONDARY_BUS_PANEL_COLUMN_WIDTH: 70,
  /** Extra vertical clearance above nested protections for a panel on the same secondary bus. */
  SECONDARY_BUS_PANEL_VERTICAL_OFFSET: 110,
  /** Feeder length from a nested, panel-only protection to its panel symbol. */
  NESTED_PANEL_FEEDER_VERTICAL_OFFSET: 110,
  /** Vertical gap between last endpoint branch and secondary bus when circuit has both endpoints and subcircuits */
  SECONDARY_BUS_ABOVE_ENDPOINTS_GAP: 50,
  BRANCH_LINE_WIDTH: 2, // Thin line for branches
  MIN_MAIN_BUS_WIDTH: 60, // Minimum main bus width when panel has no circuits

  // Endpoint chain layout
  LABEL_OFFSET: 20, // Offset for branch labels (to the left)

  // Trunk devices (energy meters etc. on vertical wire)
  TRUNK_DEVICE_SPACING: 30, // Extra vertical space added for each trunk device on the vertical wire
  TRUNK_DEVICE_MCB_GAP: 70, // Distance from MCB center to trunk device center (was BRANCH_START_OFFSET/2 = 40)

  // Supply wire layout (main panel only)
  SUPPLY_VERTICAL_DROP: 60, // Vertical drop from main bus before bending right
  SUPPLY_DEVICE_SPACING: 60, // Horizontal spacing between devices on the supply wire (+20% vs branch spacing for readability)
  // A direct backup protection needs a wider converter-side span so the W03
  // cable label and its route glyphs fit without crowding either symbol.
  SUPPLY_DIRECT_CONVERTER_PROTECTION_SPACING: 80,
  // The switched inverter lanes carry phase, cable and device metadata on both
  // sides of the converter, so keep the changeover rectangle deliberately open.
  SUPPLY_CHANGEOVER_LANE_OFFSET: 66,
  SUPPLY_CHANGEOVER_RENDER_SIZE: 20,
  SUPPLY_CHANGEOVER_ELBOW_LEAD: 18,
  SUPPLY_CHANGEOVER_SLOT_LENGTH: 68,
  SUPPLY_CHANGEOVER_BRANCH_DEVICE_SPACING: 66,
  // Reserve a clean span for an enclosure-boundary marker and the adjacent
  // wire label between the selector and its first load-side device.
  SUPPLY_CHANGEOVER_LOAD_BOUNDARY_CLEARANCE: 30,
  SUPPLY_CHANGEOVER_GRID_SOURCE_LEAD: 24,
  SUPPLY_CHANGEOVER_VERTICAL_EXPANSION: 22,
  // Give the direct inverter input lane enough vertical room for protection
  // labels and inline modular devices around the converter.
  SUPPLY_DIRECT_CONVERTER_OFFSET: 91,
  // Keep the direct backup branch clear of the main-bus supply drop. This is
  // intentionally wider than one normal supply-device step because endpoint
  // symbols and protection labels also occupy the left side of this lane.
  SUPPLY_DIRECT_CONVERTER_BACKUP_LEFT_CLEARANCE: 90,
  // DC branches need room for wire labels plus inverter/battery/solar metadata.
  // This also doubles the rise before the upper solar branch turns right.
  SUPPLY_CONVERTER_DC_SLOT_LENGTH: 90,
  // Only the first DC device needs the expanded clearance from the inverter.
  // Devices after it keep the normal one-wire spacing.
  SUPPLY_CONVERTER_DC_DEVICE_SPACING: 45,
} as const

function getSupplyConverterDcDeviceOffset(index: number): number {
  return (
    LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH +
    index * LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_DEVICE_SPACING
  )
}

const SUPPLY_TOP_LABEL_FONT_SIZE = 8
const SUPPLY_TOP_LABEL_LINE_SPACING = 2
const SUPPLY_TOP_LABEL_OFFSET_FROM_SYMBOL = 5
const SUPPLY_FRAME_TOP_CONTENT_GAP = 14
// Keep detached converter frames anchored while their optional upper DC lane is
// populated or emptied. Four lines covers the normal certification stack plus notes.
const SUPPLY_STABLE_TOP_LABEL_LINE_RESERVE = 4
const SUPPLY_METADATA_CALLOUT_DEVICE_TOP_EXTRA = 25
const SUPPLY_METADATA_CALLOUT_INVERTER_TOP_EXTRA = 37

function getSupplyMetadataCalloutLines(device: TrunkDevice): string[] {
  const certificationParts = getVisibleCertificationLabelParts(device)
  const conversionParts =
    device.type === 'conversion' || device.symbol === 'solar_panel' || device.symbol === 'battery'
      ? getVisibleConversionLabelParts(device)
      : []
  const showNotes =
    device.type !== 'protection' &&
    (device.notes ?? '').trim().length > 0 &&
    isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)
  return [
    ...certificationParts.map((part) => part.text),
    ...conversionParts.map((part) => part.text),
    ...(showNotes ? [(device.notes ?? '').trim()] : []),
  ]
}

function getSupplyMetadataCalloutTopExtra(device: TrunkDevice): number {
  const lines = getSupplyMetadataCalloutLines(device)
  const usesMetadataCallout =
    (device.symbol === 'inverter' ||
      device.symbol === 'solar_panel' ||
      device.symbol === 'battery') &&
    shouldUseSupplyMetadataCallout(lines, getSupplyDeviceMultiplier(device))
  if (!usesMetadataCallout) return 0
  return device.symbol === 'inverter'
    ? SUPPLY_METADATA_CALLOUT_INVERTER_TOP_EXTRA
    : SUPPLY_METADATA_CALLOUT_DEVICE_TOP_EXTRA
}

/** Top edge of labels that TrunkDeviceSymbol stacks above a horizontal supply device. */
function getSupplyDeviceTopExtent(device: TrunkDevice, y: number): number {
  let top = y - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
  const certificationParts = getVisibleCertificationLabelParts(device)
  const conversionParts =
    device.type === 'conversion' || device.symbol === 'solar_panel' || device.symbol === 'battery'
      ? getVisibleConversionLabelParts(device)
      : []
  const certificationLineCount = certificationParts.reduce(
    (total, part) => total + countSymbolLabelVisualLines(part.text),
    0
  )
  const conversionLineCount = conversionParts.reduce(
    (total, part) => total + countSymbolLabelVisualLines(part.text),
    0
  )
  const showNotes =
    device.type !== 'protection' &&
    (device.notes ?? '').trim().length > 0 &&
    isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)
  const topLineCount = conversionLineCount + certificationLineCount + (showNotes ? 1 : 0)
  if (topLineCount > 0) {
    const labelHeight = topLineCount * (SUPPLY_TOP_LABEL_FONT_SIZE + SUPPLY_TOP_LABEL_LINE_SPACING)
    top -= SUPPLY_TOP_LABEL_OFFSET_FROM_SYMBOL + labelHeight
    if (getSupplyMetadataCalloutTopExtra(device) > 0) {
      // The callout frame and its leader sit a little farther above the symbol than
      // the old unframed label stack.
      // Inverter callouts use the upper-left placement (40px leader offset), while
      // solar and battery callouts use the centered top placement (28px offset).
      // Reserve the latter too; otherwise a detached supply frame can cut through
      // the new solar/battery metadata card at its top edge.
      top -= getSupplyMetadataCalloutTopExtra(device)
    }
  }
  return top
}

const SUPPLY_INFO_DEVICE_HORIZONTAL_REACH = 42
const SUPPLY_INFO_VERTICAL_CLEARANCE = 10

/** Whether right-side supply content truly intersects a compact bottom info block. */
export function supplyContentCollidesWithInfoBlock(params: {
  infoBlockLeftX: number
  compactInfoBlockTop: number
  supplyRightExtent: number
  supplyX: number
  supplySourceY: number
  supplyDevices: Array<{ device: TrunkDevice; x: number; y: number }>
}): boolean {
  const {
    infoBlockLeftX,
    compactInfoBlockTop,
    supplyRightExtent,
    supplyX,
    supplySourceY,
    supplyDevices,
  } = params
  const overlapsHorizontally =
    supplyRightExtent + 16 > infoBlockLeftX
  if (!overlapsHorizontally) return false

  const contentBottomInInfoRegion = Math.max(
    ...supplyDevices
      .filter(({ x }) => x + SUPPLY_INFO_DEVICE_HORIZONTAL_REACH > infoBlockLeftX)
      .map(({ device, y }) => {
        const hasBottomProtectionLabels =
          device.type === 'protection' &&
          (device.symbolLabelDisplay?.position ?? 'bottom') === 'bottom'
        const protectionLabelLineCount = hasBottomProtectionLabels
          ? getProtectionOneWireLabelLines(device).reduce(
              (count, line) => count + countSymbolLabelVisualLines(line.text),
              0
            )
          : 0
        const protectionLabelHeight =
          protectionLabelLineCount > 0
            ? 5 + protectionLabelLineCount * (10 + 2) - 2
            : 0
        return (
          y +
          LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 +
          (hasBottomProtectionLabels ? protectionLabelHeight : 18)
        )
      }),
    supplyX + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 > infoBlockLeftX
      ? supplySourceY + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 + 18
      : Number.NEGATIVE_INFINITY
  )

  return contentBottomInInfoRegion + SUPPLY_INFO_VERTICAL_CLEARANCE > compactInfoBlockTop
}

// Shared sizing helpers for circuit-notes labels so layout, canvas rendering,
// debug overlays, and export all agree on the same estimated text box.
export const CIRCUIT_NOTES_CHAR_WIDTH = 6
export const CIRCUIT_NOTES_MIN_WIDTH = 60
export const CIRCUIT_NOTES_MAX_WIDTH = 200

export function estimateCircuitNotesWidth(label: string | undefined | null): number {
  const length = (label?.length ?? 0) || 1
  const raw = length * CIRCUIT_NOTES_CHAR_WIDTH
  return clamp(raw, CIRCUIT_NOTES_MIN_WIDTH, CIRCUIT_NOTES_MAX_WIDTH)
}

// Shared sizing for protection name labels rendered by CircuitLabel. This is an
// estimate (layout is not font-aware), but it keeps automatic spacing in sync
// with the canvas text box and the layout-tree hit zones derived from it.
export const PROTECTION_LABEL_FONT_SIZE = 11
export const PROTECTION_LABEL_CHAR_WIDTH = 6.4
export const PROTECTION_LABEL_MIN_WIDTH = 16
export const PROTECTION_LABEL_MAX_WIDTH = 220
export const PROTECTION_LABEL_DEFAULT_BOX_WIDTH = 80
export const PROTECTION_LABEL_FREE_OVERFLOW_WIDTH = 15
export const PROTECTION_LABEL_X_OFFSET_FROM_MCB = -20
// Right-align the label just outside the SPD body, whose left edge sits about
// 29px left of the trunk at the standard 30px symbol size.
export const SPD_PROTECTION_LABEL_X_OFFSET_FROM_TRUNK = -32
export const SPD_PROTECTION_LABEL_Y_OFFSET = 2
// Keep the established circuit-column reserve when tightening the visual label
// offset, otherwise the trunk shifts left and cancels out the visible move.
const SPD_PROTECTION_LABEL_LEFT_RESERVE_EXTRA = 32
export const PROTECTION_LABEL_CLEARANCE = 8
export const PROTECTION_TECHNICAL_LABEL_OFFSET_FROM_SYMBOL = 5

function estimateTextLineWidth(text: string, charWidth: number): number {
  return Math.ceil(text.length * charWidth)
}

export function estimateProtectionNameLabelWidth(label: string | undefined | null): number {
  const trimmed = (label ?? '').trim()
  if (!trimmed) return 0
  const raw = estimateTextLineWidth(trimmed, PROTECTION_LABEL_CHAR_WIDTH) + 4
  return Math.min(PROTECTION_LABEL_MAX_WIDTH, Math.max(PROTECTION_LABEL_MIN_WIDTH, raw))
}

function estimateProtectionTechnicalLabelWidth(protection: ProtectionDevice | undefined): number {
  if (!protection) return 0
  const lines = getVisibleProtectionLabelLines(protection)
  if (lines.length === 0) return 0
  return Math.max(...lines.map((line) => estimateTextLineWidth(line, 6)))
}

function getTopmostCircuitBranch(circuitBranches: BranchLayout[]): BranchLayout | null {
  if (circuitBranches.length === 0) return null
  return circuitBranches.reduce((top, branch) => (branch.branchY < top.branchY ? branch : top))
}

function getCircuitLineTopY(
  circuitBranches: BranchLayout[],
  fallbackMcbY: number,
  hasSubPanelAtLineEnd: boolean
): number {
  const topmostBranch = getTopmostCircuitBranch(circuitBranches)
  const baseTopY = topmostBranch
    ? topmostBranch.branchY
    : fallbackMcbY - LAYOUT_CONSTANTS.BRANCH_START_OFFSET

  if (!hasSubPanelAtLineEnd || !topmostBranch) {
    return baseTopY
  }

  // Sub-panel symbol is rendered at the very end of the vertical line. When
  // endpoint branches exist, that end sits one row above the topmost branch.
  const hasEndpointBranches = circuitBranches.some((b) => b.endpoints.length > 0)
  const subPanelLineEndY = hasEndpointBranches
    ? topmostBranch.branchY - LAYOUT_CONSTANTS.ENDPOINT_BRANCH_SPACING
    : topmostBranch.branchY

  return Math.min(baseTopY, subPanelLineEndY)
}

export interface BottomUpLayoutElement {
  id: string
  type:
    | 'supply'
    | 'ground'
    | 'mainBus'
    | 'protection'
    | 'rcd'
    | 'endpoint'
    | 'label'
    | 'trunk'
    | 'branch'
    | 'trunkDevice'
  position: Point
  width?: number
  height?: number
  circuitId?: string
  protectionId?: string
  endpointId?: string
  trunkDeviceId?: string
  label?: string
  trunkId?: string
  branchId?: string
  /** Mirror endpoint artwork on branches that run left instead of right. */
  mirrorEndpointHorizontally?: boolean
  /** Resolve this user-facing label through i18n at render/export time. */
  translationKey?: string
  /** For circuit-notes labels: draw horizontal or vertical. */
  notesOrientation?: 'horizontal' | 'vertical'
  /** For circuit-notes labels: if false, do not draw (slot still reserved for stable layout). */
  notesVisible?: boolean
}

export interface BottomUpCircuitLayout {
  circuit: Circuit
  protection: ProtectionDevice | null
  parentRcd: ProtectionDevice | null
  parentCircuit: Circuit | null // Parent circuit if this is a nested circuit
  x: number
  width: number
  /** Space reserved to the left of the protection/wire anchor for left-side labels. */
  leftReserve: number
  protectionY: number
  trunkY?: number
  branch: BranchLayout | null
  secondaryBusY?: number // Y position of secondary bus bar (for nested circuits)
}

export interface BottomUpPanelLayout {
  panel: Panel
  /** Unique render/export identity. Virtual frames share the owning panel id. */
  diagramId?: string
  /** Ordinary electrical panel frame or a non-persisted detached supply frame. */
  frameRole?: 'panel' | 'supply'
  /** Electrical panel that owns interactions and persisted supply topology. */
  ownerPanelId?: string
  /** How the lower supply endpoint is represented in this frame. */
  supplyEndpointKind?: 'mains' | 'continuation'
  elements: BottomUpLayoutElement[]
  /** Circuit notes labels for eendraad canvas + export overlay (single source of truth). */
  circuitNotes?: Array<{
    circuitId: string
    x: number
    y: number
    label: string
    notesOrientation: 'horizontal' | 'vertical'
    notesVisible: boolean
  }>
  circuits: BottomUpCircuitLayout[]
  trunks: TrunkLayout[]
  branches: BranchLayout[]
  mainBus: {
    x: number
    y: number
    width: number
  }
  supply: {
    x: number
    y: number
  }
  /** Bend point where supply wire turns from vertical to horizontal (main panel; includes empty-trunk minimum stub) */
  supplyBend?: {
    x: number
    y: number
  }
  /** Positioned supply trunk device elements (energy meters, protections on supply wire) */
  supplyDevices?: Array<{
    device: import('@/types/schema').TrunkDevice
    x: number
    y: number
    feedScope: 'shared' | 'root'
    feedIndex: number
  }>
  /** Orthogonal upper backup and lower grid lanes exposed by a modular source changeover. */
  supplyChangeoverBranches?: {
    deviceId: string
    x: number
    y: number
    elbowX: number
    upperY: number
    lowerY: number
    slotEndX: number
  }
  /** Grid-connected converter branch without a source changeover. */
  supplyConverterBranch?: {
    deviceId: string
    x: number
    y: number
    lineY: number
    dcEndX: number
    dcTopY?: number
    dcTopEndX?: number
  }
  /** Optional protected load circuit leaving the left AC backup port of a direct converter. */
  supplyConverterBackup?: {
    converterId: string
    x1: number
    x2: number
    y: number
    circuitId?: string
    protectionId?: string
  }
  /** @deprecated Detached feed frames now use a nearby text-only destination label. */
  feedOutput?: {
    x: number
    busY: number
    endY: number
  }
  ground?: {
    x: number
    y: number
  }
  /** Positioned ground trunk device elements (earthing separators on ground wire) */
  groundDevices?: Array<{
    device: import('@/types/schema').TrunkDevice
    x: number
    y: number
  }>
  frame: {
    x: number
    y: number
    width: number
    height: number
  }
  // Sub-panel information
  isSubPanel?: boolean
  parentMcb?: {
    protection: ProtectionDevice
    circuit: Circuit
    position: Point
  }
}

export function getPanelDiagramId(panelLayout: BottomUpPanelLayout): string {
  return panelLayout.diagramId ?? panelLayout.panel.id
}

interface BottomUpPanelLayoutOptions {
  includeSupplyTopology?: boolean
  includeGroundDevices?: boolean
  frameRole?: 'panel' | 'supply'
  diagramId?: string
  ownerPanelId?: string
  supplyEndpointKind?: 'mains' | 'continuation'
  /** Render the compact detached-feed destination label and frame geometry. */
  feedOutput?: boolean
}

export interface BottomUpLayoutResult {
  panels: BottomUpPanelLayout[]
  totalWidth: number
  totalHeight: number
}

/**
 * Flatten panels for rendering
 */
interface FlatPanelInfo {
  panel: Panel
  parentPanel?: Panel
  depth: number
}

function flattenPanelsForRendering(panels: Panel[]): FlatPanelInfo[] {
  const result: FlatPanelInfo[] = []
  const flatten = (panelList: Panel[], parent?: Panel, depth = 0) => {
    for (const panel of panelList) {
      result.push({ panel, parentPanel: parent, depth })
      flatten(panel.subPanels, panel, depth + 1)
    }
  }
  flatten(panels)
  return result
}

function getPanelSupplyLinkSortX(
  sourcePanelLayout: BottomUpPanelLayout | undefined,
  link: PanelSupplyLink
): number {
  if (!sourcePanelLayout) return Number.POSITIVE_INFINITY

  if (link.feederCircuit) {
    const branchXs = sourcePanelLayout.branches
      .filter((branch) => branch.circuitId === link.feederCircuit!.id)
      .map((branch) => branch.trunkX)
    if (branchXs.length > 0) return Math.min(...branchXs)

    const circuitLayout = sourcePanelLayout.circuits.find(
      (circuit) => circuit.circuit.id === link.feederCircuit!.id
    )
    if (circuitLayout) return circuitLayout.x
  }

  const protectionElement = sourcePanelLayout.elements.find(
    (element) => element.protectionId === link.protection.id
  )
  return protectionElement?.position.x ?? Number.POSITIVE_INFINITY
}

function createOrderedPanelChildrenResolver(
  project: ProjectWithOptionalV2Electrical,
  panelLayoutById: Map<string, BottomUpPanelLayout>
): (panel: Panel) => Panel[] {
  return (panel: Panel): Panel[] => {
    const children = panel.subPanels ?? []
    if (children.length <= 1) return children

    const fallbackIndexById = new Map(children.map((child, index) => [child.id, index]))
    const childIdSet = new Set(children.map((child) => child.id))
    const sourcePanelLayout = panelLayoutById.get(panel.id)
    const orderedLinks = resolvePanelSupplyLinksForSourcePanel(project, panel)
      .filter((link) => childIdSet.has(link.targetPanel.id))
      .sort((a, b) => {
        const ax = getPanelSupplyLinkSortX(sourcePanelLayout, a)
        const bx = getPanelSupplyLinkSortX(sourcePanelLayout, b)
        if (ax !== bx) return ax - bx
        return (
          (fallbackIndexById.get(a.targetPanel.id) ?? Number.POSITIVE_INFINITY) -
          (fallbackIndexById.get(b.targetPanel.id) ?? Number.POSITIVE_INFINITY)
        )
      })

    const orderByChildId = new Map(orderedLinks.map((link, index) => [link.targetPanel.id, index]))

    return [...children].sort((a, b) => {
      const ai = orderByChildId.get(a.id)
      const bi = orderByChildId.get(b.id)
      if (ai != null && bi != null) return ai - bi
      if (ai != null) return -1
      if (bi != null) return 1
      return (fallbackIndexById.get(a.id) ?? 0) - (fallbackIndexById.get(b.id) ?? 0)
    })
  }
}

function flattenPanelsForPlacement(
  panels: Panel[],
  getOrderedChildren: (panel: Panel) => Panel[]
): FlatPanelInfo[] {
  const result: FlatPanelInfo[] = []
  const flatten = (panelList: Panel[], parent?: Panel, depth = 0) => {
    for (const panel of panelList) {
      result.push({ panel, parentPanel: parent, depth })
      flatten(getOrderedChildren(panel), panel, depth + 1)
    }
  }
  flatten(panels)
  return result
}

function applyShiftToPanelLayout(panelLayout: BottomUpPanelLayout, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return

  panelLayout.frame.x += dx
  panelLayout.frame.y += dy

  panelLayout.elements.forEach((el) => {
    el.position.x += dx
    el.position.y += dy
  })

  panelLayout.branches.forEach((branch) => {
    branch.branchX += dx
    branch.trunkX += dx
    branch.branchY += dy
    branch.trunkY += dy
  })

  panelLayout.trunks.forEach((trunk) => {
    trunk.x += dx
    trunk.y += dy
  })

  panelLayout.mainBus.x += dx
  panelLayout.mainBus.y += dy
  panelLayout.supply.x += dx
  panelLayout.supply.y += dy
  if (panelLayout.supplyBend) {
    panelLayout.supplyBend.x += dx
    panelLayout.supplyBend.y += dy
  }
  if (panelLayout.ground) {
    panelLayout.ground.x += dx
    panelLayout.ground.y += dy
  }
  panelLayout.supplyDevices?.forEach((device) => {
    device.x += dx
    device.y += dy
  })
  if (panelLayout.supplyChangeoverBranches) {
    panelLayout.supplyChangeoverBranches.x += dx
    panelLayout.supplyChangeoverBranches.y += dy
    panelLayout.supplyChangeoverBranches.elbowX += dx
    panelLayout.supplyChangeoverBranches.upperY += dy
    panelLayout.supplyChangeoverBranches.lowerY += dy
    panelLayout.supplyChangeoverBranches.slotEndX += dx
  }
  if (panelLayout.supplyConverterBranch) {
    panelLayout.supplyConverterBranch.x += dx
    panelLayout.supplyConverterBranch.y += dy
    panelLayout.supplyConverterBranch.lineY += dy
    panelLayout.supplyConverterBranch.dcEndX += dx
    if (panelLayout.supplyConverterBranch.dcTopY != null) {
      panelLayout.supplyConverterBranch.dcTopY += dy
    }
    if (panelLayout.supplyConverterBranch.dcTopEndX != null) {
      panelLayout.supplyConverterBranch.dcTopEndX += dx
    }
  }
  if (panelLayout.supplyConverterBackup) {
    panelLayout.supplyConverterBackup.x1 += dx
    panelLayout.supplyConverterBackup.x2 += dx
    panelLayout.supplyConverterBackup.y += dy
  }
  if (panelLayout.feedOutput) {
    panelLayout.feedOutput.x += dx
    panelLayout.feedOutput.busY += dy
    panelLayout.feedOutput.endY += dy
  }
  panelLayout.groundDevices?.forEach((device) => {
    device.x += dx
    device.y += dy
  })
  panelLayout.circuits.forEach((circuit) => {
    circuit.x += dx
    circuit.protectionY += dy
    if (circuit.trunkY != null) circuit.trunkY += dy
    if (circuit.secondaryBusY != null) circuit.secondaryBusY += dy
  })
  panelLayout.circuitNotes?.forEach((note) => {
    note.x += dx
    note.y += dy
  })
  if (panelLayout.parentMcb) {
    panelLayout.parentMcb.position.x += dx
    panelLayout.parentMcb.position.y += dy
  }
}

function applyPanelFrameBottomAlignmentByRow(
  panelLayouts: BottomUpPanelLayout[],
  getRowKey: (panelLayout: BottomUpPanelLayout) => number
): void {
  const extentsByRow = new Map<number, { min: number; max: number }>()

  panelLayouts.forEach((panelLayout) => {
    const rowKey = getRowKey(panelLayout)
    const bottom = panelLayout.frame.y + panelLayout.frame.height
    const extents = extentsByRow.get(rowKey)
    extentsByRow.set(
      rowKey,
      extents
        ? {
            min: Math.min(extents.min, bottom),
            max: Math.max(extents.max, bottom),
          }
        : { min: bottom, max: bottom }
    )
  })

  panelLayouts.forEach((panelLayout) => {
    const rowKey = getRowKey(panelLayout)
    const extents = extentsByRow.get(rowKey)
    if (!extents) return

    const rowBottom = Math.max(extents.min, extents.max - INFO_BLOCK_HEIGHT * 1.75)
    const targetHeight = rowBottom - panelLayout.frame.y
    if (targetHeight > 0) panelLayout.frame.height = targetHeight
  })
}

/**
 * Per-panel pre-built lookups used by the bottom-up layout pipeline.
 *
 * Built lazily via {@link getPanelLookups} and cached against the `Panel`
 * object via a module-level `WeakMap`. Because the project store creates a
 * new `Panel` object on every edit (immer immutable updates), object
 * identity is a reliable cache key: once a panel mutates, the cache entry
 * for the old object is unreachable and GC'd.
 *
 * Building these maps is O(circuits + protections); every subsequent call
 * on the same panel becomes O(1), eliminating the O(panels × circuits²)
 * tax the previous implementation paid every time `findParentCircuit` /
 * `findProtectionForCircuit` / `findParentRcd` was invoked.
 */
interface PanelLookups {
  /** All circuits in the panel keyed by id (panel-level + under-protection). */
  circuitMap: Map<string, Circuit>
  /** child circuit id → parent Circuit (via parent.subCircuitIds). */
  parentByCircuitId: Map<string, Circuit>
  /** circuit id → first protection (any type) that lists it. */
  protectionByCircuitId: Map<string, ProtectionDevice>
  /** circuit id → first RCD/RCBO that lists it, regardless of group size. */
  firstRcdByCircuitId: Map<string, ProtectionDevice>
}

const panelLookupsCache = new WeakMap<Panel, PanelLookups>()

function getPanelLookups(panel: Panel): PanelLookups {
  const cached = panelLookupsCache.get(panel)
  if (cached) return cached

  const circuitMap = new Map<string, Circuit>()
  for (const c of panel.circuits) {
    circuitMap.set(c.id, c)
  }
  for (const protection of panel.protections) {
    if (protection.circuits) {
      for (const c of protection.circuits) {
        if (!circuitMap.has(c.id)) circuitMap.set(c.id, c)
      }
    }
  }

  const parentByCircuitId = new Map<string, Circuit>()
  for (const candidate of circuitMap.values()) {
    const subIds = candidate.subCircuitIds
    if (!subIds || subIds.length === 0) continue
    for (const childId of subIds) {
      // Match the legacy "first parent wins" semantics: the previous
      // findParentCircuit iterated panel.circuits then protection.circuits
      // and returned the first hit, never inspecting later candidates.
      if (!parentByCircuitId.has(childId)) {
        parentByCircuitId.set(childId, candidate)
      }
    }
  }

  const protectionByCircuitId = new Map<string, ProtectionDevice>()
  const firstRcdByCircuitId = new Map<string, ProtectionDevice>()
  for (const protection of panel.protections) {
    if (!protection.circuits) continue
    const isRcdLike = protection.type === 'RCD' || protection.type === 'RCBO'
    for (const c of protection.circuits) {
      if (!protectionByCircuitId.has(c.id)) {
        protectionByCircuitId.set(c.id, protection)
      }
      if (isRcdLike && !firstRcdByCircuitId.has(c.id)) {
        firstRcdByCircuitId.set(c.id, protection)
      }
    }
  }

  const lookups: PanelLookups = {
    circuitMap,
    parentByCircuitId,
    protectionByCircuitId,
    firstRcdByCircuitId,
  }
  panelLookupsCache.set(panel, lookups)
  return lookups
}

/**
 * Build a lookup map of circuit ID → Circuit for a panel.
 * Used to resolve subCircuitIds without storing duplicated objects.
 *
 * The map is memoized per Panel object via {@link getPanelLookups}, so
 * repeated calls during a single layout pass are O(1) instead of
 * re-walking `panel.circuits` and `panel.protections`.
 */
function buildCircuitMap(panel: Panel): Map<string, Circuit> {
  return getPanelLookups(panel).circuitMap
}

/**
 * Resolve subCircuitIds to actual Circuit objects using a lookup map.
 */
function resolveSubCircuits(circuit: Circuit, circuitMap: Map<string, Circuit>): Circuit[] {
  if (!circuit.subCircuitIds || circuit.subCircuitIds.length === 0) return []
  return circuit.subCircuitIds
    .map((id) => circuitMap.get(id))
    .filter((c): c is Circuit => c !== undefined)
}

/**
 * Find protection for a circuit
 */
function findProtectionForCircuit(panel: Panel, circuit: Circuit): ProtectionDevice | null {
  return getPanelLookups(panel).protectionByCircuitId.get(circuit.id) ?? null
}

export function isPanelOnlySubPanelFeeder(
  protection: ProtectionDevice | null | undefined,
  circuit: Circuit
): boolean {
  if (!protection?.subPanelId) return false
  const hasConsumerEndpoints = circuit.endpoints.some(
    (endpoint) => endpoint.symbol !== 'panel_distribution'
  )
  const hasOnlyPanelAttachment =
    !hasConsumerEndpoints &&
    (circuit.branches?.length ?? 0) === 0 &&
    (circuit.subCircuitIds?.length ?? 0) === 0 &&
    (circuit.trunkDevices?.length ?? 0) === 0
  if (!hasOnlyPanelAttachment) return false

  if (protection.directPanelFeeder) return true

  // A normal one-circuit MCB feeding a new secondary panel is a real,
  // visible protection. Only suppress the extra structural circuit that is
  // carried by the same protection after a feeder protection was deleted.
  const protectionCircuits = protection.circuits ?? []
  return protectionCircuits.length > 1 && protectionCircuits[0]?.id !== circuit.id
}

export function hasPanelAttachmentOnSecondaryBus(
  protection: ProtectionDevice | null | undefined,
  circuit: Circuit
): boolean {
  if (!protection?.subPanelId || (circuit.subCircuitIds?.length ?? 0) <= 1) return false

  const protectionCircuits = protection.circuits ?? []
  const explicitPanelCircuit = protectionCircuits.find((candidate) =>
    candidate.endpoints.some((endpoint) => endpoint.symbol === 'panel_distribution')
  )
  if (explicitPanelCircuit) return explicitPanelCircuit.id === circuit.id

  return protectionCircuits.length === 1 && protectionCircuits[0]?.id === circuit.id
}

/**
 * Find parent RCD for a circuit.
 *
 * An RCD/RCBO is only a "parent RCD" (grouping device with trunk) when it
 * groups multiple circuits. When it directly protects a single circuit
 * (acting like an MCB), it is NOT a parent RCD — it is treated as the
 * circuit's direct protection instead.
 *
 * Note on semantics: the lookup returns the first RCD/RCBO that lists this
 * circuit, then the ≤1-circuit filter is applied. If a later RCD/RCBO with
 * >1 circuits also references the same circuit, we still return null —
 * matching the original implementation exactly.
 */
function findParentRcd(panel: Panel, circuit: Circuit): ProtectionDevice | null {
  const first = getPanelLookups(panel).firstRcdByCircuitId.get(circuit.id)
  if (!first) return null
  const groupedCircuits = (first.circuits ?? []).filter(
    (candidate) => !isPanelOnlySubPanelFeeder(first, candidate)
  )
  if (groupedCircuits.length <= 1) return null
  return first
}

/**
 * Find parent circuit for a nested circuit (using subCircuitIds)
 */
function findParentCircuit(panel: Panel, circuit: Circuit): Circuit | null {
  return getPanelLookups(panel).parentByCircuitId.get(circuit.id) ?? null
}

/**
 * Calculate trunk positions for RCDs
 * RCDs create: vertical line from main bus, RCD symbol on vertical part, then horizontal trunk above
 */
function calculateTrunks(
  panel: Panel,
  circuitLayouts: BottomUpCircuitLayout[],
  mainBusY: number
): TrunkLayout[] {
  const trunks: TrunkLayout[] = []
  const rcdMap = new Map<string, ProtectionDevice>()

  // Find all RCDs that act as grouping devices (empty or 2+ real circuits).
  // A panel-only feeder transferred onto an RCD/RCBO after its own protection is
  // deleted is a visual attachment, not another protected circuit. It must not
  // turn the remaining direct protection into a grouping trunk.
  for (const protection of panel.protections) {
    const circuits = protection.circuits ?? []
    const groupedCircuits = circuits.filter(
      (circuit) => !isPanelOnlySubPanelFeeder(protection, circuit)
    )
    if (
      (protection.type === 'RCD' || protection.type === 'RCBO') &&
      (circuits.length === 0 || groupedCircuits.length > 1)
    ) {
      rcdMap.set(protection.id, protection)
    }
  }

  // Group circuits by RCD
  const rcdCircuits = new Map<string, Circuit[]>()
  for (const circuitLayout of circuitLayouts) {
    if (circuitLayout.parentRcd) {
      const rcdId = circuitLayout.parentRcd.id
      if (!rcdCircuits.has(rcdId)) {
        rcdCircuits.set(rcdId, [])
      }
      rcdCircuits.get(rcdId)!.push(circuitLayout.circuit)
    }
  }

  // Calculate trunk positions - RCD trunk is above the RCD symbol (lower Y)
  const rcdTrunkY = mainBusY - LAYOUT_CONSTANTS.RCD_TRUNK_OFFSET

  for (const [rcdId, circuits] of rcdCircuits.entries()) {
    if (!rcdMap.has(rcdId)) continue

    // Find circuits under this RCD
    const rcdCircuitLayouts = circuitLayouts.filter((cl) => cl.parentRcd?.id === rcdId)
    if (rcdCircuitLayouts.length === 0) {
      // RCD with no circuits yet - still create trunk at a default position
      const minX =
        circuitLayouts.length > 0
          ? Math.min(...circuitLayouts.map((cl) => cl.x))
          : LAYOUT_CONSTANTS.LEFT_MARGIN
      const maxX =
        circuitLayouts.length > 0
          ? Math.max(...circuitLayouts.map((cl) => cl.x + cl.width))
          : LAYOUT_CONSTANTS.LEFT_MARGIN + 200
      trunks.push({
        id: `trunk-${rcdId}`,
        protectionId: rcdId,
        x: minX - LAYOUT_CONSTANTS.TRUNK_PADDING,
        y: rcdTrunkY,
        width: maxX - minX + LAYOUT_CONSTANTS.TRUNK_PADDING * 2,
        circuits: [],
      })
    } else {
      const minX = Math.min(...rcdCircuitLayouts.map((cl) => cl.x))
      const maxX = Math.max(...rcdCircuitLayouts.map((cl) => cl.x + cl.width))
      trunks.push({
        id: `trunk-${rcdId}`,
        protectionId: rcdId,
        x: minX - LAYOUT_CONSTANTS.TRUNK_PADDING,
        y: rcdTrunkY,
        width: maxX - minX + LAYOUT_CONSTANTS.TRUNK_PADDING * 2,
        circuits: circuits,
      })
    }
  }

  // Also create trunks for RCDs with 0 circuits
  for (const rcdId of rcdMap.keys()) {
    if (!rcdCircuits.has(rcdId)) {
      // RCD with no circuits - create trunk at default position
      const minX =
        circuitLayouts.length > 0
          ? Math.min(...circuitLayouts.map((cl) => cl.x))
          : LAYOUT_CONSTANTS.LEFT_MARGIN
      const maxX =
        circuitLayouts.length > 0
          ? Math.max(...circuitLayouts.map((cl) => cl.x + cl.width))
          : LAYOUT_CONSTANTS.LEFT_MARGIN + 200
      trunks.push({
        id: `trunk-${rcdId}`,
        protectionId: rcdId,
        x: minX - LAYOUT_CONSTANTS.TRUNK_PADDING,
        y: rcdTrunkY,
        width: maxX - minX + LAYOUT_CONSTANTS.TRUNK_PADDING * 2,
        circuits: [],
      })
    }
  }

  return trunks
}

/**
 * Calculate branch layouts for endpoint chains.
 *
 * The behavior-bearing sub-passes live in pure layout modules; this wrapper
 * applies the returned secondary-bus assignments to the mutable panel layout
 * objects used by the rest of this legacy layout pipeline.
 */
function calculateBranches(
  circuitLayouts: BottomUpCircuitLayout[],
  trunks: TrunkLayout[],
  mainBusY: number,
  panel?: Panel
): BranchLayout[] {
  const branchPassConstants: BranchPassConstants = {
    BRANCH_LEAD_IN: LAYOUT_CONSTANTS.BRANCH_LEAD_IN,
    BRANCH_START_OFFSET: LAYOUT_CONSTANTS.BRANCH_START_OFFSET,
    ENDPOINT_BRANCH_SPACING: LAYOUT_CONSTANTS.ENDPOINT_BRANCH_SPACING,
    ENDPOINT_HORIZONTAL_SPACING: LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
    APPLIANCE_AFTER_SOCKET_GAP: LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP,
    MCB_Y_OFFSET: LAYOUT_CONSTANTS.MCB_Y_OFFSET,
    RCD_TRUNK_OFFSET: LAYOUT_CONSTANTS.RCD_TRUNK_OFFSET,
    SECONDARY_BUS_ABOVE_ENDPOINTS_GAP: LAYOUT_CONSTANTS.SECONDARY_BUS_ABOVE_ENDPOINTS_GAP,
    TRUNK_DEVICE_MCB_GAP: LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP,
    TRUNK_DEVICE_SPACING: LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING,
    SYMBOL_SIZE: LAYOUT_CONSTANTS.SYMBOL_SIZE,
    PROTECTION_WIDTH: LAYOUT_CONSTANTS.PROTECTION_WIDTH,
    DOMOTICA_MIN_ENDPOINT_OUTPUTS,
    DOMOTICA_MAX_ENDPOINT_OUTPUTS,
    DOMOTICA_OUTPUT_SPACING,
  }
  const result = calculateBranchLayoutPass(
    circuitLayouts,
    trunks,
    mainBusY,
    panel,
    branchPassConstants
  )
  applySecondaryBusAssignmentsToCircuitLayouts(circuitLayouts, result.secondaryBusYByCircuitId)
  return result.branches
}

function applySecondaryBusAssignmentsToCircuitLayouts(
  circuitLayouts: BottomUpCircuitLayout[],
  secondaryBusYByCircuitId: Map<string, number>
): void {
  for (const circuitLayout of circuitLayouts) {
    const secondaryBusY = secondaryBusYByCircuitId.get(circuitLayout.circuit.id)
    if (secondaryBusY != null) {
      circuitLayout.secondaryBusY = secondaryBusY
    }
  }
}
/**
 * Find parent MCB protection device for a sub-panel
 */
function findParentMcbForSubPanel(
  project: ProjectWithOptionalV2Electrical,
  subPanel: Panel
): { protection: ProtectionDevice; circuit: Circuit; parentPanel: Panel } | null {
  const link = resolvePanelSupplyLinkForPanel(project, subPanel.id)
  if (link?.feederCircuit) {
    return {
      protection: link.protection,
      circuit: link.feederCircuit,
      parentPanel: link.sourcePanel,
    }
  }

  if (link) {
    logger.warn('findParentMcbForSubPanel: Protection found but no circuit', {
      subPanelId: subPanel.id,
      protectionId: link.protection.id,
      circuits: link.protection.circuits,
    })
    return null
  }

  logger.warn('findParentMcbForSubPanel: No MCB found for sub-panel', {
    subPanelId: subPanel.id,
    subPanelName: subPanel.name,
  })
  return null
}

/**
 * Apply frameOffset to all element positions (helper function)
 */
function createElementsWithFrameOffset(
  elements: BottomUpLayoutElement[],
  frameOffset: Point
): BottomUpLayoutElement[] {
  return elements.map((element) => ({
    ...element,
    position: {
      x: element.position.x + frameOffset.x,
      y: element.position.y + frameOffset.y,
    },
  }))
}

/**
 * Calculate bottom-up layout for a single panel
 * All positions are calculated in LOCAL coordinates (relative to panel origin)
 * frameOffset is applied automatically at the end
 */
/** True if circuit or any nested circuit has at least one endpoint (excluding panel_distribution). */
function circuitHasEndpoints(circuit: Circuit, circuitMap: Map<string, Circuit>): boolean {
  const own = circuit.endpoints.some((e) => e.symbol !== 'panel_distribution')
  if (own) return true
  const nested = resolveSubCircuits(circuit, circuitMap)
  return nested.some((n) => circuitHasEndpoints(n, circuitMap))
}

/**
 * Maximum horizontal branch span for a circuit, including all nested
 * subcircuits recursively. Single source of truth for how much space
 * a circuit needs to the right of its MCB on any bus.
 */
function getCircuitMaxBranchWidth(circuit: Circuit, circuitMap: Map<string, Circuit>): number {
  let maxBranchWidth: number = LAYOUT_CONSTANTS.HORIZONTAL_BRANCH_LENGTH

  // Same branch decomposition as calculateBranches (getCircuitBranches), so width
  // is the max horizontal span of any one branch — not summed over stacked branches.
  const endpoints = circuit.endpoints.filter((e) => e.symbol !== 'panel_distribution')
  if (endpoints.length > 0) {
    const endpointBranches = getCircuitBranches(circuit)
    endpointBranches.forEach((branchEndpoints) => {
      maxBranchWidth = Math.max(
        maxBranchWidth,
        calculateBranchWidth(
          branchEndpoints,
          LAYOUT_CONSTANTS.BRANCH_LEAD_IN,
          LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
          LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP
        )
      )
    })
  }

  const nestedCircuits = resolveSubCircuits(circuit, circuitMap)
  if (nestedCircuits.length > 0) {
    nestedCircuits.forEach((nested) => {
      maxBranchWidth = Math.max(maxBranchWidth, getCircuitMaxBranchWidth(nested, circuitMap))
    })
  }

  return maxBranchWidth
}

function getProtectionForCircuitId(
  circuitId: string,
  protectionByCircuitId: Map<string, ProtectionDevice>
): ProtectionDevice | undefined {
  return protectionByCircuitId.get(circuitId)
}

function getProtectionLabelLeftReserve(protection: ProtectionDevice | undefined): number {
  if (!protection) return 0
  const estimatedLabelWidth = estimateProtectionNameLabelWidth(protection.label)
  if (estimatedLabelWidth === 0) return 0

  const renderedLabelWidth = Math.max(PROTECTION_LABEL_DEFAULT_BOX_WIDTH, estimatedLabelWidth)
  const labelReserve = Math.max(
    0,
    renderedLabelWidth - PROTECTION_LABEL_DEFAULT_BOX_WIDTH + PROTECTION_LABEL_FREE_OVERFLOW_WIDTH
  )
  return protection.type === 'SPD'
    ? labelReserve + SPD_PROTECTION_LABEL_LEFT_RESERVE_EXTRA
    : labelReserve
}

export function getProtectionLabelXOffset(protection: ProtectionDevice): number {
  return protection.type === 'SPD'
    ? SPD_PROTECTION_LABEL_X_OFFSET_FROM_TRUNK
    : PROTECTION_LABEL_X_OFFSET_FROM_MCB
}

export function getProtectionLabelYOffset(protection: ProtectionDevice): number {
  return protection.type === 'SPD' ? SPD_PROTECTION_LABEL_Y_OFFSET : 0
}

function getProtectionLabelRightReach(protection: ProtectionDevice | undefined): number {
  if (!protection) return 0

  const symbolRight = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
  const technicalRightReach =
    symbolRight +
    PROTECTION_TECHNICAL_LABEL_OFFSET_FROM_SYMBOL +
    estimateProtectionTechnicalLabelWidth(protection)
  return Math.max(0, technicalRightReach) + PROTECTION_LABEL_CLEARANCE
}

function getProtectionAnchorOffset(leftReserve: number): number {
  return getBranchProtectionAnchorOffset(leftReserve, LAYOUT_CONSTANTS)
}

function getCircuitColumnSpan(
  circuit: Circuit,
  circuitMap: Map<string, Circuit>,
  protectionByCircuitId: Map<string, ProtectionDevice>
): number {
  const baseWidth = Math.max(LAYOUT_CONSTANTS.PROTECTION_WIDTH, LAYOUT_CONSTANTS.SYMBOL_SIZE)
  const maxBranchWidth = getCircuitMaxBranchWidth(circuit, circuitMap)
  const padding = circuitHasEndpoints(circuit, circuitMap)
    ? LAYOUT_CONSTANTS.CIRCUIT_PADDING
    : LAYOUT_CONSTANTS.CIRCUIT_PADDING_NO_ENDPOINTS

  const protection = getProtectionForCircuitId(circuit.id, protectionByCircuitId)
  const leftReserve = getProtectionLabelLeftReserve(protection)
  const rightReserve = Math.max(
    baseWidth / 2 + maxBranchWidth,
    getProtectionLabelRightReach(protection)
  )
  const ownSpan = leftReserve + baseWidth / 2 + rightReserve + padding
  const nestedCircuits = resolveSubCircuits(circuit, circuitMap)
  const ownVisualSpan = ownSpan
  if (nestedCircuits.length === 0) return ownVisualSpan
  if (nestedCircuits.length === 1) {
    return Math.max(
      ownVisualSpan,
      getCircuitColumnSpan(nestedCircuits[0]!, circuitMap, protectionByCircuitId)
    )
  }

  const nestedBusSpan = nestedCircuits.reduce(
    (sum, nestedCircuit) =>
      sum + getCircuitColumnSpan(nestedCircuit, circuitMap, protectionByCircuitId),
    0
  )
  const panelColumnSpan = hasPanelAttachmentOnSecondaryBus(protection, circuit)
    ? LAYOUT_CONSTANTS.SECONDARY_BUS_PANEL_COLUMN_WIDTH
    : 0
  return Math.max(ownVisualSpan, panelColumnSpan + nestedBusSpan)
}

/**
 * Insert a layout row for `nested` under `parentCircuit` when the parent already has one.
 * Returns false when the child is already laid out or the parent layout is missing.
 */
function pushNestedCircuitLayout(
  panel: Panel,
  panelCircuits: Circuit[],
  circuitMap: Map<string, Circuit>,
  protectionByCircuitId: Map<string, ProtectionDevice>,
  circuitLayouts: BottomUpCircuitLayout[],
  nested: Circuit,
  parentCircuit: Circuit
): boolean {
  if (circuitLayouts.some((cl) => cl.circuit.id === nested.id)) {
    return false
  }

  const parentLayout = circuitLayouts.find((cl) => cl.circuit.id === parentCircuit.id)
  if (!parentLayout) {
    return false
  }

  const nestedProtection = findProtectionForCircuit(panel, nested)
  const nestedParentRcd = findParentRcd(panel, nested)
  const nestedLeftReserve = getProtectionLabelLeftReserve(nestedProtection ?? undefined)
  const nestedCircuitWidth = getCircuitColumnSpan(nested, circuitMap, protectionByCircuitId)
  const allNestedCircuits = (parentCircuit.subCircuitIds || [])
    .map((id) => panelCircuits.find((c) => c.id === id))
    .filter((c): c is Circuit => c !== undefined)
  const hasSingleNested = allNestedCircuits.length === 1
  let nestedX: number
  if (hasSingleNested) {
    nestedX =
      parentLayout.x +
      getProtectionAnchorOffset(parentLayout.leftReserve) -
      getProtectionAnchorOffset(nestedLeftReserve)
  } else {
    const parentProtection = findProtectionForCircuit(panel, parentCircuit)
    let currentNestedX =
      parentLayout.x +
      (hasPanelAttachmentOnSecondaryBus(parentProtection, parentCircuit)
        ? LAYOUT_CONSTANTS.SECONDARY_BUS_PANEL_COLUMN_WIDTH
        : 0)
    nestedX = currentNestedX
    for (const nestedCandidate of allNestedCircuits) {
      if (nestedCandidate.id === nested.id) {
        nestedX = currentNestedX
        break
      }
      currentNestedX += getCircuitColumnSpan(nestedCandidate, circuitMap, protectionByCircuitId)
    }
  }

  circuitLayouts.push({
    circuit: nested,
    protection: nestedProtection,
    parentRcd: nestedParentRcd,
    parentCircuit,
    x: nestedX,
    width: nestedCircuitWidth,
    leftReserve: nestedLeftReserve,
    protectionY: LAYOUT_CONSTANTS.PROTECTION_Y,
    trunkY: undefined,
    branch: null,
    secondaryBusY: undefined,
  })
  return true
}

/**
 * Recovery pass for nested circuits whose parent layout was created later in the walk
 * (e.g. main-bus row demoted onto another circuit's secondary bus, then a grandchild on
 * that row's trunk). Without this, deep nesting can exist in data but not render.
 */
function ensureDescendantNestedCircuitLayouts(
  panel: Panel,
  panelCircuits: Circuit[],
  circuitMap: Map<string, Circuit>,
  protectionByCircuitId: Map<string, ProtectionDevice>,
  circuitLayouts: BottomUpCircuitLayout[]
): void {
  let changed = true
  while (changed) {
    changed = false
    for (const nested of panelCircuits) {
      const parentCircuit = findParentCircuit(panel, nested)
      if (!parentCircuit) continue
      if (
        pushNestedCircuitLayout(
          panel,
          panelCircuits,
          circuitMap,
          protectionByCircuitId,
          circuitLayouts,
          nested,
          parentCircuit
        )
      ) {
        changed = true
      }
    }
  }
}

function calculateBottomUpPanelLayout(
  panel: Panel,
  manualOverrides?: Map<string, Point>,
  frameOffset: Point = { x: 0, y: 0 },
  parentMcbInfo?: { protection: ProtectionDevice; circuit: Circuit; parentPanel: Panel } | null,
  installation?: Installation,
  rootPanels?: Panel[],
  options: BottomUpPanelLayoutOptions = {}
): BottomUpPanelLayout {
  const panelCircuits = collectCircuits(panel)
  const circuitMap = buildCircuitMap(panel)
  const protectionByCircuitId = new Map<string, ProtectionDevice>()
  for (const protection of panel.protections) {
    for (const circuit of protection.circuits ?? []) {
      protectionByCircuitId.set(circuit.id, protection)
    }
  }

  // Build circuit layouts
  const circuitLayouts: BottomUpCircuitLayout[] = []
  let currentX = LAYOUT_CONSTANTS.LEFT_MARGIN

  for (const circuit of panelCircuits) {
    const protection = findProtectionForCircuit(panel, circuit)
    const parentRcd = findParentRcd(panel, circuit)

    // Check if this is a nested circuit (has a parent circuit)
    const parentCircuit = findParentCircuit(panel, circuit)

    // Nested circuits are positioned horizontally on secondary bus bar
    if (parentCircuit) {
      // Find parent circuit layout
      const parentLayout = circuitLayouts.find((cl) => cl.circuit.id === parentCircuit.id)
      // Nested circuits may already have been inserted while laying out their parent (recovery loop).
      if (parentLayout && !circuitLayouts.some((cl) => cl.circuit.id === circuit.id)) {
        const circuitWidth = getCircuitColumnSpan(circuit, circuitMap, protectionByCircuitId)
        const circuitLeftReserve = getProtectionLabelLeftReserve(protection ?? undefined)

        // Find all nested circuits for this parent to calculate their X positions.
        // IMPORTANT: Use the order from subCircuitIds, not the order in panelCircuits.
        const allNestedCircuits = (parentCircuit.subCircuitIds || [])
          .map((id) => panelCircuits.find((c) => c.id === id))
          .filter((c): c is Circuit => c !== undefined)

        // Check if there's only one nested circuit
        const hasSingleNested = allNestedCircuits.length === 1

        let nestedX: number
        if (hasSingleNested) {
          // ONE nested circuit: align protection anchors, not column left edges.
          // Label reserves can differ per protection; aligning the columns would
          // otherwise create a sideways jog in what should be one vertical feeder.
          nestedX =
            parentLayout.x +
            getProtectionAnchorOffset(parentLayout.leftReserve) -
            getProtectionAnchorOffset(circuitLeftReserve)
        } else {
          // MULTIPLE nested circuits: lay them out like a mini main bus
          // starting from the parent's vertical wire X. The parent circuit's
          // recursive width reserves the subtree, so siblings are pushed right
          // without moving this child busbar away from its parent.
          const parentProtection = findProtectionForCircuit(panel, parentCircuit)
          let currentNestedX =
            parentLayout.x +
            (hasPanelAttachmentOnSecondaryBus(parentProtection, parentCircuit)
              ? LAYOUT_CONSTANTS.SECONDARY_BUS_PANEL_COLUMN_WIDTH
              : 0)
          nestedX = currentNestedX
          for (const nestedCandidate of allNestedCircuits) {
            if (nestedCandidate.id === circuit.id) {
              // This is the circuit we're currently creating a layout for.
              nestedX = currentNestedX
              break
            }

            currentNestedX += getCircuitColumnSpan(
              nestedCandidate,
              circuitMap,
              protectionByCircuitId
            )
          }
        }

        circuitLayouts.push({
          circuit,
          protection,
          parentRcd,
          parentCircuit,
          x: nestedX, // Positioned at parent's X for single, or horizontally on secondary bus for multiple
          width: circuitWidth,
          leftReserve: circuitLeftReserve,
          protectionY: LAYOUT_CONSTANTS.PROTECTION_Y,
          trunkY: undefined,
          branch: null,
          secondaryBusY: undefined,
        })
      }
      // Skip incrementing currentX for nested circuits
      continue
    }

    // Top-level circuits get their own X position.
    // Use the same recursive max-branch-span helper as nested circuits so
    // every circuit width is derived the same way.
    const widthNestedCircuits = resolveSubCircuits(circuit, circuitMap)

    let circuitWidth = getCircuitColumnSpan(circuit, circuitMap, protectionByCircuitId)

    circuitWidth = Math.max(circuitWidth, LAYOUT_CONSTANTS.CIRCUIT_MIN_WIDTH)

    // Check for manual override
    const override = manualOverrides?.get(`circuit-${circuit.id}`)
    const x = override ? override.x : currentX

    circuitLayouts.push({
      circuit,
      protection,
      parentRcd,
      parentCircuit,
      x,
      width: circuitWidth,
      leftReserve: getProtectionLabelLeftReserve(protection ?? undefined),
      protectionY: LAYOUT_CONSTANTS.PROTECTION_Y,
      trunkY: undefined, // Will be calculated from trunk if parentRcd exists
      branch: null, // Will be calculated later
      secondaryBusY: undefined, // Will be calculated in calculateBranches if nested circuit
    })

    // Converter-backed circuits are positioned beside their converter after the supply
    // geometry is known. They must not reserve a normal main-bus column.
    if (circuit.supplySource?.kind === 'converter-backup') {
      continue
    }

    // Add nested circuits for this parent that were skipped (they appeared before parent in panelCircuits).
    // Demoting a main-bus circuit puts it in parent's subCircuitIds but its protection may come earlier in
    // panel.protections, so without this pass the nested circuit would never get a layout and would "disappear".
    for (const nested of panelCircuits) {
      const nestedParent = findParentCircuit(panel, nested)
      if (nestedParent?.id !== circuit.id) continue
      pushNestedCircuitLayout(
        panel,
        panelCircuits,
        circuitMap,
        protectionByCircuitId,
        circuitLayouts,
        nested,
        circuit
      )
    }

    if (!override) {
      const hasMultipleNested = widthNestedCircuits.length > 1
      const hasEndpoints = circuitHasEndpoints(circuit, circuitMap)
      const gap = hasMultipleNested
        ? LAYOUT_CONSTANTS.GAP_AFTER_SECONDARY_BUS
        : hasEndpoints
          ? LAYOUT_CONSTANTS.CIRCUIT_SPACING
          : LAYOUT_CONSTANTS.CIRCUIT_SPACING_NO_ENDPOINTS
      currentX += circuitWidth + gap
    }
  }

  ensureDescendantNestedCircuitLayouts(
    panel,
    panelCircuits,
    circuitMap,
    protectionByCircuitId,
    circuitLayouts
  )

  // Calculate total width first
  const totalWidth = currentX + LAYOUT_CONSTANTS.LEFT_MARGIN

  // Calculate main bus (needed for trunk calculation)
  const mainBusX = LAYOUT_CONSTANTS.LEFT_MARGIN
  const rawMainBusWidth = totalWidth - LAYOUT_CONSTANTS.LEFT_MARGIN * 2
  // Enforce minimum width so the drop zone is usable even when the panel has no circuits
  const mainBusWidth = Math.max(rawMainBusWidth, LAYOUT_CONSTANTS.MIN_MAIN_BUS_WIDTH)
  const mainBusY = LAYOUT_CONSTANTS.MAIN_BUS_Y

  // Calculate trunks (needs mainBusY)
  const trunks = calculateTrunks(panel, circuitLayouts, mainBusY)

  // Calculate branches (needs mainBusY)
  const branches = calculateBranches(circuitLayouts, trunks, mainBusY, panel)

  // Update circuit layouts with branch info and trunkY
  branches.forEach((branch) => {
    const circuitLayout = circuitLayouts.find((cl) => cl.circuit.id === branch.circuitId)
    if (circuitLayout) {
      circuitLayout.branch = branch
      // Update trunkY if parentRcd exists
      if (circuitLayout.parentRcd) {
        const trunk = trunks.find((t) => t.protectionId === circuitLayout.parentRcd!.id)
        if (trunk) {
          circuitLayout.trunkY = trunk.y
        }
      }
    }
  })

  // Calculate total dimensions
  // Find the lowest Y (topmost element on screen) and highest Y (bottommost element)
  // Y increases downward, so lower Y = higher on screen
  let minY: number = Infinity // Start high so Math.min works correctly
  // Start maxY at the main bus; content below (supply, labels) will extend it.
  let maxY: number = LAYOUT_CONSTANTS.MAIN_BUS_Y

  // Circuits feeding a sub-panel should reserve one extra "branch step" above
  // their top-most branch so the panel symbol can cap the trunk at the top.
  resolvePanelSupplyLinksForSourcePanel({ panels: [panel] }, panel).forEach((link) => {
    const feederCircuit = link.feederCircuit
    if (!feederCircuit) return
    if (feederCircuit.supplySource?.kind === 'converter-backup') return
    const feederCircuitId = feederCircuit.id
    const feederBranches = branches.filter((b) => b.circuitId === feederCircuitId)
    if (feederBranches.length === 0) return
    const topmostFeederBranch = feederBranches.reduce((top, b) =>
      b.branchY < top.branchY ? b : top
    )
    const panelSymbolY = topmostFeederBranch.branchY - LAYOUT_CONSTANTS.ENDPOINT_BRANCH_SPACING
    const PANEL_TOP_MARGIN = 4
    minY = Math.min(minY, panelSymbolY - LAYOUT_CONSTANTS.SYMBOL_SIZE - PANEL_TOP_MARGIN)
  })

  // Find min Y (topmost element, lowest Y value) and max Y (bottommost element, highest Y value)
  // Branches go UP (lower Y values = higher on screen)
  branches.forEach((branch) => {
    const branchCircuit = circuitMap.get(branch.circuitId)
    // Direct converter-backup circuits are initially calculated at the normal
    // circuit height and repositioned onto the inverter lane later in this pass.
    // Measuring that provisional Y here creates a large empty band above the
    // detached supply content as soon as its first protection is added.
    if (branchCircuit?.supplySource?.kind === 'converter-backup') return
    const domotica = branch.endpoints.find(
      (ep) => ep.symbol === 'domotica' && !ep.domoticaChildProps
    )
    if (domotica) {
      const endpointCount = Math.max(
        DOMOTICA_MIN_ENDPOINT_OUTPUTS,
        Math.min(
          DOMOTICA_MAX_ENDPOINT_OUTPUTS,
          Math.trunc(domotica.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS)
        )
      )
      const domoticaHeight =
        DOMOTICA_BASE_HEIGHT + Math.max(0, endpointCount - 1) * DOMOTICA_OUTPUT_SPACING

      // Match layoutTree domotica box placement:
      // bounds.y = position.y - domoticaHeight/2 + DOMOTICA_BASE_HEIGHT/2
      // with position.y === branch.branchY for the parent endpoint.
      const boxTop = branch.branchY - domoticaHeight + DOMOTICA_BASE_HEIGHT / 2

      // Small visual margin above the box so the panel frame/title doesn't touch it.
      const DOMOTICA_TOP_MARGIN = 8
      minY = Math.min(minY, boxTop - DOMOTICA_TOP_MARGIN)
    } else {
      // For regular endpoints, assume a square of SYMBOL_SIZE above the branch plus a small margin.
      const REGULAR_TOP_MARGIN = 4
      minY = Math.min(minY, branch.branchY - LAYOUT_CONSTANTS.SYMBOL_SIZE - REGULAR_TOP_MARGIN)
    }
  })

  // Also check RCD trunks (they're above main bus, so lower Y = higher on screen)
  trunks.forEach((trunk) => {
    minY = Math.min(minY, trunk.y - LAYOUT_CONSTANTS.SYMBOL_SIZE)
  })

  // Also check nested protection positions (they might extend above branches)
  circuitLayouts.forEach((cl) => {
    if (cl.parentCircuit && cl.protection) {
      // Find parent layout to get nested MCB position
      const parentLayout = circuitLayouts.find((pcl) => pcl.circuit.id === cl.parentCircuit!.id)
      if (parentLayout) {
        const parentBranches = branches.filter((b) => b.circuitId === parentLayout.circuit.id)
        const parentHasEndpointBranches = parentBranches.some((b) => b.endpoints.length > 0)
        let nestedMcbY: number
        if (parentHasEndpointBranches && parentLayout.secondaryBusY != null) {
          nestedMcbY = parentLayout.secondaryBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET
        } else if (parentBranches.length > 0) {
          const topmostParentBranch = parentBranches.reduce((top, b) =>
            b.branchY < top.branchY ? b : top
          )
          nestedMcbY = topmostParentBranch.branchY - LAYOUT_CONSTANTS.MCB_Y_OFFSET
        } else {
          nestedMcbY = mainBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET * 2
        }

        // Check nested circuit's branches too
        const nestedBranches = branches.filter((b) => b.circuitId === cl.circuit.id)
        if (nestedBranches.length > 0) {
          const topmostNestedBranchY = nestedBranches.reduce(
            (min, b) => (b.branchY < min ? b.branchY : min),
            Infinity
          )
          minY = Math.min(minY, topmostNestedBranchY - LAYOUT_CONSTANTS.SYMBOL_SIZE)
        } else {
          // No branches, but wire extends upward from MCB - account for wire extension
          const wireExtension = 50 // Match wireSegments.ts extension
          minY = Math.min(minY, nestedMcbY - wireExtension - LAYOUT_CONSTANTS.SYMBOL_SIZE)
        }
      }
    }
  })

  // If no branches or trunks, use main bus as top
  if (minY === Infinity) {
    minY = mainBusY
  }

  // Calculate ground and supply positions
  // Ground wire is at the very start of main bus, offset by 20px to the right
  // Supply wire is spaced from ground by the current SUPPLY_LEFT_OFFSET (30px)
  const isSubPanel = !!parentMcbInfo
  const hasGround =
    !isSubPanel && options.includeGroundDevices !== false && installation?.hasGround !== false

  // Supply Y: main panels show the actual supply bend below the main bus.
  // Sub‑panels use a slightly deeper parent‑MCB placeholder so their wire
  // is visibly longer, but not so deep that it collides with the info block.
  const SUBPANEL_EXTRA_SUPPLY_DROP = 20
  let supplyY = isSubPanel
    ? mainBusY + LAYOUT_CONSTANTS.SUPPLY_VERTICAL_DROP + SUBPANEL_EXTRA_SUPPLY_DROP
    : mainBusY + LAYOUT_CONSTANTS.SUPPLY_VERTICAL_DROP

  const groundX = mainBusX + 20 // 20px offset from start
  const groundY = supplyY // Ground at same level as supply

  // Ground trunk devices (main panel only) — placed vertically between ground symbol and main bus
  const groundTrunkDevices =
    (!isSubPanel && options.includeGroundDevices !== false && installation?.groundTrunkDevices) ||
    []
  const hasGroundDevices = groundTrunkDevices.length > 0

  // Calculate ground trunk device positions on the vertical wire
  // Device spacing along the vertical wire (from ground symbol upward to main bus)
  type GroundDevicePosition = { device: import('@/types/schema').TrunkDevice; x: number; y: number }
  const groundDevicePositions: GroundDevicePosition[] = []

  if (hasGroundDevices) {
    // Calculate positions: devices are evenly spaced on the vertical wire
    // from ground symbol (groundY) up to main bus (mainBusY)
    const totalVerticalDistance = groundY - mainBusY // Distance from bus to ground
    const deviceSpacing = totalVerticalDistance / (groundTrunkDevices.length + 1)

    groundTrunkDevices.forEach((device, index) => {
      const deviceY = groundY - (index + 1) * deviceSpacing // From ground upward
      groundDevicePositions.push({ device, x: groundX, y: deviceY })
    })
  }

  // Supply position: if ground exists, space it from ground; otherwise use original offset
  const supplyOffset = hasGround
    ? 20 + LAYOUT_CONSTANTS.SUPPLY_LEFT_OFFSET // Ground offset (20) + spacing (30) = 50
    : Math.min(LAYOUT_CONSTANTS.SUPPLY_LEFT_OFFSET, LAYOUT_CONSTANTS.SUPPLY_MAX_OFFSET)
  let supplyX = mainBusX + supplyOffset
  const supplyBendX = supplyX // The bend point X (where vertical meets horizontal), stays fixed

  // Supply trunk devices (root panel only) — placed horizontally between bend (main bus) and supply.
  // Array order = flow from supply to main bus: index 0 = next to supply, last = next to main bus.
  const feedProjection =
    !isSubPanel && installation && options.includeSupplyTopology !== false
      ? getPanelFeedProjection(installation, rootPanels ?? [panel], panel)
      : null
  const supplyTrunkDevices = (!isSubPanel && feedProjection?.devices) || []
  const hasSupplyDevices = supplyTrunkDevices.length > 0
  const supplyChangeoverIndex = supplyTrunkDevices.findIndex(
    (device) => device.symbol === 'source_changeover'
  )
  const hasSupplyChangeover = supplyChangeoverIndex >= 0
  const directConverterIndex = supplyTrunkDevices.findIndex(
    (device) => device.supplyPath === 'converter-branch'
  )
  const hasDirectConverter = !hasSupplyChangeover && directConverterIndex >= 0
  let directConverterBackup: BottomUpPanelLayout['supplyConverterBackup']
  const backupOutputDeviceCount = supplyTrunkDevices.filter(
    (device) => device.supplyPath === 'backup-output'
  ).length
  const changeoverGridDeviceCount = supplyTrunkDevices.filter(
    (device) => device.supplyPath === 'changeover-grid'
  ).length
  const converterGridInlineDeviceCount = supplyTrunkDevices.filter(
    (device) =>
      device.supplyPath === 'converter-grid' && device.converterGridPlacement !== 'input-leg'
  ).length
  if (hasSupplyChangeover) {
    supplyY += 48 + (LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_LANE_OFFSET - 44)
  }
  const hasTopConverterDcDevice = supplyTrunkDevices.some(
    (device) => device.supplyPath === 'converter-dc-top'
  )
  if (!options.feedOutput && hasTopConverterDcDevice) {
    // An inline supply assembly shares the panel frame with the full main bus.
    // Keep the upper DC symbol and its metadata below that bus instead of using
    // the detached-frame geometry, where the short rail stubs leave this area free.
    const topDcDevices = supplyTrunkDevices.filter(
      (device) => device.supplyPath === 'converter-dc-top'
    )
    const topConverterLaneOffset = hasSupplyChangeover
      ? LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_LANE_OFFSET
      : 0
    const provisionalTopDeviceY =
      supplyY - topConverterLaneOffset - LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH
    const provisionalTopExtent = Math.min(
      ...topDcDevices.map((device) => getSupplyDeviceTopExtent(device, provisionalTopDeviceY))
    )
    const INLINE_TOP_DC_BUS_CLEARANCE =
      provisionalTopDeviceY - provisionalTopExtent + SUPPLY_FRAME_TOP_CONTENT_GAP
    supplyY = Math.max(
      supplyY,
      mainBusY +
        topConverterLaneOffset +
        LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH +
        INLINE_TOP_DC_BUS_CLEARANCE
    )
  }
  const changeoverLaneOffset = hasSupplyChangeover
    ? LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_LANE_OFFSET
    : 0
  const directConverterLaneOffset = hasDirectConverter
    ? LAYOUT_CONSTANTS.SUPPLY_DIRECT_CONVERTER_OFFSET
    : 0
  const supplySourceY = hasSupplyChangeover
    ? supplyY + changeoverLaneOffset
    : hasDirectConverter
      ? supplyY + directConverterLaneOffset
      : supplyY

  type SupplyDevicePosition = {
    device: import('@/types/schema').TrunkDevice
    x: number
    y: number
    feedScope: 'shared' | 'root'
    feedIndex: number
  }
  const supplyDevicePositions: SupplyDevicePosition[] = []

  if (hasSupplyDevices) {
    const n = supplyTrunkDevices.length
    const sharedDeviceCount = feedProjection?.sharedDeviceCount ?? 0
    supplyTrunkDevices.forEach((device, index) => {
      // Index 0 = next to supply (rightmost), index n-1 = next to main bus (leftmost)
      const deviceX = supplyBendX + (n - index) * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
      const feedScope = index < sharedDeviceCount ? 'shared' : 'root'
      const feedIndex = feedScope === 'shared' ? index : index - sharedDeviceCount
      const deviceY =
        hasSupplyChangeover &&
        (device.supplyPath === 'backup' || device.supplyPath === 'backup-output')
          ? supplyY - changeoverLaneOffset
          : hasSupplyChangeover && index < supplyChangeoverIndex
            ? supplySourceY
            : hasDirectConverter &&
                device.supplyPath !== 'converter-branch' &&
                device.supplyPath !== 'converter-dc' &&
                device.supplyPath !== 'converter-dc-top'
              ? supplySourceY
              : supplyY
      supplyDevicePositions.push({ device, x: deviceX, y: deviceY, feedScope, feedIndex })
    })
    const changeoverDevicePosition = supplyDevicePositions.find(
      ({ device }) => device.symbol === 'source_changeover'
    )
    if (changeoverDevicePosition) {
      const loadSideSerialPositions = supplyDevicePositions
        .filter(({ device }) => {
          const deviceIndex = supplyTrunkDevices.findIndex(
            (candidate) => candidate.id === device.id
          )
          return (
            deviceIndex > supplyChangeoverIndex &&
            (device.supplyPath == null || device.supplyPath === 'serial')
          )
        })
        .sort((left, right) => {
          const leftIndex = supplyTrunkDevices.findIndex(
            (candidate) => candidate.id === left.device.id
          )
          const rightIndex = supplyTrunkDevices.findIndex(
            (candidate) => candidate.id === right.device.id
          )
          return rightIndex - leftIndex
        })
      const loadSideSerialCount = loadSideSerialPositions.length
      // Branch-only devices must never move the source selector or its load-side devices.
      const loadSideExpansion =
        loadSideSerialCount * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING +
        (loadSideSerialCount > 0 ? LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_LOAD_BOUNDARY_CLEARANCE : 0)
      // One grid-input protection fits on the existing rail-to-selector span. Further
      // protections extend that span, sharing any expansion already required by load-side devices.
      const gridInputExpansion =
        Math.max(0, changeoverGridDeviceCount - 1) * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
      changeoverDevicePosition.x =
        supplyBendX +
        LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING +
        Math.max(loadSideExpansion, gridInputExpansion)
      // Keep load-side devices anchored from the panel handoff. Their initial array-based
      // positions also count devices on the independent changeover input branches, which can
      // otherwise push a load protection into the selector instead of the visible output span.
      loadSideSerialPositions.forEach((position, index) => {
        position.x = supplyBendX + (index + 1) * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
        position.y = changeoverDevicePosition.y
      })
      const upperY = changeoverDevicePosition.y - changeoverLaneOffset
      const lowerY = changeoverDevicePosition.y + changeoverLaneOffset
      const elbowX =
        changeoverDevicePosition.x +
        LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE / 2 +
        LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_ELBOW_LEAD
      const converterX =
        elbowX +
        LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_SLOT_LENGTH +
        Math.max(backupOutputDeviceCount, converterGridInlineDeviceCount) *
          LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_BRANCH_DEVICE_SPACING
      const converterPosition = supplyDevicePositions.find(
        ({ device }) => device.supplyPath === 'backup'
      )
      if (converterPosition) {
        converterPosition.x = converterX
        converterPosition.y = upperY
        supplyDevicePositions
          .filter(({ device }) => device.supplyPath === 'converter-dc')
          .forEach((position, index) => {
            position.x = converterPosition.x + getSupplyConverterDcDeviceOffset(index)
            position.y = converterPosition.y
          })
        supplyDevicePositions
          .filter(({ device }) => device.supplyPath === 'converter-dc-top')
          .forEach((position, index) => {
            position.x = converterPosition.x + getSupplyConverterDcDeviceOffset(index)
            position.y = converterPosition.y - LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH
          })
      }

      const backupOutputPositions = supplyDevicePositions.filter(
        ({ device }) => device.supplyPath === 'backup-output'
      )
      backupOutputPositions.forEach((position, index) => {
        position.x =
          elbowX +
          LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_SLOT_LENGTH +
          index * LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_BRANCH_DEVICE_SPACING
        position.y = upperY
      })

      const changeoverGridPositions = supplyDevicePositions.filter(
        ({ device }) => device.supplyPath === 'changeover-grid'
      )
      changeoverGridPositions.forEach((position, index) => {
        position.x = groundX + (index + 1) * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
        position.y = lowerY
      })

      const converterGridPositions = supplyDevicePositions.filter(
        ({ device }) =>
          device.supplyPath === 'converter-grid' && device.converterGridPlacement !== 'input-leg'
      )
      converterGridPositions.forEach((position, index) => {
        position.x =
          elbowX +
          LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_SLOT_LENGTH +
          index * LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_BRANCH_DEVICE_SPACING
        position.y = lowerY
      })
      const converterGridInputLegPositions = supplyDevicePositions.filter(
        ({ device }) =>
          device.supplyPath === 'converter-grid' && device.converterGridPlacement === 'input-leg'
      )
      converterGridInputLegPositions.forEach((position, index) => {
        position.x = converterX
        position.y =
          upperY + ((index + 1) * (lowerY - upperY)) / (converterGridInputLegPositions.length + 1)
      })

      const sourceSerialPositions = supplyDevicePositions
        .filter((position) => {
          const deviceIndex = supplyTrunkDevices.findIndex(
            (candidate) => candidate.id === position.device.id
          )
          return (
            deviceIndex < supplyChangeoverIndex &&
            (position.device.supplyPath == null || position.device.supplyPath === 'serial')
          )
        })
        .sort((left, right) => {
          const leftIndex = supplyTrunkDevices.findIndex(
            (candidate) => candidate.id === left.device.id
          )
          const rightIndex = supplyTrunkDevices.findIndex(
            (candidate) => candidate.id === right.device.id
          )
          return rightIndex - leftIndex
        })
      const minimumSourceSerialX = converterX + LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
      sourceSerialPositions.forEach((position, index) => {
        position.x = minimumSourceSerialX + index * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
      })
    }
    if (hasDirectConverter) {
      const converterPosition = supplyDevicePositions.find(
        ({ device }) => device.supplyPath === 'converter-branch'
      )
      if (converterPosition) {
        const backupCircuitLayout = circuitLayouts.find(
          ({ circuit }) =>
            circuit.supplySource?.kind === 'converter-backup' &&
            circuit.supplySource.converterId === converterPosition.device.id
        )
        const backupBranches = backupCircuitLayout
          ? branches.filter((branch) => branch.circuitId === backupCircuitLayout.circuit.id)
          : []
        const backupHasPanelEndpoint =
          backupCircuitLayout?.circuit.endpoints.some(
            (endpoint) => endpoint.symbol === 'panel_distribution'
          ) === true || !!backupCircuitLayout?.protection?.subPanelId
        const backupEndpointLeadExpansion =
          LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING - LAYOUT_CONSTANTS.BRANCH_LEAD_IN
        const backupHorizontalWidth = backupCircuitLayout
          ? Math.max(
              ...backupBranches.map((branch) =>
                branch.endpoints.some((endpoint) => endpoint.symbol !== 'panel_distribution')
                  ? branch.branchWidth + backupEndpointLeadExpansion
                  : branch.branchWidth
              ),
              backupHasPanelEndpoint ? LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING : 0,
              0
            ) +
            LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
          : 0
        const converterArrayIndex = supplyTrunkDevices.findIndex(
          (device) => device.id === converterPosition.device.id
        )
        const lowerSerialPositions = supplyDevicePositions.filter(
          ({ device }) => device.supplyPath == null || device.supplyPath === 'serial'
        )
        const sourceSerialPositions = lowerSerialPositions.filter(
          ({ device }) =>
            supplyTrunkDevices.findIndex((candidate) => candidate.id === device.id) <
            converterArrayIndex
        )
        const loadSerialPositions = lowerSerialPositions.filter(
          ({ device }) =>
            supplyTrunkDevices.findIndex((candidate) => candidate.id === device.id) >
            converterArrayIndex
        )
        const busSideDeviceClearance =
          LAYOUT_CONSTANTS.SUPPLY_DIRECT_CONVERTER_BACKUP_LEFT_CLEARANCE +
          LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 +
          (LAYOUT_CONSTANTS.SUPPLY_DIRECT_CONVERTER_PROTECTION_SPACING -
            LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING)
        const directGridPositions = supplyDevicePositions.filter(
          ({ device }) =>
            device.supplyPath === 'converter-grid' && device.converterGridPlacement !== 'input-leg'
        )
        const directGridInputLegPositions = supplyDevicePositions.filter(
          ({ device }) =>
            device.supplyPath === 'converter-grid' && device.converterGridPlacement === 'input-leg'
        )
        const lowerLanePositions = [...loadSerialPositions, ...directGridPositions].sort(
          (left, right) => {
            const leftIndex = supplyTrunkDevices.findIndex(
              (candidate) => candidate.id === left.device.id
            )
            const rightIndex = supplyTrunkDevices.findIndex(
              (candidate) => candidate.id === right.device.id
            )
            return leftIndex - rightIndex
          }
        )
        const lowerGridDeviceCount = lowerLanePositions.length
        const lowerLaneWidth =
          lowerGridDeviceCount > 0
            ? lowerGridDeviceCount * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING + busSideDeviceClearance
            : LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
        const upperBackupLaneWidth = backupCircuitLayout
          ? LAYOUT_CONSTANTS.SUPPLY_DIRECT_CONVERTER_PROTECTION_SPACING +
            backupHorizontalWidth +
            LAYOUT_CONSTANTS.SUPPLY_DIRECT_CONVERTER_BACKUP_LEFT_CLEARANCE
          : 0
        // The lower supply lane and upper backup lane run in parallel. Reserve
        // whichever lane is wider; lower-lane devices share the same physical run.
        converterPosition.x = supplyBendX + Math.max(lowerLaneWidth, upperBackupLaneWidth)
        sourceSerialPositions.forEach((position, index) => {
          position.x =
            converterPosition.x +
            (sourceSerialPositions.length - index) * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
        })
        lowerLanePositions.forEach((position, index) => {
          position.x =
            converterPosition.x -
            (lowerLanePositions.length - index) * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
        })
        converterPosition.y = supplyY
        directGridPositions.forEach((position) => {
          position.y = supplySourceY
        })
        directGridInputLegPositions.forEach((position, index) => {
          position.x = converterPosition.x
          position.y =
            converterPosition.y +
            ((index + 1) * (supplySourceY - converterPosition.y)) /
              (directGridInputLegPositions.length + 1)
        })
        supplyDevicePositions
          .filter(({ device }) => device.supplyPath === 'converter-dc')
          .forEach((position, index) => {
            position.x = converterPosition.x + getSupplyConverterDcDeviceOffset(index)
            position.y = converterPosition.y
          })
        supplyDevicePositions
          .filter(({ device }) => device.supplyPath === 'converter-dc-top')
          .forEach((position, index) => {
            position.x = converterPosition.x + getSupplyConverterDcDeviceOffset(index)
            position.y = converterPosition.y - LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH
          })

        const converterLeftX = converterPosition.x - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        const protectionX =
          converterPosition.x - LAYOUT_CONSTANTS.SUPPLY_DIRECT_CONVERTER_PROTECTION_SPACING
        if (backupCircuitLayout) {
          backupCircuitLayout.x =
            protectionX - getProtectionAnchorOffset(backupCircuitLayout.leftReserve)
          backupCircuitLayout.protectionY = converterPosition.y
          backupBranches.forEach((branch) => {
            if (branch.endpoints.some((endpoint) => endpoint.symbol !== 'panel_distribution')) {
              branch.branchWidth += backupEndpointLeadExpansion
            }
            if (backupHasPanelEndpoint) {
              branch.branchWidth = Math.max(
                branch.branchWidth,
                LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
              )
            }
            branch.trunkX = protectionX
            branch.trunkY = converterPosition.y
            branch.branchX = protectionX - branch.branchWidth
            branch.branchY = converterPosition.y
          })
          directConverterBackup = {
            converterId: converterPosition.device.id,
            x1: protectionX,
            x2: converterLeftX,
            y: converterPosition.y,
            circuitId: backupCircuitLayout.circuit.id,
            protectionId: backupCircuitLayout.protection?.id,
          }
        } else {
          directConverterBackup = {
            converterId: converterPosition.device.id,
            x1: converterPosition.x - LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH,
            x2: converterLeftX,
            y: converterPosition.y,
          }
        }
      }
    }
    // Supply symbol is right of the first device (index 0 = supply side)
    const lowerSupplyPositions = hasDirectConverter
      ? supplyDevicePositions.filter(
          ({ device }) =>
            device.supplyPath !== 'converter-branch' &&
            device.supplyPath !== 'converter-dc' &&
            device.supplyPath !== 'converter-dc-top' &&
            device.supplyPath !== 'converter-grid'
        )
      : hasSupplyChangeover
        ? supplyDevicePositions.filter(
            ({ device }) =>
              device.supplyPath == null ||
              device.supplyPath === 'serial' ||
              device.supplyPath === 'backup'
          )
        : supplyDevicePositions
    const lowerSupplyRightmostX =
      lowerSupplyPositions.length > 0
        ? Math.max(...lowerSupplyPositions.map((position) => position.x))
        : supplyBendX
    supplyX =
      lowerSupplyRightmostX +
      (hasSupplyChangeover
        ? LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_GRID_SOURCE_LEAD
        : LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING)
    if (hasDirectConverter) {
      const isolatedConverter = supplyDevicePositions.find(
        ({ device }) =>
          device.supplyPath === 'converter-branch' && device.converterGridInputConnected === false
      )
      if (isolatedConverter) {
        // The disconnected converter no longer contributes a vertical grid-input leg, but it
        // remains a waypoint in the split-feed drawing. Keep the source endpoint beyond its
        // expanded backup lane so the lower wire cannot continue through the supply symbol.
        supplyX = Math.max(supplyX, isolatedConverter.x + LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING)
      }
    }
  } else if (!isSubPanel) {
    // Minimum horizontal run before the supply symbol when the trunk is empty so the
    // diagram does not collapse (stable dashed separator, drop targets, and export).
    supplyX += LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
  }

  // Calculate the rightmost extent of the supply wire (for frame width)
  // Supply is always the rightmost element (either at bend point with no devices, or after all devices)
  const changeoverPosition = supplyDevicePositions.find(
    ({ device }) => device.symbol === 'source_changeover'
  )
  const usesInlineEmptySplitRails =
    !options.feedOutput && hasExplicitPanelBusSections(panel) && !panelHasMainBusProtection(panel)
  const renderedMainBusY =
    mainBusY + (usesInlineEmptySplitRails ? LAYOUT_CONSTANTS.INLINE_EMPTY_SPLIT_RAIL_DROP : 0)
  const usesSplitSupplyGround =
    (options.feedOutput === true || usesInlineEmptySplitRails) &&
    (panel.busSections?.length ?? 0) > 1
  const renderedGroundY = usesSplitSupplyGround
    ? supplySourceY + LAYOUT_CONSTANTS.SUPPLY_VERTICAL_DROP
    : groundY
  const renderedGroundDevicePositions = usesSplitSupplyGround
    ? groundTrunkDevices.map((device, index) => ({
        device,
        x: groundX,
        y:
          renderedGroundY -
          ((index + 1) * (renderedGroundY - supplySourceY)) / (groundTrunkDevices.length + 1),
      }))
    : groundDevicePositions
  const changeoverSlotEndX = changeoverPosition
    ? changeoverPosition.x +
      LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE / 2 +
      LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_ELBOW_LEAD +
      LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_SLOT_LENGTH +
      Math.max(backupOutputDeviceCount, changeoverGridDeviceCount) *
        LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_BRANCH_DEVICE_SPACING
    : undefined
  if (changeoverSlotEndX != null) {
    supplyX = Math.max(supplyX, changeoverSlotEndX + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2)
  }
  if (options.feedOutput) {
    // Keep the normal source-side lead length in the detached feed frame.
    // Right-edge breathing room belongs to the frame, not to compressed content geometry.
    supplyX += 36
  }
  const converterRightExtent =
    hasDirectConverter || hasSupplyChangeover
      ? Math.max(
          ...supplyDevicePositions.map(({ x }) => x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2),
          Number.NEGATIVE_INFINITY
        )
      : Number.NEGATIVE_INFINITY
  const supplyRightExtent = Math.max(
    supplyX + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
    changeoverSlotEndX ?? Number.NEGATIVE_INFINITY,
    converterRightExtent
  )

  // maxY must account for the supply/ground position
  maxY = Math.max(maxY, supplySourceY + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2)
  if (usesSplitSupplyGround) {
    maxY = Math.max(maxY, renderedGroundY + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2)
  }
  if (options.supplyEndpointKind === 'continuation') {
    maxY = Math.max(maxY, supplySourceY + 24)
  }

  // Supply-chain protections on the horizontal trunk render `ProtectionOneWireLabels` below
  // the symbol (see TrunkDeviceSymbol). Layout previously stopped at symbol half-height only,
  // so technical labels and wire captions clipped past the panel frame on large boards.
  const hasSupplyProtectionBottomLabels =
    !isSubPanel &&
    supplyTrunkDevices.some((d) => {
      if (d.type !== 'protection') return false
      const pos = d.symbolLabelDisplay?.position ?? 'bottom'
      return pos === 'bottom'
    })
  /** Matches order-of-magnitude height used by SymbolTextLabels / ProtectionOneWireLabels under the symbol. */
  // Four-line residual-current labels reach just past the previous reserve.
  // Keep a small breathing gap before the detached frame's info block.
  const SUPPLY_HORIZONTAL_PROTECTION_LABEL_CLEARANCE = 60
  if (hasSupplyProtectionBottomLabels) {
    maxY = Math.max(
      maxY,
      supplyY + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 + SUPPLY_HORIZONTAL_PROTECTION_LABEL_CLEARANCE
    )
  }

  // Sub-panels: keep frame bottom in sync with layoutTree parent-MCB anchor + feeder labels
  // (see getSubPanelIncomingFeedLabelAnchors / buildPanelNode in layoutTree.ts).
  if (isSubPanel && parentMcbInfo) {
    const MIN_SUBPANEL_INCOMING_SEGMENT_LENGTH = 60 // keep in sync with layoutTree.ts export
    const SUBPANEL_FEED_PARENT_TAG_Y = 28 // keep in sync with layoutTree.ts export
    const SUBPANEL_FEED_LABEL_HEIGHT = 20
    const parentMcbAnchorY = Math.max(supplyY, mainBusY + MIN_SUBPANEL_INCOMING_SEGMENT_LENGTH * 2)
    maxY = Math.max(
      maxY,
      parentMcbAnchorY + SUBPANEL_FEED_PARENT_TAG_Y + SUBPANEL_FEED_LABEL_HEIGHT
    )
  }

  // Total height is from top (minY, lowest number) to bottom (frameBottomY, highest number).
  // Use max(maxY, baseline) so we never shrink the content box below the true bottom extent
  // (sub-panels used to use Math.min and truncated below the mirrored parent MCB / labels).
  const FRAME_BASELINE_Y =
    mainBusY + LAYOUT_CONSTANTS.SUPPLY_VERTICAL_DROP + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
  const frameBottomY = Math.max(FRAME_BASELINE_Y, maxY)

  const FRAME_TOP_MARGIN = 40

  // Build layout elements
  const elements: BottomUpLayoutElement[] = []

  // Ground - only show for main panels when hasGround is true
  if (hasGround) {
    elements.push({
      id: 'ground',
      type: 'ground',
      position: { x: groundX, y: renderedGroundY }, // LOCAL coordinates
    })

    // Ground trunk device elements
    renderedGroundDevicePositions.forEach(({ device, x, y }) => {
      elements.push({
        id: `groundTrunkDevice-${device.id}`,
        type: 'trunkDevice',
        position: { x, y }, // LOCAL coordinates
        trunkDeviceId: device.id,
        label: device.label,
      })
    })
  }

  // Supply - only show for main panels, not sub-panels
  if (!isSubPanel) {
    elements.push({
      id: 'supply',
      type: 'supply',
      position: { x: supplyX, y: supplySourceY }, // LOCAL coordinates
    })
    if (options.supplyEndpointKind === 'continuation') {
      elements.push({
        id: 'supply-continuation-label',
        type: 'label',
        position: { x: supplyBendX + 34, y: supplySourceY - 8 },
        translationKey: 'canvas.supplyFrame.supplyLabel',
      })
    }

    // Supply trunk device elements
    supplyDevicePositions.forEach(({ device, x, y }) => {
      elements.push({
        id: `supplyTrunkDevice-${device.id}`,
        type: 'trunkDevice',
        position: { x, y }, // LOCAL coordinates
        trunkDeviceId: device.id,
        label: device.label,
      })
    })
  } else {
    // For sub-panels, show the parent MCB symbol instead of supply
    // Position it where supply would be (at the bottom)
    if (parentMcbInfo) {
      elements.push({
        id: 'parent-mcb',
        type: 'protection',
        position: { x: supplyX, y: supplyY }, // LOCAL coordinates
        protectionId: parentMcbInfo.protection.id,
        circuitId: parentMcbInfo.circuit.id,
      })

      const upstreamProtectionLabel = (parentMcbInfo.protection.label ?? '').trim()
      if (upstreamProtectionLabel) {
        elements.push({
          id: 'parent-mcb-label',
          type: 'label',
          position: {
            x: supplyX,
            y: supplyY,
          },
          label: `← ${upstreamProtectionLabel}`,
          circuitId: parentMcbInfo.circuit.id,
        })
      }
    }
  }

  // Main bus — account for supply wire extent in width
  const mainBusWidthWithSupply = Math.max(
    mainBusWidth,
    supplyRightExtent - mainBusX + LAYOUT_CONSTANTS.CIRCUIT_PADDING
  )
  const compactSupplyRailWidth = Math.max(groundX, supplyBendX) - mainBusX + 15
  const renderedMainBusWidth =
    options.feedOutput || usesInlineEmptySplitRails
      ? compactSupplyRailWidth
      : mainBusWidthWithSupply
  elements.push({
    id: `mainBus-${panel.id}`,
    type: 'mainBus',
    position: { x: mainBusX, y: renderedMainBusY }, // LOCAL coordinates
    width: renderedMainBusWidth,
    height: LAYOUT_CONSTANTS.BUS_THICKNESS,
  })
  if (options.feedOutput) {
    elements.push({
      id: 'feed-output-label',
      type: 'label',
      position: {
        x: mainBusX + renderedMainBusWidth / 2,
        // CircuitLabel renders from y - 7 with an 11 px font, so this leaves
        // roughly four pixels between the visible text bottom and the bus.
        y: mainBusY - 10,
      },
      label: panel.name,
    })
  }

  // Precompute circuit notes positions: reserve a slot for every circuit with notes (ignore notesVisible so layout is stable)
  // Notes are stacked per vertical trunk and must sit above the *entire* circuit tree:
  // parent circuit + all nested sub‑circuits that hang from the same trunk / secondary bus.
  // Horizontal notes are rendered as a single text line (~14px). Use a tight slot height
  // so stacked notes behave like a normal line break (small gap, no huge whitespace).
  // Vertical/rotated behavior is a render/export concern, but we still pass through
  // the global orientation flag so the view layer can decide how to draw. We keep
  // a single slot height so positioning stays stable regardless of orientation.
  const NOTES_ROW_HEIGHT = 8
  const notesPositionMap = new Map<
    string,
    {
      x: number
      y: number
      label: string
      notesOrientation: 'horizontal' | 'vertical'
      notesVisible: boolean
    }
  >()
  let circuitNotesLocal: Array<{
    circuitId: string
    x: number
    y: number
    label: string
    notesOrientation: 'horizontal' | 'vertical'
    notesVisible: boolean
  }> = []
  {
    // Index layouts and sub‑circuit relationships so we can compute a "top Y" per circuit.
    // IMPORTANT: We do this per-column (trunkX), so a tall subcircuit in a different
    // secondary-bus column does not push parent/sibling notes further up.
    const layoutByCircuitId = new Map<string, (typeof circuitLayouts)[number]>()
    for (const cl of circuitLayouts) {
      layoutByCircuitId.set(cl.circuit.id, cl)
    }

    const childrenByCircuitId = new Map<string, string[]>()
    for (const cl of circuitLayouts) {
      const subIds = cl.circuit.subCircuitIds ?? []
      if (subIds.length === 0) continue
      childrenByCircuitId.set(cl.circuit.id, [
        ...(childrenByCircuitId.get(cl.circuit.id) ?? []),
        ...subIds,
      ])
    }

    // Precompute a column key (rounded trunkX) for each circuit so recursion can be column-aware.
    const columnKeyByCircuitId = new Map<string, number>()

    const computeTrunkX = (cl: (typeof circuitLayouts)[number]): number => {
      const circuitBranches = branches.filter((b) => b.circuitId === cl.circuit.id)
      const topmostBranch =
        circuitBranches.length > 0
          ? circuitBranches.reduce((top, branch) => (branch.branchY < top.branchY ? branch : top))
          : null

      if (topmostBranch) {
        return topmostBranch.trunkX
      }

      if (cl.parentRcd) {
        const trunk = trunks.find((t) => t.protectionId === cl.parentRcd!.id)
        if (trunk) {
          return trunk.x + trunk.width / 2
        }
        return cl.x + cl.width / 2
      }

      return cl.x + cl.width / 2
    }

    for (const cl of circuitLayouts) {
      columnKeyByCircuitId.set(cl.circuit.id, Math.round(computeTrunkX(cl)))
    }

    const circuitTopYInColumnCache = new Map<string, number>()

    const computeOwnTopY = (cl: (typeof circuitLayouts)[number]): number => {
      const circuitBranches = branches.filter((b) => b.circuitId === cl.circuit.id)

      // No branches: use the top of the "free" trunk wire above the MCB so spacing
      // matches circuits that *do* have branches (whose first branch sits at roughly
      // MCB - BRANCH_START_OFFSET).
      const mcbY = cl.parentRcd
        ? (trunks.find((t) => t.protectionId === cl.parentRcd!.id)?.y ??
            mainBusY - LAYOUT_CONSTANTS.RCD_TRUNK_OFFSET) - LAYOUT_CONSTANTS.MCB_Y_OFFSET
        : mainBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET

      const hasSubPanelAtLineEnd = !!cl.protection?.subPanelId
      return getCircuitLineTopY(circuitBranches, mcbY, hasSubPanelAtLineEnd)
    }

    const getCircuitTopYInColumn = (circuitId: string): number => {
      const cached = circuitTopYInColumnCache.get(circuitId)
      if (cached != null) return cached

      const cl = layoutByCircuitId.get(circuitId)
      if (!cl) {
        // Should not happen, but keep layout robust.
        const fallback = mainBusY
        circuitTopYInColumnCache.set(circuitId, fallback)
        return fallback
      }

      let topY = computeOwnTopY(cl)
      const myKey = columnKeyByCircuitId.get(circuitId)

      const childIds = childrenByCircuitId.get(circuitId) ?? []
      for (const childId of childIds) {
        // Only consider descendants that live in the SAME column (same trunkX key).
        if (myKey != null && columnKeyByCircuitId.get(childId) !== myKey) continue
        const childTopY = getCircuitTopYInColumn(childId)
        topY = Math.min(topY, childTopY)
      }

      circuitTopYInColumnCache.set(circuitId, topY)
      return topY
    }

    const pendingNotes: Array<{
      circuitId: string
      trunkX: number
      topY: number
      label: string
      notesOrientation: 'horizontal' | 'vertical'
      notesVisible: boolean
    }> = []

    const globalOrientation: 'horizontal' | 'vertical' =
      installation?.circuitNotesOrientation ?? 'horizontal'

    for (const cl of circuitLayouts) {
      if (!cl.circuit.notes?.trim()) continue

      const trunkX = computeTrunkX(cl)
      const topY = getCircuitTopYInColumn(cl.circuit.id)

      pendingNotes.push({
        circuitId: cl.circuit.id,
        trunkX,
        topY,
        label: cl.circuit.notes.trim(),
        // Pass through global orientation so render/export can choose horizontal vs vertical.
        // Positioning uses a single NOTES_ROW_HEIGHT, independent of this flag.
        notesOrientation: globalOrientation,
        notesVisible: cl.circuit.notesVisible !== false,
      })
    }

    const byTrunkX = new Map<number, typeof pendingNotes>()
    for (const n of pendingNotes) {
      const key = Math.round(n.trunkX)
      if (!byTrunkX.has(key)) byTrunkX.set(key, [])
      byTrunkX.get(key)!.push(n)
    }

    for (const group of byTrunkX.values()) {
      // Circuits that start higher on screen (smaller Y) conceptually own more
      // vertical space; sort by their subtree top and then stack upwards.
      group.sort((a, b) => a.topY - b.topY)

      // When notes are horizontal we stack them vertically (different Y, same X).
      // When notes are vertical we keep Y fixed for the whole group and space them
      // out horizontally along X instead, using the same slot height as spacing.
      const groupOrientation = group[0]?.notesOrientation ?? 'horizontal'
      const slotHeight = NOTES_ROW_HEIGHT

      if (groupOrientation === 'vertical') {
        let nextX = Infinity
        for (const n of group) {
          const desiredY = n.topY - 20
          const desiredX = n.trunkX + ((group.length - 1) * slotHeight) / 2
          const notesX = Math.min(desiredX, nextX - slotHeight)
          nextX = notesX
          notesPositionMap.set(n.circuitId, {
            x: notesX,
            y: desiredY,
            label: n.label,
            notesOrientation: n.notesOrientation,
            notesVisible: n.notesVisible,
          })
        }
      } else {
        let nextY = Infinity
        for (const n of group) {
          const desiredY = n.topY - 25
          const notesY = Math.min(desiredY, nextY - slotHeight)
          nextY = notesY
          notesPositionMap.set(n.circuitId, {
            x: n.trunkX,
            y: notesY,
            label: n.label,
            notesOrientation: n.notesOrientation,
            notesVisible: n.notesVisible,
          })
        }
      }
    }

    // Materialize once so consumers don't depend on elements array shape/order.
    // notesPositionMap.y stores the TOP of the reserved slot; convert to visual
    // center here so both horizontal and vertical renderers can rotate around
    // the true box center.
    circuitNotesLocal = Array.from(notesPositionMap.entries()).map(([circuitId, pos]) => {
      const slotHeight = NOTES_ROW_HEIGHT
      const centerY = pos.y + slotHeight / 2
      return {
        circuitId,
        x: pos.x,
        y: centerY,
        label: pos.label,
        notesOrientation: pos.notesOrientation,
        notesVisible: pos.notesVisible,
      }
    })
  }

  // Ensure the panel frame includes circuit notes (they sit above circuits).
  if (circuitNotesLocal.length > 0) {
    const NOTES_FRAME_MARGIN = 8
    for (const note of circuitNotesLocal) {
      if (!note.notesVisible) continue
      // Keep this in sync with CircuitNotesLabel sizing assumptions:
      // - horizontal: text height ~14 (lineHeight), center-based layout
      // - vertical: rotated text height ~estimated width of the line
      const estWidth = estimateCircuitNotesWidth(note.label)
      const lineHeight = 14

      let boxTopY: number
      if (note.notesOrientation === 'vertical') {
        // In vertical mode we shift the group up by estWidth / 2 and the rotated
        // height is ~estWidth. Give extra safety margin so export slices never
        // clip the label at the top.
        const extraMargin = 20
        boxTopY = note.y - estWidth - extraMargin
      } else {
        const boxHalfHeight = lineHeight / 2
        boxTopY = note.y - boxHalfHeight
      }

      minY = Math.min(minY, boxTopY - NOTES_FRAME_MARGIN)
    }
  }

  // Protection devices and circuits
  circuitLayouts.forEach((cl) => {
    // Skip nested circuits for main processing - they'll be handled separately
    if (cl.parentCircuit) {
      // Nested circuit protection - positioned on parent's vertical wire or secondary bus
      if (cl.protection) {
        // Find parent circuit layout
        const parentLayout = circuitLayouts.find((pcl) => pcl.circuit.id === cl.parentCircuit!.id)
        if (parentLayout) {
          // Find all nested circuits for this parent
          const allNestedForParent = circuitLayouts.filter(
            (ncl) => ncl.parentCircuit && ncl.parentCircuit.id === cl.parentCircuit!.id
          )

          // Calculate nested MCB Y position - place at exact end of parent's wire
          // Find the topmost branch of the parent circuit (lowest Y = highest on screen = wire end)
          const parentBranches = branches.filter((b) => b.circuitId === parentLayout.circuit.id)
          let mcbY: number

          const parentHasEndpointBranches = parentBranches.some((b) => b.endpoints.length > 0)
          if (parentHasEndpointBranches && parentLayout.secondaryBusY != null) {
            mcbY = parentLayout.secondaryBusY
          } else if (parentBranches.length > 0) {
            // Parent has branches - wire ends at the topmost branch (lowest Y value)
            const topmostParentBranch = parentBranches.reduce((top, b) =>
              b.branchY < top.branchY ? b : top
            )
            mcbY = topmostParentBranch.branchY // Position at exact wire end
          } else {
            // Parent has no branches - wire ends at parent MCB position
            mcbY = mainBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET
          }

          // Determine MCB X position
          let mcbX: number

          // Always offset MCB from the virtual secondary bus so wire insets
          // can determine direction and create proper gaps around the symbol.
          mcbY = mcbY - LAYOUT_CONSTANTS.MCB_Y_OFFSET

          if (allNestedForParent.length === 1) {
            // ONE nested circuit: draw directly on parent's vertical wire (same X as parent)
            mcbX = parentLayout.x + getProtectionAnchorOffset(parentLayout.leftReserve)
          } else if (allNestedForParent.length > 1) {
            // MULTIPLE nested circuits: position on secondary bus bar with vertical lines
            // Use nested circuit's own X position (positioned horizontally on secondary bus)
            mcbX = cl.x + getProtectionAnchorOffset(cl.leftReserve)
          } else {
            // No nested circuits (shouldn't happen, but handle gracefully)
            mcbX = parentLayout.x + getProtectionAnchorOffset(parentLayout.leftReserve)
          }

          // Update protectionY to actual MCB position for correct tree-building
          cl.protectionY = mcbY

          // Keep the protection element as a topology/wire anchor even for panel-only feeders.
          // Rendering suppresses the visible protection symbol in that case, but deriveWires still
          // needs an MCB node to connect secondary buses and panel symbols correctly.
          const protection = cl.protection
          const isPanelOnlyFeeder = isPanelOnlySubPanelFeeder(protection, cl.circuit)
          const sameProtectionAsParent =
            !!parentLayout.protection &&
            !!protection &&
            parentLayout.protection.id === protection.id

          if (protection && isPanelOnlyFeeder && sameProtectionAsParent) {
            const nestElId = `protection-${protection.id}-nest-${cl.circuit.id}`
            if (!elements.find((e) => e.id === nestElId)) {
              elements.push({
                id: nestElId,
                type: 'protection',
                position: {
                  x: mcbX,
                  y: mcbY,
                },
                protectionId: protection.id,
                circuitId: cl.circuit.id,
              })
            }
          } else if (protection && !elements.find((e) => e.id === `protection-${protection.id}`)) {
            elements.push({
              id: `protection-${protection.id}`,
              type: 'protection',
              position: {
                x: mcbX, // LOCAL coordinates
                y: mcbY,
              },
              protectionId: protection.id,
              circuitId: cl.circuit.id,
            })
          }

          // Secondary bus bar is now created as a wire segment in deriveWires.ts
          // No need to create it as an element here

          // Add circuit label for nested circuits (including panel-only sub-panel feeders).
          const nestedLabel = (protection?.label ?? '').trim()
          const nestedLetterVisible = cl.circuit.eendraadLetterVisible !== false
          if (
            protection &&
            nestedLabel &&
            nestedLetterVisible &&
            !elements.find((e) => e.id === `label-${cl.circuit.id}`)
          ) {
            elements.push({
              id: `label-${cl.circuit.id}`,
              type: 'label',
              position: {
                x: mcbX + getProtectionLabelXOffset(protection), // LOCAL coordinates
                y: mcbY + getProtectionLabelYOffset(protection),
              },
              circuitId: cl.circuit.id,
              label: nestedLabel,
            })
          }
        }
      }

      // Create branch and endpoint visual elements for nested circuits
      // (same as for top-level circuits, so nested circuits get visible wires and drop targets)
      const nestedCircuitBranches = branches.filter((b) => b.circuitId === cl.circuit.id)

      nestedCircuitBranches.forEach((branch) => {
        // Branch visual element
        const firstEndpoint = branch.endpoints[0]
        const hasSwitches = firstEndpoint?.type === 'switch'
        const branchVisualX = hasSwitches
          ? branch.branchX + LAYOUT_CONSTANTS.BRANCH_LEAD_IN
          : branch.branchX
        const branchVisualWidth = hasSwitches
          ? branch.branchWidth - LAYOUT_CONSTANTS.BRANCH_LEAD_IN
          : branch.branchWidth

        elements.push({
          id: `branch-visual-${branch.id}`,
          type: 'branch',
          position: {
            x: branchVisualX, // LOCAL coordinates
            y: branch.branchY,
          },
          width: branchVisualWidth,
          height: LAYOUT_CONSTANTS.BRANCH_LINE_WIDTH,
          branchId: branch.id,
          circuitId: cl.circuit.id,
        })

        // Endpoint elements on this branch (with appliance-after-socket gap)
        const nestedOffsets = getEndpointXOffsets(
          branch.endpoints,
          LAYOUT_CONSTANTS.BRANCH_LEAD_IN,
          LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
          LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP
        )
        const nestedDomoticaParent = branch.endpoints.find(
          (ep) => ep.symbol === 'domotica' && !ep.domoticaChildProps
        )
        const nestedDomoticaParentIndex = nestedDomoticaParent
          ? branch.endpoints.indexOf(nestedDomoticaParent)
          : -1
        const nestedDomoticaCount = nestedDomoticaParent
          ? Math.max(
              DOMOTICA_MIN_ENDPOINT_OUTPUTS,
              Math.min(
                DOMOTICA_MAX_ENDPOINT_OUTPUTS,
                Math.trunc(
                  nestedDomoticaParent.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS
                )
              )
            )
          : 0
        const nestedDomoticaVariableHeight =
          Math.max(0, nestedDomoticaCount - 1) * DOMOTICA_OUTPUT_SPACING
        const nestedFirstOutputY = nestedDomoticaParent
          ? branch.branchY - nestedDomoticaVariableHeight
          : branch.branchY
        const nestedDomoticaParentXOffset =
          nestedDomoticaParentIndex >= 0
            ? (nestedOffsets[nestedDomoticaParentIndex] ?? LAYOUT_CONSTANTS.BRANCH_LEAD_IN)
            : LAYOUT_CONSTANTS.BRANCH_LEAD_IN
        const nestedDomoticaChildX =
          branch.branchX +
          nestedDomoticaParentXOffset +
          DOMOTICA_BOX_WIDTH / 2 +
          DOMOTICA_BRANCH_LEAD
        branch.endpoints.forEach((endpoint, index) => {
          const endpointX = endpoint.domoticaChildProps
            ? nestedDomoticaChildX +
              getDomoticaRowChainIndex(branch.endpoints, endpoint) *
                LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING
            : branch.branchX + (nestedOffsets[index] ?? 0)
          let endpointY = branch.branchY
          if (
            (endpoint.domoticaChildProps?.outputGroup === 'endpoint' ||
              endpoint.domoticaChildProps?.outputGroup === 'control') &&
            typeof endpoint.domoticaChildProps.outputIndex === 'number'
          ) {
            endpointY =
              nestedFirstOutputY + endpoint.domoticaChildProps.outputIndex * DOMOTICA_OUTPUT_SPACING
          }
          elements.push({
            id: `endpoint-${endpoint.id}`,
            type: 'endpoint',
            position: {
              x: endpointX,
              y: endpointY,
            },
            endpointId: endpoint.id,
            circuitId: cl.circuit.id,
          })
        })

        // Branch label — read from branch.label (source of truth).
        // Only show when non-empty, so circuits with endpoints but no explicit
        // branch label don't leak the raw circuit code as a label.
        if (branch.endpoints.length > 0) {
          const labelText = (branch.label ?? '').trim()
          if (!labelText) return
          elements.push({
            id: `branch-label-${branch.id}`,
            type: 'label',
            position: {
              x: branch.branchX - LAYOUT_CONSTANTS.LABEL_OFFSET, // LOCAL coordinates
              y: branch.branchY,
            },
            label: labelText,
            branchId: branch.id,
            circuitId: cl.circuit.id,
          })
        }
      })

      // Trunk devices for nested circuit - positioned on vertical wire between MCB and branches
      const nestedTrunkDevices = cl.circuit.trunkDevices || []
      if (nestedTrunkDevices.length > 0) {
        // Find parent circuit layout to calculate MCB position
        const parentLayout = circuitLayouts.find((pcl) => pcl.circuit.id === cl.parentCircuit!.id)
        if (!parentLayout) return // Can't position trunk devices without parent

        // Find all nested circuits for this parent
        const allNestedForParent = circuitLayouts.filter(
          (ncl) => ncl.parentCircuit && ncl.parentCircuit.id === cl.parentCircuit!.id
        )

        // Calculate nested MCB Y position
        const parentBranches = branches.filter((b) => b.circuitId === parentLayout.circuit.id)
        let mcbY: number

        const parentHasEndpointBranchesForDevices = parentBranches.some(
          (b) => b.endpoints.length > 0
        )
        if (parentHasEndpointBranchesForDevices && parentLayout.secondaryBusY != null) {
          mcbY = parentLayout.secondaryBusY
        } else if (parentBranches.length > 0) {
          const topmostParentBranch = parentBranches.reduce((top, b) =>
            b.branchY < top.branchY ? b : top
          )
          mcbY = topmostParentBranch.branchY
        } else {
          mcbY = mainBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET
        }

        // Determine MCB X position
        let mcbX: number

        // Always offset MCB from virtual secondary bus (consistent with element creation above)
        mcbY = mcbY - LAYOUT_CONSTANTS.MCB_Y_OFFSET

        if (allNestedForParent.length === 1) {
          mcbX = parentLayout.x + getProtectionAnchorOffset(parentLayout.leftReserve)
        } else if (allNestedForParent.length > 1) {
          mcbX = cl.x + getProtectionAnchorOffset(cl.leftReserve)
        } else {
          mcbX = parentLayout.x + getProtectionAnchorOffset(parentLayout.leftReserve)
        }

        const deviceX = mcbX // Same X as nested MCB (vertical wire center)

        // Calculate MCB Y position for trunk device positioning
        const mcbYForDevices = mcbY

        // Group trunk devices by position for layout
        nestedTrunkDevices.forEach((device) => {
          let deviceY: number

          if (device.trunkPosition === 0) {
            // Before all branches: position between MCB and first branch
            const devicesAtPos0Before = nestedTrunkDevices
              .filter((d) => d.trunkPosition === 0)
              .indexOf(device)
            deviceY =
              mcbYForDevices -
              LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP -
              devicesAtPos0Before *
                (LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING + LAYOUT_CONSTANTS.SYMBOL_SIZE)
          } else {
            // Between branches: position between branch (trunkPosition-1) and branch (trunkPosition)
            const circuitBranchesLocal = nestedCircuitBranches
            const branchAbove = circuitBranchesLocal[device.trunkPosition - 1]
            const branchBelow = circuitBranchesLocal[device.trunkPosition]

            if (branchAbove && branchBelow) {
              // Midpoint between the two branches
              deviceY = (branchAbove.branchY + branchBelow.branchY) / 2
            } else if (branchAbove) {
              // After all branches (top-most): keep full spacing above branch,
              // then stack additional devices further up.
              const devicesAtSamePosBefore = nestedTrunkDevices
                .filter((d) => d.trunkPosition === device.trunkPosition)
                .indexOf(device)
              deviceY =
                branchAbove.branchY -
                LAYOUT_CONSTANTS.BRANCH_START_OFFSET -
                devicesAtSamePosBefore *
                  (LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING + LAYOUT_CONSTANTS.SYMBOL_SIZE)
            } else {
              // Fallback
              deviceY = mcbYForDevices - LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP
            }
          }

          elements.push({
            id: `trunkDevice-${device.id}`,
            type: 'trunkDevice',
            position: {
              x: deviceX, // LOCAL coordinates
              y: deviceY,
            },
            trunkDeviceId: device.id,
            circuitId: cl.circuit.id,
            label: device.label,
          })
        })
      }

      return
    }

    // Protection device (sits on vertical branch slightly up from main bus)
    // All protection types (MCB, RCD, RCBO, FUSE, etc.) that directly protect a circuit are positioned identically.
    //
    // Decide display label once:
    // - For circuits under a protection device: use the protection's label (can be empty).
    // - For direct circuits (no protection): use circuit.code.
    const displayLabel = cl.protection
      ? (cl.protection.label ?? '').trim()
      : (cl.circuit.code ?? '').trim()

    if (cl.protection) {
      // Protection position: on vertical branch, slightly up from main bus (LOCAL coordinates)
      // IMPORTANT: protection must be at the same X as branchX (protection center), not circuit center
      // This ensures the vertical wire and horizontal branch align correctly
      const mcbY =
        cl.circuit.supplySource?.kind === 'converter-backup'
          ? cl.protectionY
          : mainBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET
      const mcbX = cl.x + getProtectionAnchorOffset(cl.leftReserve) // Protection center, matches branchX

      // Only create protection element if one doesn't already exist (prevent duplicates)
      const protection = cl.protection
      if (protection && !elements.find((e) => e.id === `protection-${protection.id}`)) {
        elements.push({
          id: `protection-${protection.id}`,
          type: 'protection',
          position: {
            x: mcbX, // LOCAL coordinates
            y: mcbY,
          },
          protectionId: protection.id,
          circuitId: cl.circuit.id,
        })
      }

      // Circuit label is above horizontal backup protections and beside regular protections.
      // Only create label if one doesn't already exist (prevent duplicates) and we actually have a label.
      if (displayLabel && !elements.find((e) => e.id === `label-${cl.circuit.id}`)) {
        const isHorizontalConverterBackup = cl.circuit.supplySource?.kind === 'converter-backup'
        elements.push({
          id: `label-${cl.circuit.id}`,
          type: 'label',
          position: {
            x: isHorizontalConverterBackup ? mcbX : mcbX + getProtectionLabelXOffset(cl.protection), // LOCAL coordinates
            y: isHorizontalConverterBackup
              ? mcbY - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 - 3
              : mcbY + getProtectionLabelYOffset(cl.protection),
          },
          circuitId: cl.circuit.id,
          label: displayLabel,
        })
      }
    } else {
      // No protection device - keep label below main bus as fallback
      // Only create label if one doesn't already exist (prevent duplicates) and we actually have a label.
      if (displayLabel && !elements.find((e) => e.id === `label-${cl.circuit.id}`)) {
        elements.push({
          id: `label-${cl.circuit.id}`,
          type: 'label',
          position: {
            x: cl.x + cl.width / 2, // LOCAL coordinates
            y: mainBusY + 20,
          },
          circuitId: cl.circuit.id,
          label: displayLabel,
        })
      }
    }

    // RCD (if parent) - positioned on vertical line from main bus
    if (cl.parentRcd) {
      const trunk = trunks.find((t) => t.protectionId === cl.parentRcd!.id)
      if (trunk && cl.circuit.id === cl.parentRcd.circuits?.[0]?.id) {
        // Only add RCD element for first circuit in group
        // RCD sits on vertical line from main bus (going UP = lower Y)
        const rcdY = mainBusY - LAYOUT_CONSTANTS.RCD_VERTICAL_OFFSET
        // RCD X position is at the center of the trunk
        const rcdX = trunk.x + trunk.width / 2
        elements.push({
          id: `rcd-${cl.parentRcd.id}`,
          type: 'rcd',
          position: {
            x: rcdX, // LOCAL coordinates
            y: rcdY,
          },
          protectionId: cl.parentRcd.id,
        })
      }
    }

    // Trunk (visual element)
    if (cl.parentRcd) {
      const trunk = trunks.find((t) => t.protectionId === cl.parentRcd!.id)
      if (trunk) {
        elements.push({
          id: `trunk-visual-${trunk.id}`,
          type: 'trunk',
          position: {
            x: trunk.x, // LOCAL coordinates
            y: trunk.y,
          },
          width: trunk.width,
          height: LAYOUT_CONSTANTS.BUS_THICKNESS,
          trunkId: trunk.id,
        })
      }
    }

    // Trunk devices - positioned on the vertical wire between MCB and branches
    const trunkDevices = cl.circuit.trunkDevices || []
    if (trunkDevices.length > 0) {
      const deviceX = cl.x + getProtectionAnchorOffset(cl.leftReserve) // Same X as MCB (vertical wire center)

      // Calculate MCB Y position for this circuit
      const mcbYForDevices = cl.parentRcd
        ? (trunks.find((t) => t.protectionId === cl.parentRcd!.id)?.y ??
            mainBusY - LAYOUT_CONSTANTS.RCD_TRUNK_OFFSET) - LAYOUT_CONSTANTS.MCB_Y_OFFSET
        : cl.circuit.supplySource?.kind === 'converter-backup'
          ? cl.protectionY
          : mainBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET

      // Group trunk devices by position for layout
      trunkDevices.forEach((device) => {
        let deviceY: number

        if (device.trunkPosition === 0) {
          // Before all branches: position between MCB and first branch
          // Each device at position 0 stacks upward from MCB
          const devicesAtPos0Before = trunkDevices
            .filter((d) => d.trunkPosition === 0)
            .indexOf(device)
          deviceY =
            mcbYForDevices -
            LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP -
            devicesAtPos0Before *
              (LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING + LAYOUT_CONSTANTS.SYMBOL_SIZE)
        } else {
          // Between branches: position between branch (trunkPosition-1) and branch (trunkPosition)
          const circuitBranchesLocal = branches.filter((b) => b.circuitId === cl.circuit.id)
          const branchAbove = circuitBranchesLocal[device.trunkPosition - 1]
          const branchBelow = circuitBranchesLocal[device.trunkPosition]

          if (branchAbove && branchBelow) {
            // Midpoint between the two branches
            deviceY = (branchAbove.branchY + branchBelow.branchY) / 2
          } else if (branchAbove) {
            // After all branches (top-most): keep full spacing above branch,
            // then stack additional devices further up.
            const devicesAtSamePosBefore = trunkDevices
              .filter((d) => d.trunkPosition === device.trunkPosition)
              .indexOf(device)
            deviceY =
              branchAbove.branchY -
              LAYOUT_CONSTANTS.BRANCH_START_OFFSET -
              devicesAtSamePosBefore *
                (LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING + LAYOUT_CONSTANTS.SYMBOL_SIZE)
          } else {
            // Fallback
            deviceY = mcbYForDevices - LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP
          }
        }

        elements.push({
          id: `trunkDevice-${device.id}`,
          type: 'trunkDevice',
          position: {
            x: deviceX, // LOCAL coordinates
            y: deviceY,
          },
          trunkDeviceId: device.id,
          circuitId: cl.circuit.id,
          label: device.label,
        })
      })
    }

    // Branch and endpoints - each endpoint has its own branch
    // Get all branches for this circuit
    const circuitBranches = branches.filter((b) => b.circuitId === cl.circuit.id)

    // Circuit notes: positions were precomputed in notesPositionMap (above circuit top, stacked for nested)
    const notesPos = notesPositionMap.get(cl.circuit.id)
    if (notesPos) {
      elements.push({
        id: `circuit-notes-${cl.circuit.id}`,
        type: 'label' as const,
        position: { x: notesPos.x, y: notesPos.y },
        label: notesPos.label,
        circuitId: cl.circuit.id,
        notesOrientation: notesPos.notesOrientation,
        notesVisible: notesPos.notesVisible,
      })
    }

    circuitBranches.forEach((branch) => {
      // Exclude panel_distribution endpoints from branch endpoint processing
      const normalEndpoints = branch.endpoints.filter((e) => e.symbol !== 'panel_distribution')
      const isHorizontalConverterBackup = cl.circuit.supplySource?.kind === 'converter-backup'

      // Each branch is a horizontal line going right from the vertical branch
      // If the first endpoint is a switch, the visual line should start at the switch position
      const firstEndpoint = normalEndpoints[0]
      const hasSwitches = firstEndpoint?.type === 'switch'
      const branchVisualX = isHorizontalConverterBackup
        ? branch.branchX
        : hasSwitches
          ? branch.branchX + LAYOUT_CONSTANTS.BRANCH_LEAD_IN // Start at first switch position
          : branch.branchX // Start at vertical connection point
      const branchVisualWidth = isHorizontalConverterBackup
        ? branch.branchWidth
        : hasSwitches
          ? branch.branchWidth - LAYOUT_CONSTANTS.BRANCH_LEAD_IN // Adjust width when starting at switch position
          : branch.branchWidth // Full width when starting at branchX

      // Always create branch element (needed by tree builder for vertical wire).
      // For panel-only branches this will have width 0 so no horizontal line is drawn.
      elements.push({
        id: `branch-visual-${branch.id}`,
        type: 'branch',
        position: {
          x: branchVisualX, // LOCAL coordinates - adjusted for switches
          y: branch.branchY,
        },
        width: branchVisualWidth,
        height: LAYOUT_CONSTANTS.BRANCH_LINE_WIDTH,
        branchId: branch.id,
        circuitId: cl.circuit.id,
      })

      // Multiple endpoints can be on the same branch, spaced horizontally (with appliance-after-socket gap)
      const endpointOffsets = getEndpointXOffsets(
        normalEndpoints,
        LAYOUT_CONSTANTS.BRANCH_LEAD_IN,
        LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
        LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP
      )
      const domoticaParent = normalEndpoints.find(
        (ep) => ep.symbol === 'domotica' && !ep.domoticaChildProps
      )
      const domoticaParentIndex = domoticaParent ? normalEndpoints.indexOf(domoticaParent) : -1
      const domoticaEndpointCount = domoticaParent
        ? Math.max(
            DOMOTICA_MIN_ENDPOINT_OUTPUTS,
            Math.min(
              DOMOTICA_MAX_ENDPOINT_OUTPUTS,
              Math.trunc(
                domoticaParent.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS
              )
            )
          )
        : 0
      const domoticaVariableHeight =
        Math.max(0, domoticaEndpointCount - 1) * DOMOTICA_OUTPUT_SPACING
      const firstOutputY = domoticaParent ? branch.branchY - domoticaVariableHeight : branch.branchY
      // X at end of domotica output wire: use domotica parent's X (accounts for switch/relay before it) + half box + lead
      const domoticaParentXOffset =
        domoticaParentIndex >= 0
          ? (endpointOffsets[domoticaParentIndex] ?? LAYOUT_CONSTANTS.BRANCH_LEAD_IN)
          : LAYOUT_CONSTANTS.BRANCH_LEAD_IN
      const domoticaChildX =
        branch.branchX + domoticaParentXOffset + DOMOTICA_BOX_WIDTH / 2 + DOMOTICA_BRANCH_LEAD
      normalEndpoints.forEach((endpoint, index) => {
        const endpointX = endpoint.domoticaChildProps
          ? domoticaChildX +
            getDomoticaRowChainIndex(normalEndpoints, endpoint) *
              LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING
          : isHorizontalConverterBackup
            ? branch.branchX +
              branch.branchWidth -
              ((endpointOffsets[index] ?? 0) +
                (LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING - LAYOUT_CONSTANTS.BRANCH_LEAD_IN))
            : branch.branchX + (endpointOffsets[index] ?? 0)
        let endpointY = branch.branchY
        if (
          (endpoint.domoticaChildProps?.outputGroup === 'endpoint' ||
            endpoint.domoticaChildProps?.outputGroup === 'control') &&
          typeof endpoint.domoticaChildProps.outputIndex === 'number'
        ) {
          endpointY =
            firstOutputY + endpoint.domoticaChildProps.outputIndex * DOMOTICA_OUTPUT_SPACING
        }
        elements.push({
          id: `endpoint-${endpoint.id}`,
          type: 'endpoint',
          position: {
            x: endpointX,
            y: endpointY,
          },
          endpointId: endpoint.id,
          circuitId: cl.circuit.id,
          mirrorEndpointHorizontally: isHorizontalConverterBackup,
        })
      })

      // Label on the left at the same height as this horizontal branch
      // Read from branch.label (source of truth shared by all endpoints on the branch).
      // Only show label if there are actual (non-panel) endpoints AND a non-empty label.
      if (normalEndpoints.length > 0) {
        const labelText = (branch.label ?? '').trim()
        if (!labelText) return
        elements.push({
          id: `branch-label-${branch.id}`,
          type: 'label',
          position: {
            // Anchor the RIGHT edge of the label at a fixed distance
            // left of the trunk wire. CircuitLabel uses left-aligned
            // text with an 80px width for branch labels, so we shift
            // by that width here.
            x: branch.branchX - LAYOUT_CONSTANTS.LABEL_OFFSET, // LOCAL coordinates
            y: branch.branchY,
          },
          label: labelText,
          branchId: branch.id,
          circuitId: cl.circuit.id,
        })
      }
    })
  })

  // Add RCD elements for RCDs with 0 circuits
  panel.protections.forEach((protection) => {
    if (
      (protection.type === 'RCD' || protection.type === 'RCBO') &&
      (!protection.circuits || protection.circuits.length === 0)
    ) {
      const trunk = trunks.find((t) => t.protectionId === protection.id)
      if (trunk) {
        // RCD sits on vertical line from main bus (going UP = lower Y)
        const rcdY = mainBusY - LAYOUT_CONSTANTS.RCD_VERTICAL_OFFSET
        const rcdX = trunk.x + trunk.width / 2
        elements.push({
          id: `rcd-${protection.id}`,
          type: 'rcd',
          position: {
            x: rcdX, // LOCAL coordinates
            y: rcdY,
          },
          protectionId: protection.id,
        })
      }
    }
  })

  // Apply frame offset to trunks and branches
  const offsetTrunks = trunks.map((t) => ({
    ...t,
    x: t.x + frameOffset.x,
    y: t.y + frameOffset.y,
  }))

  const offsetBranches = branches.map((b) => ({
    ...b,
    trunkX: b.trunkX + frameOffset.x,
    trunkY: b.trunkY + frameOffset.y,
    branchX: b.branchX + frameOffset.x,
    branchY: b.branchY + frameOffset.y,
  }))

  // Calculate frame
  // Frame should encompass all content from minY (top) to maxY (bottom)
  // Account for supply device horizontal extent
  const totalWidthWithSupply = Math.max(
    totalWidth,
    supplyRightExtent + LAYOUT_CONSTANTS.LEFT_MARGIN
  )
  const FRAME_PADDING = 20
  const frameX = frameOffset.x - FRAME_PADDING
  const frameTopTitlePadding =
    installation && rootPanels ? getPanelFrameTitlePadding(panel, installation, rootPanels) : 28
  let frameY = minY - frameTopTitlePadding
  let frameWidth = totalWidthWithSupply + FRAME_PADDING * 2
  const { minWidth: minFrameWidth, minHeight: minFrameHeight } = getInfoBlockMinFrameSize()
  // Ensure the frame is wide enough for:
  // - the info block itself (minFrameWidth), and
  // - a clear horizontal gap between the supply wire and the info block so they never overlap,
  //   even for very small panels with short main bus bars.
  //
  // Geometry (local coordinates, before frameOffset):
  // - frame left X = frameOffset.x - FRAME_PADDING
  // - supply X     = supplyX
  // - info block left X = frame left + frameWidth - INFO_BLOCK_TOTAL_WIDTH - INFO_BLOCK_FRAME_MARGIN
  //
  // We require: infoBlockLeft >= supplyX + MIN_SUPPLY_INFO_GAP.
  const MIN_SUPPLY_INFO_GAP = 80
  const minWidthForSupplyClearance =
    supplyX + MIN_SUPPLY_INFO_GAP + FRAME_PADDING + INFO_BLOCK_TOTAL_WIDTH + INFO_BLOCK_FRAME_MARGIN
  frameWidth = options.feedOutput
    ? Math.max(frameWidth, minFrameWidth) + 36
    : Math.max(frameWidth, minFrameWidth, minWidthForSupplyClearance)

  // Reserve vertical space for the info block only when the supply wire actually reaches
  // underneath it. When supply stays on the left (typical), the info block can share the
  // bottom band and we only need a small frame inset.
  const infoBlockLeftX =
    frameOffset.x - FRAME_PADDING + frameWidth - INFO_BLOCK_TOTAL_WIDTH - INFO_BLOCK_FRAME_MARGIN
  // A long DC branch can reach the info block's X range while remaining far above it.
  // Do not reserve a complete extra info-block row for that harmless overlap. Only
  // stack the block below the drawing when content in the same horizontal region
  // also reaches the compact block position vertically.
  const COMPACT_INFO_BLOCK_TOP =
    frameBottomY + FRAME_TOP_MARGIN + FRAME_PADDING - INFO_BLOCK_HEIGHT
  const supplyActuallyCollidesWithCompactInfoBlock = supplyContentCollidesWithInfoBlock({
    infoBlockLeftX,
    compactInfoBlockTop: COMPACT_INFO_BLOCK_TOP,
    supplyRightExtent,
    supplyX,
    supplySourceY,
    supplyDevices: supplyDevicePositions,
  })
  const DETACHED_SUPPLY_INFO_CLEARANCE = 24
  const SPLIT_MAIN_INFO_CLEARANCE = 24
  const usesDetachedSplitMain =
    options.supplyEndpointKind === 'continuation' && (panel.busSections?.length ?? 0) > 1
  const frameBottomMargin = options.feedOutput
    ? usesSplitSupplyGround
      ? INFO_BLOCK_FRAME_MARGIN + DETACHED_SUPPLY_INFO_CLEARANCE
      : INFO_BLOCK_HEIGHT + INFO_BLOCK_FRAME_MARGIN + 8
    : usesDetachedSplitMain
      ? INFO_BLOCK_FRAME_MARGIN + SPLIT_MAIN_INFO_CLEARANCE
      : supplyActuallyCollidesWithCompactInfoBlock
        ? INFO_BLOCK_HEIGHT + INFO_BLOCK_FRAME_MARGIN + 8
        : INFO_BLOCK_FRAME_MARGIN
  const totalHeight = frameBottomY - minY + FRAME_TOP_MARGIN + frameBottomMargin
  const baseFrameHeight = totalHeight + frameTopTitlePadding + FRAME_PADDING

  // Respect minimum frame height required by the info block, but keep all panel
  // bottoms aligned: when we increase the height, shift the frame upward so the
  // bottom edge (baseline) stays at the same Y for every panel.
  let frameHeight = Math.max(baseFrameHeight, minFrameHeight)
  if (options.feedOutput) {
    const SUPPLY_FRAME_EXTRA_TOP_GAP = 28
    frameY -= SUPPLY_FRAME_EXTRA_TOP_GAP
    frameHeight += SUPPLY_FRAME_EXTRA_TOP_GAP
    const supplyTopContentY = Math.min(
      ...supplyDevicePositions.map(({ device, y }) => getSupplyDeviceTopExtent(device, y)),
      ...supplyDevicePositions
        .filter(
          ({ device }) => device.supplyPath === 'backup' || device.supplyPath === 'converter-branch'
        )
        .map(
          ({ y }) =>
            y -
            LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH -
            LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 -
            SUPPLY_TOP_LABEL_OFFSET_FROM_SYMBOL -
            SUPPLY_STABLE_TOP_LABEL_LINE_RESERVE *
              (SUPPLY_TOP_LABEL_FONT_SIZE + SUPPLY_TOP_LABEL_LINE_SPACING)
        ),
      Number.POSITIVE_INFINITY
    )
    const requiredFrameY = supplyTopContentY - SUPPLY_FRAME_TOP_CONTENT_GAP
    if (Number.isFinite(requiredFrameY) && frameY > requiredFrameY) {
      const extraTopHeight = frameY - requiredFrameY
      frameY = requiredFrameY
      frameHeight += extraTopHeight
    }
  } else if (frameHeight !== baseFrameHeight) {
    const baseBottom = frameY + baseFrameHeight
    frameY = baseBottom - frameHeight
  }

  // A detached split supply with no horizontal protection labels can otherwise collapse
  // until the earthing symbol touches the info block. Preserve a small, geometry-based
  // minimum gap without making populated supply frames taller than their content requires.
  if (options.feedOutput && usesSplitSupplyGround && hasGround) {
    const MIN_GROUND_INFO_BLOCK_GAP = 12
    const groundBottom = renderedGroundY + frameOffset.y + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
    const infoBlockTop = frameY + frameHeight - INFO_BLOCK_HEIGHT - INFO_BLOCK_FRAME_MARGIN
    frameHeight += Math.max(0, groundBottom + MIN_GROUND_INFO_BLOCK_GAP - infoBlockTop)
  }

  // Apply frameOffset to all elements automatically (invisible transformation)
  const offsetElements = createElementsWithFrameOffset(elements, frameOffset)

  // Calculate parent MCB position if this is a sub-panel (LOCAL coordinates, will be offset in return)
  let parentMcbPosition:
    | { protection: ProtectionDevice; circuit: Circuit; position: Point }
    | undefined
  if (parentMcbInfo) {
    parentMcbPosition = {
      protection: parentMcbInfo.protection,
      circuit: parentMcbInfo.circuit,
      position: { x: supplyX, y: supplyY }, // LOCAL coordinates
    }
    // Apply frameOffset to parent MCB position
    parentMcbPosition.position.x += frameOffset.x
    parentMcbPosition.position.y += frameOffset.y
  }

  const circuitNotes =
    circuitNotesLocal.length > 0
      ? circuitNotesLocal.map((n) => ({
          ...n,
          x: n.x + frameOffset.x,
          y: n.y + frameOffset.y,
        }))
      : undefined

  return {
    panel,
    diagramId: options.diagramId ?? panel.id,
    frameRole: options.frameRole ?? 'panel',
    ownerPanelId: options.ownerPanelId ?? panel.id,
    supplyEndpointKind: options.supplyEndpointKind ?? 'mains',
    elements: offsetElements, // Elements already have frameOffset applied
    circuitNotes,
    circuits: circuitLayouts.map((cl) => ({
      ...cl,
      x: cl.x + frameOffset.x, // Apply frameOffset to circuit X positions
    })),
    trunks: offsetTrunks, // Already has frameOffset applied
    branches: offsetBranches, // Already has frameOffset applied
    mainBus: {
      x: mainBusX + frameOffset.x, // Apply frameOffset
      y: renderedMainBusY + frameOffset.y,
      width: renderedMainBusWidth,
    },
    supply: {
      x: supplyX + frameOffset.x, // Apply frameOffset
      y: supplySourceY + frameOffset.y,
    },
    supplyBend: !isSubPanel
      ? {
          x: supplyBendX + frameOffset.x,
          y: (hasDirectConverter ? supplySourceY : supplyY) + frameOffset.y,
        }
      : undefined,
    supplyDevices:
      supplyDevicePositions.length > 0
        ? supplyDevicePositions.map((sd) => ({
            ...sd,
            x: sd.x + frameOffset.x,
            y: sd.y + frameOffset.y,
          }))
        : undefined,
    supplyChangeoverBranches: changeoverPosition
      ? {
          deviceId: changeoverPosition.device.id,
          x: changeoverPosition.x + frameOffset.x,
          y: changeoverPosition.y + frameOffset.y,
          elbowX:
            changeoverPosition.x +
            LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE / 2 +
            LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_ELBOW_LEAD +
            frameOffset.x,
          upperY: changeoverPosition.y - changeoverLaneOffset + frameOffset.y,
          lowerY: changeoverPosition.y + changeoverLaneOffset + frameOffset.y,
          slotEndX: (changeoverSlotEndX ?? changeoverPosition.x) + frameOffset.x,
        }
      : undefined,
    supplyConverterBranch:
      (hasDirectConverter || hasSupplyChangeover) &&
      (directConverterIndex >= 0 ||
        supplyTrunkDevices.some((device) => device.supplyPath === 'backup'))
        ? (() => {
            const converter = supplyDevicePositions.find(
              ({ device }) =>
                device.supplyPath === 'converter-branch' || device.supplyPath === 'backup'
            )
            if (!converter) return undefined
            const dcDevices = supplyDevicePositions.filter(
              ({ device }) => device.supplyPath === 'converter-dc'
            )
            const dcTopDevices = supplyDevicePositions.filter(
              ({ device }) => device.supplyPath === 'converter-dc-top'
            )
            return {
              deviceId: converter.device.id,
              x: converter.x + frameOffset.x,
              y: converter.y + frameOffset.y,
              lineY: supplySourceY + frameOffset.y,
              dcEndX:
                (dcDevices.at(-1)?.x ?? converter.x) +
                (dcDevices.length > 0
                  ? LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_DEVICE_SPACING
                  : LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH) +
                frameOffset.x,
              dcTopY:
                converter.y - LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH + frameOffset.y,
              dcTopEndX:
                (dcTopDevices.at(-1)?.x ?? converter.x) +
                (dcTopDevices.length > 0
                  ? LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_DEVICE_SPACING
                  : LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH) +
                frameOffset.x,
            }
          })()
        : undefined,
    supplyConverterBackup: directConverterBackup
      ? {
          ...directConverterBackup,
          x1: directConverterBackup.x1 + frameOffset.x,
          x2: directConverterBackup.x2 + frameOffset.x,
          y: directConverterBackup.y + frameOffset.y,
        }
      : undefined,
    feedOutput: undefined,
    ground: hasGround
      ? {
          x: groundX + frameOffset.x, // Apply frameOffset
          y: renderedGroundY + frameOffset.y,
        }
      : undefined,
    groundDevices:
      renderedGroundDevicePositions.length > 0
        ? renderedGroundDevicePositions.map((gd) => ({
            ...gd,
            x: gd.x + frameOffset.x,
            y: gd.y + frameOffset.y,
          }))
        : undefined,
    frame: {
      x: frameX, // frameX already includes frameOffset.x
      y: frameY,
      width: frameWidth,
      height: frameHeight,
    },
    isSubPanel: isSubPanel,
    parentMcb: parentMcbPosition,
  }
}

function isConverterBackupCircuit(circuit: Circuit): boolean {
  return circuit.supplySource?.kind === 'converter-backup'
}

function clonePanelForDiagramRole(panel: Panel, role: 'panel' | 'supply'): Panel {
  const keepCircuit = (circuit: Circuit) =>
    role === 'supply' ? isConverterBackupCircuit(circuit) : !isConverterBackupCircuit(circuit)

  return {
    ...panel,
    circuits: panel.circuits.filter(keepCircuit),
    protections: panel.protections.flatMap((protection): ProtectionDevice[] => {
      const circuits = (protection.circuits ?? []).filter(keepCircuit)
      if ((protection.circuits?.length ?? 0) > 0 && circuits.length === 0) return []
      if (role === 'supply' && circuits.length === 0) return []
      return [{ ...protection, circuits }]
    }),
  }
}

function panelHasMainBusProtection(panel: Panel): boolean {
  return panel.protections.some((protection) => {
    const circuits = protection.circuits ?? []
    return circuits.length === 0 || circuits.some((circuit) => !isConverterBackupCircuit(circuit))
  })
}

function panelHasComplexSupplyTopology(
  panel: Panel,
  installation: Installation,
  rootPanels: Panel[]
): boolean {
  const devices = getPanelFeedProjection(installation, rootPanels, panel)?.devices ?? []
  return devices.some(
    (device) =>
      device.symbol === 'source_changeover' ||
      device.type === 'conversion' ||
      device.supplyPath === 'converter-branch' ||
      device.supplyPath === 'backup'
  )
}

function shouldDetachSupplyFrame(
  panel: Panel,
  installation: Installation,
  rootPanels: Panel[],
  isSubPanel: boolean
): boolean {
  return (
    !isSubPanel &&
    panelHasMainBusProtection(panel) &&
    panelHasComplexSupplyTopology(panel, installation, rootPanels)
  )
}

/**
 * Calculate bottom-up layout for entire project
 */
export function calculateBottomUpLayout(
  project: ProjectWithOptionalV2Electrical,
  manualOverrides?: Map<string, Point>
): BottomUpLayoutResult {
  const panels = getElectricalPanelsFromProject(project)
  const installation = getElectricalInstallationFromProject(project)
  if (!installation) {
    throw new Error('Cannot calculate bottom-up layout without electrical installation data')
  }
  ensureInstallationFeedTopology(installation, panels)

  const PANEL_SPACING = 100
  const ROW_SPACING = 120
  const panelLayouts: BottomUpPanelLayout[] = []
  const detachedSupplyLayouts: BottomUpPanelLayout[] = []
  const panelLayoutById = new Map<string, BottomUpPanelLayout>()
  const depthHeights = new Map<number, number>()
  const originalFrameYByPanelId = new Map<string, number>()
  const depthByPanelId = new Map<string, number>()

  // Map to store parent MCB info for each sub-panel
  const subPanelMcbMap = new Map<
    string,
    { protection: ProtectionDevice; circuit: Circuit; parentPanel: Panel }
  >()

  const flatPanels = flattenPanelsForRendering(panels)
  const useMultiRootForestLayout = panels.length > 1
  flatPanels.forEach((flatPanel) => {
    let parentMcbInfo: {
      protection: ProtectionDevice
      circuit: Circuit
      parentPanel: Panel
    } | null = null
    const isSubPanel = flatPanel.parentPanel !== undefined || flatPanel.panel.isMain !== true

    if (isSubPanel) {
      parentMcbInfo = findParentMcbForSubPanel(project, flatPanel.panel)
      if (parentMcbInfo) {
        subPanelMcbMap.set(flatPanel.panel.id, parentMcbInfo)
      } else {
        logger.warn('calculateBottomUpLayout: Sub-panel but no parent MCB found', {
          panelId: flatPanel.panel.id,
          panelName: flatPanel.panel.name,
          hasParentPanel: !!flatPanel.parentPanel,
          isMain: flatPanel.panel.isMain,
        })
      }
    }

    const detachSupply = shouldDetachSupplyFrame(flatPanel.panel, installation, panels, isSubPanel)
    const panelForMainDiagram = detachSupply
      ? clonePanelForDiagramRole(flatPanel.panel, 'panel')
      : flatPanel.panel
    const panelLayout = calculateBottomUpPanelLayout(
      panelForMainDiagram,
      manualOverrides,
      { x: 0, y: 0 },
      parentMcbInfo,
      installation,
      panels,
      detachSupply
        ? {
            includeSupplyTopology: false,
            includeGroundDevices: false,
            diagramId: flatPanel.panel.id,
            ownerPanelId: flatPanel.panel.id,
            frameRole: 'panel',
            supplyEndpointKind: 'continuation',
          }
        : undefined
    )

    if (detachSupply) {
      const supplyDiagramPanel = clonePanelForDiagramRole(flatPanel.panel, 'supply')
      detachedSupplyLayouts.push(
        calculateBottomUpPanelLayout(
          supplyDiagramPanel,
          manualOverrides,
          { x: 0, y: 0 },
          null,
          installation,
          panels,
          {
            diagramId: `${flatPanel.panel.id}--supply`,
            ownerPanelId: flatPanel.panel.id,
            frameRole: 'supply',
            supplyEndpointKind: 'mains',
            feedOutput: true,
          }
        )
      )
    }

    const upstreamProtectionLabel = (parentMcbInfo?.protection.label ?? '').trim()
    // Parent panel fallback below the incoming feeder. Only show this when the
    // immediate upstream protection has no own label; otherwise that protection
    // label is the reference and the parent-panel name is redundant/noisy.
    if (flatPanel.parentPanel && !upstreamProtectionLabel) {
      panelLayout.elements.push({
        id: `parent-tag-${flatPanel.panel.id}`,
        type: 'label',
        position: {
          x: panelLayout.supply.x,
          y: panelLayout.supply.y,
        },
        label: `← ${(parentMcbInfo?.parentPanel.name ?? flatPanel.parentPanel.name).trim()}`,
      })
    }

    panelLayouts.push(panelLayout)
    panelLayoutById.set(flatPanel.panel.id, panelLayout)
    depthByPanelId.set(flatPanel.panel.id, flatPanel.depth)
    originalFrameYByPanelId.set(flatPanel.panel.id, panelLayout.frame.y)
  })

  applyPanelFrameBottomAlignmentByRow(panelLayouts, (panelLayout) =>
    useMultiRootForestLayout ? (depthByPanelId.get(panelLayout.panel.id) ?? 0) : 0
  )

  const getOrderedChildren = createOrderedPanelChildrenResolver(project, panelLayoutById)
  const placementPanels = flattenPanelsForPlacement(panels, getOrderedChildren)

  panelLayouts.forEach((panelLayout) => {
    const depth = depthByPanelId.get(panelLayout.panel.id) ?? 0
    depthHeights.set(depth, Math.max(depthHeights.get(depth) ?? 0, panelLayout.frame.height))
  })

  const rowOffsetByDepth = new Map<number, number>()
  let currentRowOffset = 0
  const maxDepth = Math.max(0, ...depthHeights.keys())
  for (let depth = 0; depth <= maxDepth; depth++) {
    rowOffsetByDepth.set(depth, currentRowOffset)
    currentRowOffset += (depthHeights.get(depth) ?? 0) + ROW_SPACING
  }

  const subtreeWidthByPanelId = new Map<string, number>()
  const computeSubtreeWidth = (panel: Panel): number => {
    const existing = subtreeWidthByPanelId.get(panel.id)
    if (existing != null) return existing
    const layout = panelLayoutById.get(panel.id)
    if (!layout) return 0
    const childWidths = getOrderedChildren(panel).map((child) => computeSubtreeWidth(child))
    const childrenWidth =
      childWidths.length > 0
        ? childWidths.reduce((sum, width) => sum + width, 0) +
          PANEL_SPACING * (childWidths.length - 1)
        : 0
    const subtreeWidth = Math.max(layout.frame.width, childrenWidth)
    subtreeWidthByPanelId.set(panel.id, subtreeWidth)
    return subtreeWidth
  }

  panels.forEach((panel) => computeSubtreeWidth(panel))

  if (useMultiRootForestLayout) {
    const placeSubtree = (panel: Panel, leftX: number, depth: number) => {
      const layout = panelLayoutById.get(panel.id)
      const subtreeWidth = subtreeWidthByPanelId.get(panel.id) ?? 0
      if (!layout) return

      const targetFrameX = leftX + (subtreeWidth - layout.frame.width) / 2
      const targetFrameY =
        (originalFrameYByPanelId.get(panel.id) ?? layout.frame.y) +
        (rowOffsetByDepth.get(depth) ?? 0)
      applyShiftToPanelLayout(layout, targetFrameX - layout.frame.x, targetFrameY - layout.frame.y)

      const orderedChildren = getOrderedChildren(panel)
      if (orderedChildren.length === 0) return

      const childWidths = orderedChildren.map((child) => subtreeWidthByPanelId.get(child.id) ?? 0)
      const totalChildrenWidth =
        childWidths.reduce((sum, width) => sum + width, 0) +
        PANEL_SPACING * (childWidths.length - 1)
      let childLeft = leftX + (subtreeWidth - totalChildrenWidth) / 2
      orderedChildren.forEach((child, index) => {
        placeSubtree(child, childLeft, depth + 1)
        childLeft += (childWidths[index] ?? 0) + PANEL_SPACING
      })
    }

    let rootLeft = LAYOUT_CONSTANTS.LEFT_MARGIN
    panels.forEach((panel) => {
      const subtreeWidth = subtreeWidthByPanelId.get(panel.id) ?? 0
      placeSubtree(panel, rootLeft, 0)
      rootLeft += subtreeWidth + PANEL_SPACING
    })
  } else {
    let currentX = LAYOUT_CONSTANTS.LEFT_MARGIN
    for (const flatPanel of placementPanels) {
      const layout = panelLayoutById.get(flatPanel.panel.id)
      if (!layout) continue
      const targetFrameX = currentX
      const targetFrameY = originalFrameYByPanelId.get(flatPanel.panel.id) ?? layout.frame.y
      applyShiftToPanelLayout(layout, targetFrameX - layout.frame.x, targetFrameY - layout.frame.y)
      currentX += layout.frame.width + PANEL_SPACING
    }
  }

  const framesOverlap = (
    left: { x: number; y: number; width: number; height: number },
    right: { x: number; y: number; width: number; height: number }
  ) =>
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y

  for (const supplyLayout of detachedSupplyLayouts) {
    const ownerLayout = panelLayoutById.get(supplyLayout.ownerPanelId ?? supplyLayout.panel.id)
    if (!ownerLayout) continue
    const targetFrameX = ownerLayout.frame.x
    let targetFrameY = ownerLayout.frame.y + ownerLayout.frame.height + ROW_SPACING
    // The detached frame's local layout grows upward when a solar/battery/inverter
    // metadata callout is present. Spend that extra height in the row gap instead of
    // shifting the existing supply devices down into the frame; the frame bottom and
    // all already-positioned supply content remain anchored.
    const topMetadataCalloutExpansion = Math.max(
      0,
      ...(supplyLayout.supplyDevices ?? []).map(({ device }) =>
        getSupplyMetadataCalloutTopExtra(device)
      )
    )
    targetFrameY -= topMetadataCalloutExpansion
    let candidateFrame = {
      x: targetFrameX,
      y: targetFrameY,
      width: supplyLayout.frame.width,
      height: supplyLayout.frame.height,
    }
    let moved = true
    while (moved) {
      moved = false
      for (const existing of panelLayouts) {
        if (existing === ownerLayout) continue
        if (!framesOverlap(candidateFrame, existing.frame)) continue
        targetFrameY = existing.frame.y + existing.frame.height + ROW_SPACING
        candidateFrame = { ...candidateFrame, y: targetFrameY }
        moved = true
      }
    }
    applyShiftToPanelLayout(
      supplyLayout,
      targetFrameX - supplyLayout.frame.x,
      targetFrameY - supplyLayout.frame.y
    )
    panelLayouts.push(supplyLayout)
  }

  // Add panel symbols for protections that connect to sub-panels
  // These should appear at the end of the circuit's trunk (centered), not on a branch
  panelLayouts.forEach((mainPanelLayout) => {
    resolvePanelSupplyLinksForSourcePanel(project, mainPanelLayout.panel).forEach((link) => {
      const feederIsConverterBackup = link.feederCircuit?.supplySource?.kind === 'converter-backup'
      const hasDetachedSupplyFrame = panelLayouts.some(
        (candidate) =>
          candidate.panel.id === mainPanelLayout.panel.id && candidate.frameRole === 'supply'
      )
      if (
        hasDetachedSupplyFrame &&
        (mainPanelLayout.frameRole === 'supply') !== feederIsConverterBackup
      ) {
        return
      }
      const subPanelLayout = panelLayouts.find(
        (pl) => pl.frameRole !== 'supply' && pl.panel.id === link.targetPanel.id
      )
      if (subPanelLayout) {
        const circuit = link.feederCircuit
        if (circuit) {
          const panelEndpoint = link.sourcePanelEndpoint
          // Find all branches for this feeder circuit in the panel layout.
          const circuitBranches = mainPanelLayout.branches.filter((b) => b.circuitId === circuit.id)
          if (circuitBranches.length > 0) {
            const topmostBranch = getTopmostCircuitBranch(circuitBranches)
            if (!topmostBranch) {
              return
            }
            const mcbY = mainPanelLayout.mainBus.y - LAYOUT_CONSTANTS.MCB_Y_OFFSET
            const panelSharesSecondaryBus = hasPanelAttachmentOnSecondaryBus(
              link.protection,
              circuit
            )
            // A feeder can terminate directly at a panel, or share a secondary bus
            // with nested protections. In the latter case, the unprotected panel
            // is another direct bus attachment and belongs beside those protections,
            // not at the top of their consumer branches.
            const isHorizontalConverterBackup = circuit.supplySource?.kind === 'converter-backup'
            const symbolX = isHorizontalConverterBackup
              ? topmostBranch.branchX + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
              : topmostBranch.trunkX // Centered on vertical trunk
            const nestedCircuitIds = new Set(circuit.subCircuitIds ?? [])
            const nestedProtectionYs = panelSharesSecondaryBus
              ? mainPanelLayout.elements
                  .filter(
                    (element) =>
                      element.type === 'protection' &&
                      !!element.circuitId &&
                      nestedCircuitIds.has(element.circuitId)
                  )
                  .map((element) => element.position.y)
              : []
            const sourcePanelEndpointY = panelEndpoint
              ? mainPanelLayout.elements.find((element) => element.endpointId === panelEndpoint.id)
                  ?.position.y
              : undefined
            const feederProtectionElement = mainPanelLayout.elements.find(
              (element) =>
                element.type === 'protection' &&
                element.protectionId === link.protection.id &&
                element.circuitId === circuit.id
            )
            const feederCircuitIsNested = mainPanelLayout.panel.protections.some((protection) =>
              (protection.circuits ?? []).some((candidate) =>
                (candidate.subCircuitIds ?? []).includes(circuit.id)
              )
            )
            const isEmptyPanelFeeder =
              !!link.protection.subPanelId &&
              circuit.endpoints.length === 0 &&
              (circuit.branches?.length ?? 0) === 0 &&
              (circuit.subCircuitIds?.length ?? 0) === 0 &&
              (circuit.trunkDevices?.length ?? 0) === 0
            const nestedPanelOnlyFeederY =
              feederProtectionElement && feederCircuitIsNested && isEmptyPanelFeeder
                ? feederProtectionElement.position.y -
                  LAYOUT_CONSTANTS.NESTED_PANEL_FEEDER_VERTICAL_OFFSET
                : undefined
            const symbolY = isHorizontalConverterBackup
              ? topmostBranch.branchY
              : panelSharesSecondaryBus && nestedProtectionYs.length > 0
                ? Math.min(...nestedProtectionYs) -
                  LAYOUT_CONSTANTS.SECONDARY_BUS_PANEL_VERTICAL_OFFSET
                : (nestedPanelOnlyFeederY ??
                  sourcePanelEndpointY ??
                  getCircuitLineTopY(circuitBranches, mcbY, true))

            mainPanelLayout.elements.push({
              id: `subpanel-symbol-${link.protection.id}`,
              type: 'endpoint',
              position: { x: symbolX, y: symbolY },
              endpointId: panelEndpoint?.id,
              circuitId: circuit.id,
            })
          } else {
            logger.warn('calculateBottomUpLayout: MCB branch not found for sub-panel', {
              protectionId: link.protection.id,
              circuitId: circuit.id,
              availableBranches: mainPanelLayout.branches.map((b) => ({
                circuitId: b.circuitId,
                branchX: b.branchX,
                branchY: b.branchY,
              })),
            })
          }
        }
      }
    })
  })

  // Calculate total dimensions
  let totalWidth: number = LAYOUT_CONSTANTS.LEFT_MARGIN
  let totalHeight: number = 0

  panelLayouts.forEach((pl) => {
    totalWidth = Math.max(totalWidth, pl.frame.x + pl.frame.width + LAYOUT_CONSTANTS.LEFT_MARGIN)
    totalHeight = Math.max(totalHeight, pl.frame.y + pl.frame.height + 50)
  })

  return {
    panels: panelLayouts,
    totalWidth,
    totalHeight,
  }
}
