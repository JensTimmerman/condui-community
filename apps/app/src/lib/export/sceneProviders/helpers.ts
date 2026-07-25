import { logger } from '@/lib/logger'
/**
 * Helper functions for scene providers
 */

import type Konva from 'konva'
import { ExportError } from '../types'
import { exportLog } from '../exportLogger'

/**
 * Find the content layer (listening layer with canvas-content Group)
 */
export function findContentLayer(stage: Konva.Stage): Konva.Layer {
  const layers = stage.getLayers()
  
  exportLog(`[Export] Finding content layer: ${layers.length} layers on stage`)
  
  // Primary: Find layer with canvas-content Group
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!
    const isListening = layer.listening()
    const children = layer.getChildren()
    
    exportLog(`[Export] Layer ${i}: listening=${isListening}, children=${children.length}`)
    
    if (!isListening) continue // Skip UI layers
    
    for (let j = 0; j < children.length; j++) {
      const child = children[j]!
      const childName = child.name()
      const childType = child.getType()
      exportLog(`[Export] Layer ${i}, child ${j}: type=${childType}, name=${childName}`)
      
      if (findCanvasContentGroup(child)) {
        exportLog(`[Export] Found canvas-content group in layer ${i}, child ${j}`)
        return layer
      }
    }
  }
  
  logger.error(`[Export] No content layer found. Stage has ${layers.length} layers`)
  throw new ExportError('NO_CONTENT', `No content layer found. Stage has ${layers.length} layer(s)`)
}

/**
 * Find canvas-content Group recursively
 */
export function findCanvasContentGroup(node: Konva.Node, depth: number = 0): Konva.Group | null {
  const nodeType = node.getType()
  const nodeName = node.name()
  
  // Log at top level to see what we're searching
  if (depth === 0) {
    exportLog(`[Export] Searching for canvas-content group in node: type=${nodeType}, name=${nodeName}`)
  }
  
  if (nodeType === 'Group' && nodeName === 'canvas-content') {
    exportLog(`[Export] Found canvas-content group at depth ${depth}`)
    return node as Konva.Group
  }
  
  if (nodeType === 'Group') {
    const group = node as Konva.Group
    const children = group.getChildren()
    
    if (depth < 3) { // Only log first few levels
      exportLog(`[Export] Checking Group "${nodeName}" at depth ${depth}, ${children.length} children`)
      children.slice(0, 5).forEach((child, idx) => {
        exportLog(`[Export]   Child ${idx}: type=${child.getType()}, name=${child.name()}`)
      })
    }
    
    for (const child of children) {
      const found = findCanvasContentGroup(child, depth + 1)
      if (found) return found
    }
  }
  
  return null
}

export type SceneBoundsResult = {
  x: number
  y: number
  width: number
  height: number
  space: 'scene'
}

/**
 * Calculate scene bounds from a root node.
 * When the node has images or complex content, getClientRect can sometimes return
 * zero or invalid bounds (e.g. cloned nodes before layout). Pass fallback to use
 * stage dimensions in that case instead of throwing.
 */
export function calculateSceneBounds(
  rootNode: Konva.Group | Konva.Layer,
  fallback?: SceneBoundsResult
): SceneBoundsResult {
  const bounds = rootNode.getClientRect({ skipTransform: false })

  const valid =
    bounds &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0

  if (valid) {
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      space: 'scene',
    }
  }

  if (fallback && fallback.width > 0 && fallback.height > 0) {
    logger.warn(
      '[Export] Scene bounds invalid (width or height <= 0), using fallback dimensions.',
      { computed: bounds, fallback }
    )
    return fallback
  }

  throw new ExportError('BOUNDS_INVALID', 'Invalid scene bounds')
}
