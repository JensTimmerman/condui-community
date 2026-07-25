import type { LayoutTree, LayoutNode } from '@/lib/layout/layoutTree'

// Symbol nodes use CENTER-based positioning (Konva offsetX/offsetY); others use TOP-LEFT
const CENTER_BASED_TYPES = new Set(['mcb', 'rcd', 'endpoint', 'supply', 'ground', 'trunkDevice'])

function getEffectiveBounds(node: LayoutNode): { left: number; top: number; right: number; bottom: number } {
  const b = node.bounds
  if (CENTER_BASED_TYPES.has(node.type)) {
    return {
      left: b.x - b.width / 2,
      top: b.y - b.height / 2,
      right: b.x + b.width / 2,
      bottom: b.y + b.height / 2,
    }
  }
  return {
    left: b.x,
    top: b.y,
    right: b.x + b.width,
    bottom: b.y + b.height,
  }
}

/**
 * Find elements that intersect with a selection rectangle using the layout tree.
 * Uses the same center-vs-top-left bounds as drop target detection so rect selection
 * aligns with what is actually drawn.
 */
export function createFindElementsInRectangleHandler(
  layoutTree: LayoutTree | null
) {
  return (rect: { x: number; y: number; width: number; height: number }) => {
    const results: Array<{ id: string; type: 'endpoint' | 'circuit' | 'protection' | 'wire' | 'trunkDevice' }> = []
    if (!layoutTree) return results

    const padding = 2 // Small padding for easier selection
    const rectRight = rect.x + rect.width
    const rectBottom = rect.y + rect.height

    const walkNode = (node: LayoutNode) => {
      const eff = getEffectiveBounds(node)
      const left = eff.left - padding
      const right = eff.right + padding
      const top = eff.top - padding
      const bottom = eff.bottom + padding

      const intersects =
        left < rectRight &&
        right > rect.x &&
        top < rectBottom &&
        bottom > rect.y

      if (intersects) {
        if (node.type === 'endpoint' && node.domainId) {
          results.push({ id: node.domainId, type: 'endpoint' })
        } else if ((node.type === 'mcb' || node.type === 'rcd') && node.domainId) {
          results.push({ id: node.domainId, type: 'protection' })
        } else if (node.type === 'trunkDevice' && node.domainId) {
          results.push({ id: node.domainId, type: 'trunkDevice' })
        }
      }

      for (const child of node.children) {
        walkNode(child)
      }
    }

    for (const panelNode of layoutTree.panels) {
      walkNode(panelNode)
    }

    return results
  }
}
