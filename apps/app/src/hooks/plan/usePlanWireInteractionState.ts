import { useState } from 'react'
import type { Point2 } from '@/types/schema'

export function usePlanWireInteractionState() {
  const [dragSourcePlacementId, setDragSourcePlacementId] = useState<string | null>(null)
  const [hoverPlacementId, setHoverPlacementId] = useState<string | null>(null)
  const [previewPoint, setPreviewPoint] = useState<Point2 | null>(null)

  return {
    planWireDragSourcePlacementId: dragSourcePlacementId,
    setPlanWireDragSourcePlacementId: setDragSourcePlacementId,
    planWireHoverPlacementId: hoverPlacementId,
    setPlanWireHoverPlacementId: setHoverPlacementId,
    planWirePreviewPoint: previewPoint,
    setPlanWirePreviewPoint: setPreviewPoint,
  }
}
