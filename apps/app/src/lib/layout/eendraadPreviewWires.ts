import type { WireSegment } from '@/types/schema'
import type { LayoutNode } from './layoutTree'

const GEOMETRY_EPSILON = 0.001

function sameCoordinate(a: number, b: number): boolean {
  return Math.abs(a - b) <= GEOMETRY_EPSILON
}

/** Compare preview wires without relying on generated segment IDs. */
export function isSamePreviewWireSegment(a: WireSegment, b: WireSegment): boolean {
  return (
    a.panelId === b.panelId &&
    a.type === b.type &&
    a.circuitId === b.circuitId &&
    a.fromElementId === b.fromElementId &&
    a.fromElementType === b.fromElementType &&
    a.toElementId === b.toElementId &&
    a.toElementType === b.toElementType &&
    a.isSupplyTrunk === b.isSupplyTrunk &&
    a.isSubPanelSupply === b.isSubPanelSupply &&
    a.supplyWireRole === b.supplyWireRole &&
    a.supplyFeedScope === b.supplyFeedScope &&
    a.domoticaOutputGroup === b.domoticaOutputGroup &&
    a.domoticaOutputIndex === b.domoticaOutputIndex &&
    sameCoordinate(a.startPoint.x, b.startPoint.x) &&
    sameCoordinate(a.startPoint.y, b.startPoint.y) &&
    sameCoordinate(a.endPoint.x, b.endPoint.x) &&
    sameCoordinate(a.endPoint.y, b.endPoint.y)
  )
}

/** Keep only preview wires whose topology or geometry differs from the current scene. */
export function getChangedPreviewWireSegments(
  previewSegments: WireSegment[],
  currentSegments: WireSegment[],
  panelId: string,
  previewPanelNode?: LayoutNode,
): WireSegment[] {
  const currentPanelSegments = currentSegments.filter((segment) => segment.panelId === panelId)
  const secondaryBusRootXByCircuitId = new Map<string, number>()
  const visit = (node: LayoutNode) => {
    if (
      node.type === 'mcb' &&
      node.circuitIdForWires &&
      node.children.some((child) => child.type === 'mcb' || child.type === 'secondaryBus')
    ) {
      secondaryBusRootXByCircuitId.set(node.circuitIdForWires, node.bounds.x)
    }
    node.children.forEach(visit)
  }
  if (previewPanelNode) visit(previewPanelNode)

  const normalizedPreviewSegments = previewSegments.flatMap((segment) => {
    const rootX = segment.circuitId
      ? secondaryBusRootXByCircuitId.get(segment.circuitId)
      : undefined
    const isSecondaryBusBar =
      segment.type === 'mainBus' &&
      segment.fromElementType === 'secondaryBus' &&
      segment.toElementType === 'secondaryBus'
    if (!isSecondaryBusBar || rootX == null || segment.startPoint.x >= rootX) {
      return [segment]
    }
    if (segment.endPoint.x <= rootX + GEOMETRY_EPSILON) return []
    return [{ ...segment, startPoint: { ...segment.startPoint, x: rootX } }]
  })

  return normalizedPreviewSegments.filter(
    (previewSegment) =>
      previewSegment.panelId === panelId &&
      !currentPanelSegments.some((currentSegment) =>
        isSamePreviewWireSegment(previewSegment, currentSegment),
      ),
  )
}
