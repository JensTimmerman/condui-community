/**
 * Pure construction of the panel hierarchy scene (surfaces + connectors).
 * Used by PanelCanvas / HierarchyPanelCanvas for both full-tree and filtered views.
 */
import { getPanelFeedProjection } from '@/lib/feedTopology'
import { getPanelDisplayName } from '@/utils/panelNames'
import type { Panel, PanelGridModuleRef } from '@/types/schema'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import {
  CELL_H,
  CELL_W,
  ROW_GAP,
  getPanelGridPlacements,
  getSupplyPanelColumns,
  getSupplyPanelRows,
  getSupplyPanelPlacements,
  panelGridModuleRefKey,
  resolveModuleWidthCols,
  type ModulePlacement,
} from '@/components/canvas/panel/panelGridLayout'

export const PANEL_SCENE_FRAME_MARGIN = 40
/** Vertical gap between main and supply regions on one panel surface (matches legacy PanelCanvas). */
export const PANEL_SCENE_SUPPLY_GAP = 20
export const PANEL_SCENE_SHARED_SUPPLY_ID = 'shared-supply'

export type PanelScenePanelOption = {
  id: string
  panel: Panel
  isRoot: boolean
}

export type PanelSceneSurfaceKind = 'shared_supply' | 'panel'

export interface PanelSceneSurface {
  id: string
  panel: Panel | null
  kind: PanelSceneSurfaceKind
  x: number
  y: number
  width: number
  height: number
  mainPanelY: number
  supplyPanelY: number
  panelFrameHeight: number
  supplyFrameHeight: number
  contentWidth: number
  supplyContentWidth: number
  supplyRows: number
  supplyCols: number
  rows: number
  cols: number
  feedFromTop: boolean
  placements: Array<ModulePlacement & { inSupplyPanel?: boolean }>
  supplyPanelVisible: boolean
  label: string
}

export interface PanelSceneConnector {
  points: number[]
}

export interface BuiltPanelScene {
  width: number
  height: number
  surfaces: PanelSceneSurface[]
  connectors: PanelSceneConnector[]
  moduleRefs: Set<string>
  sharedSupplyTrunkRefKeys: Set<string>
}

function getSupplyPanelLayout(panel: Panel | null | undefined) {
  const rows = getSupplyPanelRows(panel)
  const cols = getSupplyPanelColumns(panel)
  const contentWidth = cols * CELL_W
  const contentHeight = rows * CELL_H + Math.max(0, rows - 1) * ROW_GAP
  return { rows, cols, contentWidth, contentHeight }
}

export function routePanelSceneConnector(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  gapY: number
): number[] {
  if (Math.abs(fromX - toX) < 0.5) return [fromX, fromY, toX, toY]
  return [fromX, fromY, fromX, gapY, toX, gapY, toX, toY]
}

export type GetPanelGridModulesFn = (panelId: string) => Array<{
  ref: PanelGridModuleRef
  inSupplyPanel?: boolean
  slot?: { row: number; col: number; moduleWidth?: number; moduleWidthManual?: boolean }
}>

export interface BuildPanelSceneParams {
  project: ProjectWithOptionalV2Electrical & {
    project?: {
      locale?: string
    }
  }
  panelOptions: PanelScenePanelOption[]
  getPanelGridModules: GetPanelGridModulesFn
  /** When true, layout includes sub-panels under each root. Full scene always uses true. */
  includeDescendants: boolean
  /** Shared supply strip feed direction (from first root). */
  hierarchyFeedFromTop: boolean
  sharedSupplyLabel: string
}

/**
 * Builds the same scene previously computed inside HierarchyPanelCanvas `useMemo`.
 */
