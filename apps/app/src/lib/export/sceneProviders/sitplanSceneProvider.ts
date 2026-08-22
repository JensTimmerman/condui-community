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
const PLAN_CONTENT_ALPHA_THRESHOLD = 16
const PLAN_CONTENT_WHITE_THRESHOLD = 245

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

function boundsUnion(
  a: ReturnType<typeof calculateSceneBounds>,
  b: ReturnType<typeof calculateSceneBounds>,
): ReturnType<typeof calculateSceneBounds> {
  const minX = Math.min(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxX = Math.max(a.x + a.width, b.x + b.width)
  const maxY = Math.max(a.y + a.height, b.y + b.height)
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    space: 'scene',
  }
}

function cornerBounds(points: Array<{ x: number; y: number }>): ReturnType<typeof calculateSceneBounds> | null {
  if (points.length === 0) return null
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    space: 'scene',
  }
}

function imageSourceSize(source: CanvasImageSource): { width: number; height: number } | null {
  if (source instanceof HTMLImageElement) {
    const width = source.naturalWidth || source.width
    const height = source.naturalHeight || source.height
    return width > 0 && height > 0 ? { width, height } : null
  }
  if (source instanceof HTMLCanvasElement || source instanceof OffscreenCanvas) {
    return source.width > 0 && source.height > 0
      ? { width: source.width, height: source.height }
      : null
  }
  if (source instanceof ImageBitmap) {
    return source.width > 0 && source.height > 0 ? { width: source.width, height: source.height } : null
  }
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    const width = source.videoWidth || source.width
    const height = source.videoHeight || source.height
    return width > 0 && height > 0 ? { width, height } : null
  }
  return null
}

function detectNonEmptyLocalImageBounds(
  source: CanvasImageSource,
): { x: number; y: number; width: number; height: number } | null {
  const size = imageSourceSize(source)
  if (!size) return null

  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  try {
    context.drawImage(source, 0, 0, size.width, size.height)
    const imageData = context.getImageData(0, 0, size.width, size.height).data

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        const index = (y * size.width + x) * 4
        const r = imageData[index] ?? 255
        const g = imageData[index + 1] ?? 255
        const b = imageData[index + 2] ?? 255
        const a = imageData[index + 3] ?? 0
        const visible = a >= PLAN_CONTENT_ALPHA_THRESHOLD
        const notMostlyWhite =
          r < PLAN_CONTENT_WHITE_THRESHOLD ||
          g < PLAN_CONTENT_WHITE_THRESHOLD ||
          b < PLAN_CONTENT_WHITE_THRESHOLD
        if (!visible || !notMostlyWhite) continue
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }

    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null
    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX + 1),
      height: Math.max(1, maxY - minY + 1),
    }
  } catch {
    return null
  }
}

function transformLocalRectToSceneBounds(
  root: Konva.Group,
  imageNode: Konva.Image,
  localRect: { x: number; y: number; width: number; height: number },
  sourceSize: { width: number; height: number },
): ReturnType<typeof calculateSceneBounds> | null {
  const rootInverse = root.getAbsoluteTransform().copy().invert()
  const relative = rootInverse.multiply(imageNode.getAbsoluteTransform())
  const nodeWidth = imageNode.width()
  const nodeHeight = imageNode.height()
  if (!Number.isFinite(nodeWidth) || !Number.isFinite(nodeHeight) || nodeWidth <= 0 || nodeHeight <= 0) {
    return null
  }

  if (
    !Number.isFinite(sourceSize.width) ||
    !Number.isFinite(sourceSize.height) ||
    sourceSize.width <= 0 ||
    sourceSize.height <= 0
  ) {
    return null
  }

  const x0 = (localRect.x / sourceSize.width) * nodeWidth
  const y0 = (localRect.y / sourceSize.height) * nodeHeight
  const x1 = ((localRect.x + localRect.width) / sourceSize.width) * nodeWidth
  const y1 = ((localRect.y + localRect.height) / sourceSize.height) * nodeHeight

  const corners = [
    relative.point({ x: x0, y: y0 }),
    relative.point({ x: x1, y: y0 }),
    relative.point({ x: x1, y: y1 }),
    relative.point({ x: x0, y: y1 }),
  ]

  return cornerBounds(corners)
}

async function collectPlanImageContentBounds(root: Konva.Group): Promise<ReturnType<typeof calculateSceneBounds> | null> {
  const imageNodes = root.find((node: Konva.Node) => {
    if (!(node instanceof Konva.Image)) return false
    return !isSitplanSymbolImageForExport(node)
  }) as Konva.Image[]

  let mergedBounds: ReturnType<typeof calculateSceneBounds> | null = null
  for (const imageNode of imageNodes) {
    const source = imageNode.image()
    if (!source) continue
    const sourceSize = imageSourceSize(source)
    if (!sourceSize) continue
    const localBounds = detectNonEmptyLocalImageBounds(source)
    if (!localBounds) continue
    const sceneBounds = transformLocalRectToSceneBounds(root, imageNode, localBounds, sourceSize)
    if (!sceneBounds) continue
    mergedBounds = mergedBounds ? boundsUnion(mergedBounds, sceneBounds) : sceneBounds
  }

  return mergedBounds
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
  const planImageContentBounds = panelCropBounds ? await collectPlanImageContentBounds(clonedGroup) : null
  const protectedPanelCropBounds =
    panelCropBounds && planImageContentBounds
      ? boundsUnion(panelCropBounds, expandSceneBounds(planImageContentBounds, SITPLAN_EXPORT_BOUNDS_PADDING))
      : panelCropBounds
  const bounds = protectedPanelCropBounds ?? fullBounds
  if (protectedPanelCropBounds) {
    exportLog('[Export] Cropped sitplan panel page to symbol frame', {
      floorId,
      panelId,
      fullBounds,
      bounds: protectedPanelCropBounds,
      symbolCount: symbolExports.length,
      hasPlanContentProtection: !!planImageContentBounds,
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
