import { logger } from '@/lib/logger'
/**
 * Sitplan scene provider
 * Prepares isolated sitplan scene for export
 */

import Konva from 'konva'
import type { ExportScene, ExportOptions } from '../types'
import { ExportError } from '../types'
import { findContentLayer, findCanvasContentGroup, calculateSceneBounds } from './helpers'
import { useUIStore } from '@/stores/uiStore'
import { useCanvasRegistryStore } from '@/stores/canvasRegistryStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { applyExportThemeToKonvaNodes } from '../konvaThemeExport'
import { exportLog } from '../exportLogger'
import {
  getPlanBackgroundFloorId,
  isFloorPlanBackgroundDarkModeAware,
} from '../planBackgroundExport'
import {
  collectAndRemovePlanGraphicElementsForExport,
  unionSceneBoundsWithPlanGraphicExports,
} from '../planGraphicSvgInject'
import {
  isSitplanSymbolImageForExport,
  stripPlanWireEditOverlayForExport,
  stripWallPointHandlesForExport,
} from '../sitplanExportStrip'
import { collectAndRemoveSymbolImagesForExport } from '../symbolSvgInject'
import type { SymbolExportDescriptor } from '../symbolSvgInject'
import { adjustSymbolImagesForExport } from './symbolImageExport'

const SITPLAN_EXPORT_BOUNDS_PADDING = 80
const PANEL_SYMBOL_CROP_PADDING = 180
const MIN_PANEL_SYMBOL_CROP_AREA_REDUCTION = 0.12

/**
 * Walk up the tree and check if a node is inside an endpoint group.
 */
function isInsideEndpointGroup(node: Konva.Node): boolean {
  let current: Konva.Node | null = node
  while (current) {
    const name = current.name()
    if (name && name.startsWith('endpoint-')) {
      return true
    }
    current = current.getParent()
  }
  return false
}

function symbolDescriptorBounds(desc: SymbolExportDescriptor): {
  x: number
  y: number
  width: number
  height: number
} {
  const matrix = desc.transformMatrix
  if (matrix) {
    const [a, b, c, d, e, f] = matrix
    const corners = [
      { x: 0, y: 0 },
      { x: desc.width, y: 0 },
      { x: desc.width, y: desc.height },
      { x: 0, y: desc.height },
    ].map((point) => ({
      x: a * point.x + c * point.y + e,
      y: b * point.x + d * point.y + f,
    }))
    const xs = corners.map((point) => point.x)
    const ys = corners.map((point) => point.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...xs)
    const maxY = Math.max(...ys)
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }

  const halfW = desc.width / 2
  const halfH = desc.height / 2
  const rad = (desc.rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const corners = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ].map((point) => ({
    x: desc.x + point.x * cos - point.y * sin,
    y: desc.y + point.x * sin + point.y * cos,
  }))
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function calculatePanelSymbolCropBounds(
  fullBounds: ReturnType<typeof calculateSceneBounds>,
  symbolExports: SymbolExportDescriptor[],
): ReturnType<typeof calculateSceneBounds> | null {
  if (symbolExports.length === 0) return null

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const symbol of symbolExports) {
    const bounds = symbolDescriptorBounds(symbol)
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null

  const crop = {
    x: minX - PANEL_SYMBOL_CROP_PADDING,
    y: minY - PANEL_SYMBOL_CROP_PADDING,
    width: Math.max(1, maxX - minX + PANEL_SYMBOL_CROP_PADDING * 2),
    height: Math.max(1, maxY - minY + PANEL_SYMBOL_CROP_PADDING * 2),
    space: 'scene' as const,
  }

  const fullArea = fullBounds.width * fullBounds.height
  const cropArea = crop.width * crop.height
  if (fullArea <= 0 || cropArea >= fullArea * (1 - MIN_PANEL_SYMBOL_CROP_AREA_REDUCTION)) {
    return null
  }

  return crop
}

function expandSceneBounds(
  bounds: ReturnType<typeof calculateSceneBounds>,
  padding: number,
): ReturnType<typeof calculateSceneBounds> {
  if (padding <= 0) return bounds
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
    space: 'scene',
  }
}

/**
 * Prepare isolated sitplan scene for export
 * 
 * @param floorId Floor ID
 * @param options Export options
 * @returns Isolated export scene
 */