export function buildFullPanelScene(params: BuildPanelSceneParams): BuiltPanelScene | null {
  const {
    project: currentProject,
    panelOptions,
    getPanelGridModules,
    includeDescendants,
    hierarchyFeedFromTop,
    sharedSupplyLabel,
  } = params

  const rootOptions = panelOptions.filter((option) => option.isRoot)
  if (rootOptions.length === 0) return null
  const firstRootOption = rootOptions[0]
  if (!firstRootOption) return null

  const rootGap = 56
  const levelGap = 72
  const siblingGap = 48

  const installation = getElectricalInstallationFromProject(currentProject)
  const rootPanels = getElectricalPanelsFromProject(currentProject)
  const sharedProjection = installation
    ? getPanelFeedProjection(installation, rootPanels, firstRootOption.panel)
    : null
  const explicitMainSharedKeys = new Set(
    rootOptions.flatMap((option) =>
      (option.panel.gridView?.slots ?? [])
        .filter((slot) => slot.module.kind === 'trunkDevice' && slot.module.scope === 'supply')
        .map((slot) => panelGridModuleRefKey(slot.module))
    )
  )
  const sharedRefs: PanelGridModuleRef[] = (sharedProjection?.sharedFeed.trunkDevices ?? [])
    .filter((device) => device.type !== 'junction_box' && device.type !== 'junction_panel')
    .map((device) => ({ kind: 'trunkDevice' as const, id: device.id, scope: 'supply' as const }))
    .filter((ref) => !explicitMainSharedKeys.has(panelGridModuleRefKey(ref)))
  const sharedRefKeys = new Set(sharedRefs.map((ref) => panelGridModuleRefKey(ref)))
  const sharedSlotMap = new Map(
    (firstRootOption.panel.gridView?.supplyPanelSlots ?? [])
      .filter((slot) => sharedRefKeys.has(panelGridModuleRefKey(slot.module)))
      .map((slot) => [panelGridModuleRefKey(slot.module), slot] as const)
  )

  const sharedPlacements: ModulePlacement[] = []
  let sharedCursorCol = 0
  for (const ref of sharedRefs) {
    const key = panelGridModuleRefKey(ref)
    const widthCols = Math.max(1, resolveModuleWidthCols(ref, currentProject))
    const slot = sharedSlotMap.get(key)
    const col = slot?.col ?? sharedCursorCol
    sharedPlacements.push({
      ref,
      x: col * CELL_W,
      y: 0,
      width: widthCols * CELL_W,
      height: CELL_H,
      row: 0,
      col,
    })
    if (slot == null) sharedCursorCol += widthCols
  }
  const baseRootCols = firstRootOption.panel.gridView?.columns ?? 12
  const baseRootContentWidth = baseRootCols * CELL_W
  const sharedContentWidth = baseRootContentWidth
  const sharedWidth = sharedContentWidth + PANEL_SCENE_FRAME_MARGIN * 2
  const sharedHeight = CELL_H + PANEL_SCENE_FRAME_MARGIN * 2

  const M = PANEL_SCENE_FRAME_MARGIN
  const GAP = PANEL_SCENE_SUPPLY_GAP

  const buildSurfaceForPanel = (panel: Panel): Omit<PanelSceneSurface, 'x' | 'y'> => {
    const rows = panel.gridView?.rows ?? 8
    const cols = panel.gridView?.columns ?? 12
    const supplyLayout = getSupplyPanelLayout(panel)
    const feedFromTop = panel.gridView?.feedFromTop ?? false
    const contentHeight = rows * CELL_H + Math.max(0, rows - 1) * ROW_GAP
    const contentWidth = cols * CELL_W
    const panelFrameHeight = contentHeight + M * 2
    const supplyFrameHeight = supplyLayout.contentHeight + M * 2
    const modules = getPanelGridModules(panel.id).filter(
      (module) => !(module.ref.kind === 'trunkDevice' && module.ref.scope === 'ground')
    )
    const mainModules = modules.filter((module) => module.inSupplyPanel !== true)
    const supplyModulesRaw = modules.filter((module) => module.inSupplyPanel === true)
    const supplyModules = panel.isMain ? [] : supplyModulesRaw

    const mainPlacements = getPanelGridPlacements(panel, currentProject, mainModules).map(
      (placement) => ({
        ...placement,
        x: placement.x + M,
      })
    )
    const supplyPlacementsRaw = getSupplyPanelPlacements(panel, currentProject, supplyModules)
    const supplyPanelVisible = supplyPlacementsRaw.length > 0
    const mainPanelY = supplyPanelVisible && feedFromTop ? supplyFrameHeight + GAP : 0
    const supplyPanelY = supplyPanelVisible && !feedFromTop ? panelFrameHeight + GAP : 0
    const mainPlacementsWithOffset = mainPlacements.map((placement) => ({
      ...placement,
      y: placement.y + mainPanelY + M,
    }))
    const supplyPlacements = supplyPlacementsRaw.map((placement) => ({
      ...placement,
      x: placement.x + M,
      y: placement.y + supplyPanelY + M,
      inSupplyPanel: true as const,
    }))

    return {
      id: panel.id,
      panel,
      kind: 'panel',
      width: Math.max(contentWidth, supplyLayout.contentWidth) + M * 2,
      height: panelFrameHeight + (supplyPanelVisible ? supplyFrameHeight + GAP : 0),
      mainPanelY,
      supplyPanelY,
      panelFrameHeight,
      supplyFrameHeight,
      contentWidth,
      supplyContentWidth: supplyLayout.contentWidth,
      supplyRows: supplyLayout.rows,
      supplyCols: supplyLayout.cols,
      rows,
      cols,
      feedFromTop,
      placements: [...mainPlacementsWithOffset, ...supplyPlacements],
      supplyPanelVisible,
      label: getPanelDisplayName(panel, currentProject),
    }
  }

  type TreeNode = {
    panel: Panel
    surface: Omit<PanelSceneSurface, 'x' | 'y'>
    children: TreeNode[]
    subtreeWidth: number
    x: number
    y: number
  }

  const measureNode = (panel: Panel): TreeNode => {
    const children = includeDescendants
      ? (panel.subPanels ?? []).map((child) => measureNode(child))
      : []
    const childrenWidth =
      children.length > 0
        ? children.reduce((sum, child) => sum + child.subtreeWidth, 0) +
          siblingGap * Math.max(0, children.length - 1)
        : 0
    const surface = buildSurfaceForPanel(panel)
    const subtreeWidth = Math.max(surface.width, childrenWidth)
    return {
      panel,
      surface,
      children,
      subtreeWidth,
      x: 0,
      y: 0,
    }
  }

  const layoutNode = (node: TreeNode, x: number, y: number): void => {
    node.x = x + (node.subtreeWidth - node.surface.width) / 2
    node.y = y
    if (node.children.length === 0) return
    const childrenWidth =
      node.children.reduce((sum, child) => sum + child.subtreeWidth, 0) +
      siblingGap * Math.max(0, node.children.length - 1)
    let cursorX = x + (node.subtreeWidth - childrenWidth) / 2
    const childY = y + node.surface.height + levelGap
    for (const child of node.children) {
      layoutNode(child, cursorX, childY)
      cursorX += child.subtreeWidth + siblingGap
    }
  }

  const rootNodes = rootOptions.map((option) => measureNode(option.panel))
  const rootsWidth =
    rootNodes.reduce((sum, node) => sum + node.subtreeWidth, 0) +
    rootGap * Math.max(0, rootNodes.length - 1)
  const totalSceneWidth = Math.max(sharedWidth, rootsWidth)
  const sharedX = (totalSceneWidth - sharedWidth) / 2
  let rootCursorX = (totalSceneWidth - rootsWidth) / 2
  const rootY = sharedHeight + rootGap
  for (const node of rootNodes) {
    layoutNode(node, rootCursorX, rootY)
    rootCursorX += node.subtreeWidth + rootGap
  }

  const surfaces: PanelSceneSurface[] = [
    {
      id: PANEL_SCENE_SHARED_SUPPLY_ID,
      panel: null,
      kind: 'shared_supply',
      x: sharedX,
      y: 0,
      width: sharedWidth,
      height: sharedHeight,
      mainPanelY: 0,
      supplyPanelY: 0,
      panelFrameHeight: sharedHeight,
      supplyFrameHeight: sharedHeight,
      contentWidth: sharedContentWidth,
      supplyContentWidth: sharedContentWidth,
      supplyRows: 1,
      supplyCols: baseRootCols,
      rows: 1,
      cols: baseRootCols,
      feedFromTop: hierarchyFeedFromTop,
      placements: sharedPlacements.map((placement) => ({
        ...placement,
        x: placement.x + M,
        y: placement.y + M,
        inSupplyPanel: true as const,
      })),
      supplyPanelVisible: true,
      label: sharedSupplyLabel,
    },
  ]
  const connectors: PanelSceneConnector[] = []

  const collect = (node: TreeNode, parent: TreeNode | null) => {
    surfaces.push({
      ...node.surface,
      x: node.x,
      y: node.y,
    })
    const targetCenterX = node.x + node.surface.width / 2
    const targetTopY = node.y
    if (parent == null) {
      const busY = sharedHeight + rootGap / 2
      connectors.push({
        points: routePanelSceneConnector(
          sharedX + sharedWidth / 2,
          sharedHeight,
          targetCenterX,
          targetTopY,
          busY
        ),
      })
    } else {
      const busY = parent.y + parent.surface.height + levelGap / 2
      connectors.push({
        points: routePanelSceneConnector(
          parent.x + parent.surface.width / 2,
          parent.y + parent.surface.height,
          targetCenterX,
          targetTopY,
          busY
        ),
      })
    }
    for (const child of node.children) collect(child, node)
  }
  for (const node of rootNodes) collect(node, null)

  const maxBottom = Math.max(...surfaces.map((surface) => surface.y + surface.height))
  if (!hierarchyFeedFromTop) {
    for (const surface of surfaces) {
      surface.y = maxBottom - surface.y - surface.height
    }
    for (const connector of connectors) {
      connector.points = connector.points.map((value, index) =>
        index % 2 === 1 ? maxBottom - value : value
      )
    }
  }

  const maxRight = Math.max(...surfaces.map((surface) => surface.x + surface.width))
  return {
    width: maxRight,
    height: maxBottom,
    surfaces,
    connectors,
    moduleRefs: new Set(
      surfaces.flatMap((surface) =>
        surface.placements.map((placement) => panelGridModuleRefKey(placement.ref))
      )
    ),
    sharedSupplyTrunkRefKeys: sharedRefKeys,
  }
}
