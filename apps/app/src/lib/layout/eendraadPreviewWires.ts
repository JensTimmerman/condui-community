import type { WireSegment } from '@/types/schema'
import type { BottomUpPanelLayout } from './bottomUpLayout'
import type { LayoutNode } from './layoutTree'

const GEOMETRY_EPSILON = 0.001

export interface PreviewPanelTranslation {
  x: number
  y: number
}

/**
 * Keep a detached supply preview on the same visual anchor as the committed frame.
 *
 * Supply frames are allowed to grow to the left and may be moved down when the
 * simulated frame would overlap another panel. The electrical handoff is the
 * stable point in both cases; the frame bounds are not.
 */
export function getPreviewPanelTranslation(
  currentPanelLayout: BottomUpPanelLayout | undefined,
  previewPanelLayout: BottomUpPanelLayout
): PreviewPanelTranslation {
  if (!currentPanelLayout || previewPanelLayout.frameRole !== 'supply') {
    return { x: 0, y: 0 }
  }

  const currentHandoff = {
    x: currentPanelLayout.mainBus.x + currentPanelLayout.mainBus.width,
    y: currentPanelLayout.mainBus.y,
  }
  const previewHandoff = {
    x: previewPanelLayout.mainBus.x + previewPanelLayout.mainBus.width,
    y: previewPanelLayout.mainBus.y,
  }

  return {
    x: currentHandoff.x - previewHandoff.x,
    y: currentHandoff.y - previewHandoff.y,
  }
}

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
  diagramId: string = panelId
): WireSegment[] {
  const currentPanelSegments = currentSegments.filter(
    (segment) => segment.panelId === panelId && (segment.diagramId ?? segment.panelId) === diagramId
  )
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
      (previewSegment.diagramId ?? previewSegment.panelId) === diagramId &&
      !currentPanelSegments.some((currentSegment) =>
        isSamePreviewWireSegment(previewSegment, currentSegment)
      )
  )
}

/**
 * A protection relocation changes both its source and destination buses in the
 * simulated layout. The source removal must influence layout, but it is not a
 * drop preview; only the destination topology should be highlighted.
 */
export function filterProtectionRelocationPreviewWires(
  segments: WireSegment[],
  sourceParentCircuitId: string | undefined,
  targetCircuitId: string | undefined
): WireSegment[] {
  if (!sourceParentCircuitId || sourceParentCircuitId === targetCircuitId) return segments
  return segments.filter((segment) => segment.circuitId !== sourceParentCircuitId)
}
