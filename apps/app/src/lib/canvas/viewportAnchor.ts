import type { Point } from '@/types/ui'
import type { LayoutNode } from '@/lib/layout/layoutTree'

/** Keep one world-space point at the same screen position after a relayout. */
export function getPanPreservingWorldAnchor(
  pan: Point,
  zoom: number,
  previousAnchor: Point,
  nextAnchor: Point
): Point {
  return {
    x: pan.x + (previousAnchor.x - nextAnchor.x) * zoom,
    y: pan.y + (previousAnchor.y - nextAnchor.y) * zoom,
  }
}

/** Find the rendered copy of a domain node nearest to the anchor used for the interaction. */
export function findClosestLayoutNodeAnchor(
  roots: LayoutNode[],
  domainId: string,
  previousAnchor: Point
): Point | null {
  let closestAnchor: Point | null = null
  let closestDistanceSquared = Number.POSITIVE_INFINITY

  const visit = (node: LayoutNode): void => {
    if (node.type === 'trunkDevice' && node.domainId === domainId) {
      const anchor = node.connectionAnchor ?? { x: node.bounds.x, y: node.bounds.y }
      const distanceSquared =
        (anchor.x - previousAnchor.x) ** 2 + (anchor.y - previousAnchor.y) ** 2
      if (distanceSquared < closestDistanceSquared) {
        closestAnchor = anchor
        closestDistanceSquared = distanceSquared
      }
    }
    node.children.forEach(visit)
  }

  roots.forEach(visit)
  return closestAnchor
}