export async function prepareSitplanScene(
  floorId: string,
  options: ExportOptions,
  panelId?: string | null,
): Promise<ExportScene> {
  const sourceTheme = useSettingsStore.getState().theme.mode
  const targetTheme = options.theme
  // 1. Ensure floor is active (canvas only renders the active floor)
  const { setActiveFloor, setSitplanPanelFilterId } = useUIStore.getState()
  const wasActive = useUIStore.getState().activeFloorId === floorId
  const currentPanelFilterId = useUIStore.getState().sitplanPanelFilterId

  if ((panelId ?? null) !== currentPanelFilterId) {
    setSitplanPanelFilterId(panelId ?? null)
    await new Promise(resolve => requestAnimationFrame(resolve))
    await new Promise(resolve => requestAnimationFrame(resolve))
    await new Promise(resolve => setTimeout(resolve, 120))
  }
  
  if (!wasActive) {
    exportLog(`[Export] Switching to floor ${floorId} (was: ${useUIStore.getState().activeFloorId})`)
    setActiveFloor(floorId)
    // Wait for React to render and canvas to update
    await new Promise(resolve => requestAnimationFrame(resolve))
    await new Promise(resolve => requestAnimationFrame(resolve))
    await new Promise(resolve => setTimeout(resolve, 300)) // Wait for canvas to render the new floor
  }
  
  // 2. Get stage from registry (now always returns stage if canvas is mounted)
  const canvasRegistry = useCanvasRegistryStore.getState().registry
  let stage = canvasRegistry.sitplan?.getStage(floorId)
  
  // Retry a few times in case stage isn't immediately available
  if (!stage) {
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve))
      stage = canvasRegistry.sitplan?.getStage(floorId)
      if (stage) break
    }
  }
  
  if (!stage) {
    throw new ExportError('STAGE_UNAVAILABLE', `Floor ${floorId} stage not available. Canvas may not be mounted.`)
  }
  
  exportLog(`[Export] Got sitplan stage for ${floorId}, layers: ${stage.getLayers().length}`)

  // 3. Find canvas-content Group explicitly
  const contentLayer = findContentLayer(stage)
  
  // Search children of content layer for canvas-content group
  const children = contentLayer.getChildren()
  let canvasContentGroup: Konva.Group | null = null
  
  for (const child of children) {
    canvasContentGroup = findCanvasContentGroup(child)
    if (canvasContentGroup) break
  }
  
  if (!canvasContentGroup) {
    // Log all children of content layer for debugging
    logger.error(`[Export] canvas-content group not found. Content layer has ${children.length} children:`)
    children.forEach((child, idx) => {
      logger.error(`[Export]   Child ${idx}: type=${child.getType()}, name=${child.name()}`)
    })
    throw new ExportError('NO_CONTENT', `Floor ${floorId} has no canvas-content group`)
  }
  
  exportLog(`[Export] Found canvas-content group for floor ${floorId}`)
  
  // 4. Clone into isolated temporary stage
  const tempStage = new Konva.Stage({
    container: document.createElement('div'),
    width: stage.width(),
    height: stage.height(),
  })
  
  const tempLayer = new Konva.Layer()
  tempStage.add(tempLayer)
  
  // Clone canvas-content Group (deep clone, no live references)
  const clonedGroup = canvasContentGroup.clone({
    // Clone all children recursively
    deep: true,
  })
  
  // Reset transforms to identity (scene space is canvas-content space)
  clonedGroup.x(0)
  clonedGroup.y(0)
  clonedGroup.scaleX(1)
  clonedGroup.scaleY(1)
  clonedGroup.rotation(0)

  stripWallPointHandlesForExport(clonedGroup)
  stripPlanWireEditOverlayForExport(clonedGroup)

  const planGraphicExports = await collectAndRemovePlanGraphicElementsForExport(
    clonedGroup,
    targetTheme
  )

  const symbolExports = collectAndRemoveSymbolImagesForExport(clonedGroup)

  if (sourceTheme !== targetTheme) {
    applyExportThemeToKonvaNodes(clonedGroup, sourceTheme, targetTheme)
  }

  // Embed non-symbol images (floor plan backgrounds) for SVG/PDF export.
  await adjustSymbolImagesForExport(clonedGroup, sourceTheme, targetTheme, {
    shouldInvertImage: (imageNode) => {
      if (sourceTheme === targetTheme) return false
      if (isInsideEndpointGroup(imageNode)) return false
      if (isSitplanSymbolImageForExport(imageNode)) return false
      const floorId = getPlanBackgroundFloorId(imageNode)
      if (!floorId) return false
      return isFloorPlanBackgroundDarkModeAware(floorId)
    },
  })
  
  tempLayer.add(clonedGroup)
  tempStage.draw()

  // 5. Calculate bounds in scene coordinate space.
  // Fallback to stage size when getClientRect returns invalid (e.g. plan with images + vector walls).
  const fullBounds = expandSceneBounds(
    unionSceneBoundsWithPlanGraphicExports(
      calculateSceneBounds(clonedGroup, {
        x: 0,
        y: 0,
        width: tempStage.width(),
        height: tempStage.height(),
        space: 'scene',
      }),
      planGraphicExports
    ),
    SITPLAN_EXPORT_BOUNDS_PADDING
  )
  const panelCropBounds =
    panelId != null ? calculatePanelSymbolCropBounds(fullBounds, symbolExports) : null
  const bounds = panelCropBounds ?? fullBounds
  if (panelCropBounds) {
    exportLog('[Export] Cropped sitplan panel page to symbol frame', {
      floorId,
      panelId,
      fullBounds,
      bounds: panelCropBounds,
      symbolCount: symbolExports.length,
    })
  }

  // 6. Return isolated scene
  return {
    id: `sitplan-${floorId}`,
    kind: 'sitplan',
    renderedTheme: targetTheme,
    rootNode: clonedGroup, // Isolated clone, safe to export
    bounds,
    preferredOrientation: 'portrait', // Will be determined by bounds
    planGraphicExports: planGraphicExports.length > 0 ? planGraphicExports : undefined,
    symbolExports: symbolExports.length > 0 ? symbolExports : undefined,
  }
}
