/**
 * Pure construction of the panel hierarchy scene (surfaces + connectors).
 * Used by PanelCanvas / HierarchyPanelCanvas for both full-tree and filtered views.
 */
import { getAllSupplyTrunkDevices, getPanelFeedProjection } from '@/lib/feedTopology'
import { getPanelDisplayName } from '@/utils/panelNames'
import type { Panel, PanelGridModuleRef } from '@/types/schema'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  getAuxiliaryElectricalEnclosuresFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import {
  getAuxiliaryEnclosureSupplyDeviceIds,
  MIN_AUXILIARY_COLUMNS,
  resolveSupplyDeviceMounting,
} from '@/lib/panel/auxiliarySupplyEnclosures'
import type { AuxiliaryElectricalEnclosure } from '@/types/supplyAssembly'
import {
  CELL_H,
  CELL_W,
  ROW_GAP,
  getPanelGridPlacements,
  getSupplyPanelColumns,
  getSupplyPanelRows,
  getSupplyPanelPlacements,
  panelGridModuleRefKey,
  type ModulePlacement,
} from '@/components/canvas/panel/panelGridLayout'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import {
  findConverterBackupPanelFeed,
  findConverterBackupPanelFeedsFromSource,
  type ConverterBackupPanelFeed,
} from '@/lib/panel/converterBackupPanelFeed'

export const PANEL_SCENE_FRAME_MARGIN = 40
/** Vertical gap between main and supply regions on one panel surface (matches legacy PanelCanvas). */
export const PANEL_SCENE_SUPPLY_GAP = 20
export const PANEL_SCENE_SHARED_SUPPLY_ID = 'shared-supply'

export type PanelScenePanelOption = {
  id: string
  panel: Panel
  isRoot: boolean
}

export type PanelSceneSurfaceKind = 'shared_supply' | 'auxiliary' | 'panel'

export interface PanelSceneSurface {
  id: string
  panel: Panel | null
  enclosure?: AuxiliaryElectricalEnclosure
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
  converterBackupFeed?: ConverterBackupPanelFeed | null
  converterBackupSourceFeed?: ConverterBackupPanelFeed | null
}

export interface PanelSceneConnector {
  points: number[]
}

