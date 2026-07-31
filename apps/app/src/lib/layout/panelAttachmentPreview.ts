import type { WireSegment } from '@/types/schema'

export interface PanelAttachmentPreviewGeometry {
  busSegment: WireSegment
  busY: number
  ghostX: number
  symbolY: number
}

interface PanelAttachmentPreviewTarget {
  type: 'mainBus' | 'circuit' | 'rcd'
  panelId: string
  circuitId?: string
  protectionId?: string
}

/**
 * Resolve the compact panel-move ghost from the live bus geometry.
 *
 * Panel moves can reflow most of a panel, so using the simulated layout's
 * changed-wire diff as a preview would duplicate whole busbars. Keep this
 * deliberately local, like protection insertion: one bus segment, one feeder
 * stub, and one small panel symbol.
 */
export function resolvePanelAttachmentPreviewGeometry(
  wireSegments: WireSegment[],
  target: PanelAttachmentPreviewTarget,
  cursorX: number
): PanelAttachmentPreviewGeometry | null {
  const busSegments = wireSegments.filter((segment) => {
    if (segment.panelId !== target.panelId || segment.type !== 'mainBus') return false
    if (target.type === 'mainBus') return segment.fromElementType !== 'secondaryBus'
    if (target.type === 'rcd') {
      return false
    }
    return (
      segment.fromElementType === 'secondaryBus' &&
      !!target.circuitId &&
      segment.circuitId === target.circuitId
    )
  })

  if (target.type === 'rcd') {
    busSegments.push(
      ...wireSegments.filter(
        (segment) =>
          segment.panelId === target.panelId &&
          segment.type === 'trunk' &&
          segment.fromElementType === 'rcd' &&
          segment.fromElementId === target.protectionId
      )
    )
  }

  const busSegment =
    busSegments.find((segment) => {
      const minX = Math.min(segment.startPoint.x, segment.endPoint.x)
      const maxX = Math.max(segment.startPoint.x, segment.endPoint.x)
      return cursorX >= minX && cursorX <= maxX
    }) ??
    [...busSegments].sort((a, b) => {
      const aMid = (a.startPoint.x + a.endPoint.x) / 2
      const bMid = (b.startPoint.x + b.endPoint.x) / 2
      return Math.abs(aMid - cursorX) - Math.abs(bMid - cursorX)
    })[0]

  if (!busSegment) return null

  const minX = Math.min(busSegment.startPoint.x, busSegment.endPoint.x)
  const maxX = Math.max(busSegment.startPoint.x, busSegment.endPoint.x)
  const ghostX = Math.max(minX, Math.min(maxX, cursorX))
  const busY = busSegment.startPoint.y

  return {
    busSegment,
    busY,
    ghostX,
    // Same visual height as a compact single-endpoint circuit.
    symbolY: busY - 100,
  }
}