export interface ConverterBackupFeedMarkerGeometry {
  sourceX: number
  sourceY: number
  symbolSize: number
  wirePaths: number[][]
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

/** Virtual converter source below its physical board, feeding the real outgoing protection. */
export function getConverterBackupFeedMarkerGeometry(
  surface: PanelSceneSurface
): ConverterBackupFeedMarkerGeometry | null {
  if (!surface.converterBackupSourceFeed || !surface.panel) return null
  const targets = surface.placements.filter(
    (placement) =>
      placement.ref.kind === 'protection' &&
      placement.ref.id === surface.converterBackupSourceFeed?.protectionId
  )
  const sourceX =
    targets.length > 0
      ? targets.reduce((sum, target) => sum + target.x + target.width / 2, 0) / targets.length
      : surface.width / 2
  const frameBottom = surface.mainPanelY + surface.panelFrameHeight
  const sourceY = frameBottom + 48
  const symbolSize = 32
  const busY = frameBottom + 18
  const wirePaths =
    targets.length > 0
      ? targets.map((target) => {
          const targetX = target.x + target.width / 2
          const targetY = target.y + target.height
          return [sourceX, sourceY - symbolSize / 2, sourceX, busY, targetX, busY, targetX, targetY]
        })
      : [[sourceX, sourceY - symbolSize / 2, sourceX, frameBottom]]
  return { sourceX, sourceY, symbolSize, wirePaths }
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

export function routePanelSceneSurfaceTransition(
  source: Pick<PanelSceneSurface, 'x' | 'y' | 'width' | 'height'>,
  target: Pick<PanelSceneSurface, 'x' | 'y' | 'width' | 'height'>
): number[] {
  const sourceCenterX = source.x + source.width / 2
  const sourceCenterY = source.y + source.height / 2
  const targetCenterX = target.x + target.width / 2
  const targetCenterY = target.y + target.height / 2
  const dx = targetCenterX - sourceCenterX
  const dy = targetCenterY - sourceCenterY
  if (Math.abs(dx) > Math.abs(dy)) {
    const sourceX = dx >= 0 ? source.x + source.width : source.x
    const targetX = dx >= 0 ? target.x : target.x + target.width
    const corridorX = (sourceX + targetX) / 2
    return [
      sourceX,
      sourceCenterY,
      corridorX,
      sourceCenterY,
      corridorX,
      targetCenterY,
      targetX,
      targetCenterY,
    ]
  }
  const sourceY = dy >= 0 ? source.y + source.height : source.y
  const targetY = dy >= 0 ? target.y : target.y + target.height
  return routePanelSceneConnector(
    sourceCenterX,
    sourceY,
    targetCenterX,
    targetY,
    (sourceY + targetY) / 2
  )
}

/**
 * Visible frame-to-frame links for topology-only panel feeders.
 * These extend into both panel frames because there is intentionally no DIN module to terminate on.
 */
export function buildDirectPanelFeederConnectors(
  surfaces: PanelSceneSurface[],
  project: ProjectWithOptionalV2Electrical
): PanelSceneConnector[] {
  const surfaceByPanelId = new Map(
    surfaces
      .filter((surface): surface is PanelSceneSurface & { panel: Panel } => surface.panel != null)
      .map((surface) => [surface.panel.id, surface] as const)
  )
  const connectors: PanelSceneConnector[] = []
  const seenLinks = new Set<string>()

  const visit = (panel: Panel): void => {
    const sourceSurface = surfaceByPanelId.get(panel.id)
    if (sourceSurface) {
      for (const protection of panel.protections) {
        const targetPanelId = protection.directPanelFeeder ? protection.subPanelId : undefined
        if (!targetPanelId) continue
        const targetSurface = surfaceByPanelId.get(targetPanelId)
        const linkKey = `${panel.id}:${targetPanelId}`
        if (!targetSurface || seenLinks.has(linkKey)) continue
        seenLinks.add(linkKey)

        const sourceCenterY =
          sourceSurface.y + sourceSurface.mainPanelY + sourceSurface.panelFrameHeight / 2
        const targetCenterY =
          targetSurface.y + targetSurface.mainPanelY + targetSurface.panelFrameHeight / 2
        const targetIsAbove = targetCenterY < sourceCenterY
        const sourceX = sourceSurface.x + sourceSurface.width / 2
        const targetX = targetSurface.x + targetSurface.width / 2
        const sourceY = targetIsAbove
          ? sourceSurface.y + sourceSurface.mainPanelY + PANEL_SCENE_FRAME_MARGIN
          : sourceSurface.y +
            sourceSurface.mainPanelY +
            sourceSurface.panelFrameHeight -
            PANEL_SCENE_FRAME_MARGIN
        const targetY = targetIsAbove
          ? targetSurface.y +
            targetSurface.mainPanelY +
            targetSurface.panelFrameHeight -
            PANEL_SCENE_FRAME_MARGIN
          : targetSurface.y + targetSurface.mainPanelY + PANEL_SCENE_FRAME_MARGIN

        connectors.push({
          points: routePanelSceneConnector(
            sourceX,
            sourceY,
            targetX,
            targetY,
            (sourceY + targetY) / 2
          ),
        })
      }
    }
    for (const subPanel of panel.subPanels ?? []) visit(subPanel)
  }

  for (const panel of getElectricalPanelsFromProject(project)) visit(panel)
  return connectors
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

  const hasConverterBackupRoot = rootOptions.some((option) =>
    findConverterBackupPanelFeed(currentProject, option.panel.id)
  )
  const rootGap = hasConverterBackupRoot ? 120 : 56
  const levelGap = 72
  const siblingGap = 48

  const installation = getElectricalInstallationFromProject(currentProject)
  const rootPanels = getElectricalPanelsFromProject(currentProject)
  const sharedRefs: PanelGridModuleRef[] = getAllSupplyTrunkDevices(currentProject)
    .filter((device) => device.type !== 'junction_box' && device.type !== 'junction_panel')
    .filter((device) => resolveSupplyDeviceMounting(currentProject, device.id)?.kind === 'grid')
    .map((device) => ({ kind: 'trunkDevice' as const, id: device.id, scope: 'supply' as const }))
  const sharedRefKeys = new Set(sharedRefs.map((ref) => panelGridModuleRefKey(ref)))
  const baseRootCols = firstRootOption.panel.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS
  const sharedSlotMap = new Map(
    (firstRootOption.panel.gridView?.supplyPanelSlots ?? [])
      .filter((slot) => sharedRefKeys.has(panelGridModuleRefKey(slot.module)))
      .map((slot) => [panelGridModuleRefKey(slot.module), slot] as const)
  )

  const sharedLayoutPanel: Panel = {
    ...firstRootOption.panel,
    gridView: {
      rows: 1,
      columns: baseRootCols,
      feedFromTop: hierarchyFeedFromTop,
      slots: [...sharedSlotMap.values()],
    },
  }
  const sharedPlacements = getPanelGridPlacements(
    sharedLayoutPanel,
    currentProject,
    sharedRefs.map((ref) => ({ ref, slot: sharedSlotMap.get(panelGridModuleRefKey(ref)) }))
  )
  const baseRootContentWidth = baseRootCols * CELL_W
  const sharedContentWidth = baseRootContentWidth
  const sharedWidth = sharedContentWidth + PANEL_SCENE_FRAME_MARGIN * 2
  const sharedHeight = CELL_H + PANEL_SCENE_FRAME_MARGIN * 2

  const M = PANEL_SCENE_FRAME_MARGIN
  const GAP = PANEL_SCENE_SUPPLY_GAP

  const buildSurfaceForPanel = (panel: Panel): Omit<PanelSceneSurface, 'x' | 'y'> => {
    const rows = panel.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS
    const cols = panel.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS
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
    const converterBackupFeed = findConverterBackupPanelFeed(currentProject, panel.id)
    const converterBackupSourceFeed =
      findConverterBackupPanelFeedsFromSource(currentProject, panel.id)[0] ?? null

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
      converterBackupFeed,
      converterBackupSourceFeed,
    }
  }

  const supplyDeviceIds = new Set(getAllSupplyTrunkDevices(currentProject).map(({ id }) => id))
  const buildSurfaceForEnclosure = (enclosure: AuxiliaryElectricalEnclosure): PanelSceneSurface => {
    const rows = Math.max(1, enclosure.gridView.rows)
    const cols = Math.max(MIN_AUXILIARY_COLUMNS, enclosure.gridView.columns)
    const contentWidth = cols * CELL_W
    const contentHeight = rows * CELL_H + Math.max(0, rows - 1) * ROW_GAP
    const slotByKey = new Map(
      enclosure.gridView.slots.map((slot) => [panelGridModuleRefKey(slot.module), slot] as const)
    )
    const auxiliaryRefs = getAuxiliaryEnclosureSupplyDeviceIds(currentProject, enclosure.id)
      .filter((deviceId) => supplyDeviceIds.has(deviceId))
      .map(
        (deviceId): PanelGridModuleRef => ({
          kind: 'trunkDevice',
          id: deviceId,
          scope: 'supply',
        })
      )
    const layoutPanel: Panel = {
      ...firstRootOption.panel,
      gridView: { ...enclosure.gridView, rows, columns: cols },
    }
    const placements = getPanelGridPlacements(
      layoutPanel,
      currentProject,
      auxiliaryRefs.map((ref) => ({
        ref,
        slot: slotByKey.get(panelGridModuleRefKey(ref)),
      }))
    ).map((placement) => ({
      ...placement,
      x: placement.x + M,
      y: placement.y + M,
      inSupplyPanel: true as const,
    }))
    return {
      id: enclosure.id,
      panel: null,
      enclosure,
      kind: 'auxiliary',
      x: enclosure.panelViewPosition?.x ?? 0,
      y: sharedHeight + rootGap,
      width: contentWidth + M * 2,
      height: contentHeight + M * 2,
      mainPanelY: 0,
      supplyPanelY: 0,
      panelFrameHeight: contentHeight + M * 2,
      supplyFrameHeight: contentHeight + M * 2,
      contentWidth,
      supplyContentWidth: contentWidth,
      supplyRows: rows,
      supplyCols: cols,
      rows,
      cols,
      feedFromTop: enclosure.gridView.feedFromTop,
      placements,
      supplyPanelVisible: true,
      label: enclosure.name,
      converterBackupFeed: null,
      converterBackupSourceFeed: null,
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

  const auxiliaryEnclosures = getAuxiliaryElectricalEnclosuresFromProject(currentProject).filter(
    (enclosure) => enclosure.hidden !== true
  )
  const auxiliarySurfaces = auxiliaryEnclosures
    .map(buildSurfaceForEnclosure)
    .sort((left, right) => {
      const leftX = left.enclosure?.panelViewPosition?.x ?? 0
      const rightX = right.enclosure?.panelViewPosition?.x ?? 0
      return leftX - rightX || left.id.localeCompare(right.id)
    })
  const auxiliaryBandHeight = auxiliarySurfaces.reduce(
    (height, surface) => Math.max(height, surface.height),
    0
  )
  const auxiliaryGap = 56
  const minimumPreferredX =
    auxiliarySurfaces.length > 0
      ? Math.min(
          ...auxiliarySurfaces.map((surface) => surface.enclosure?.panelViewPosition?.x ?? 0)
        )
      : 0
  let auxiliaryCursorX = 0
  for (const surface of auxiliarySurfaces) {
    const preferredX = (surface.enclosure?.panelViewPosition?.x ?? 0) - minimumPreferredX
    surface.x = Math.max(preferredX, auxiliaryCursorX)
    auxiliaryCursorX = surface.x + surface.width + auxiliaryGap
  }
  const auxiliaryWidth = Math.max(0, auxiliaryCursorX - auxiliaryGap)
  const rootNodes = rootOptions.map((option) => measureNode(option.panel))
  const rootsWidth =
    rootNodes.reduce((sum, node) => sum + node.subtreeWidth, 0) +
    rootGap * Math.max(0, rootNodes.length - 1)
  const totalSceneWidth = Math.max(sharedWidth, rootsWidth, auxiliaryWidth)
  const sharedX = (totalSceneWidth - sharedWidth) / 2
  const auxiliaryOffsetX = (totalSceneWidth - auxiliaryWidth) / 2
  for (const surface of auxiliarySurfaces) surface.x += auxiliaryOffsetX
  let rootCursorX = (totalSceneWidth - rootsWidth) / 2
  const rootY =
    sharedHeight + rootGap + (auxiliaryBandHeight > 0 ? auxiliaryBandHeight + rootGap : 0)
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
      converterBackupFeed: null,
      converterBackupSourceFeed: null,
    },
    ...auxiliarySurfaces,
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
    if (parent != null) {
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

  const sharedSurface = surfaces.find((surface) => surface.kind === 'shared_supply')!
  for (const rootNode of rootNodes) {
    if (rootNode.surface.converterBackupFeed) continue
    const rootSurface = surfaces.find(
      (surface) => surface.kind === 'panel' && surface.panel?.id === rootNode.panel.id
    )!
    const rootSupplyDevices = installation
      ? (getPanelFeedProjection(installation, rootPanels, rootNode.panel)?.devices ?? [])
      : []
    const surfaceForDevice = (deviceId: string): PanelSceneSurface | undefined => {
      const mounting = resolveSupplyDeviceMounting(currentProject, deviceId)
      if (!mounting || mounting.kind === 'grid') return sharedSurface
      if (mounting.kind === 'auxiliary') {
        return surfaces.find(
          (surface) => surface.kind === 'auxiliary' && surface.id === mounting.enclosureId
        )
      }
      return surfaces.find(
        (surface) => surface.kind === 'panel' && surface.panel?.id === mounting.panelId
      )
    }
    const transitionChain = [
      sharedSurface,
      ...rootSupplyDevices.map((device) => surfaceForDevice(device.id)),
      rootSurface,
    ].filter((surface): surface is PanelSceneSurface => surface != null)
    const collapsedTransitionChain = transitionChain.filter(
      (surface, index) => index === 0 || transitionChain[index - 1]?.id !== surface.id
    )
    for (let index = 0; index < collapsedTransitionChain.length - 1; index++) {
      connectors.push({
        points: routePanelSceneSurfaceTransition(
          collapsedTransitionChain[index]!,
          collapsedTransitionChain[index + 1]!
        ),
      })
    }
  }

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
