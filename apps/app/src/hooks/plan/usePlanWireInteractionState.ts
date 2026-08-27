import { useCallback, useEffect, useRef, useState } from 'react'
import type { Point2 } from '@/types/schema'

export function usePlanWireInteractionState() {
  const [dragSourcePlacementId, setDragSourcePlacementId] = useState<string | null>(null)
  const [hoverPlacementId, setHoverPlacementId] = useState<string | null>(null)
  const [previewPoint, setPreviewPoint] = useState<Point2 | null>(null)
  const pendingPreviewPointRef = useRef<Point2 | null>(null)
  const previewAnimationFrameRef = useRef<number | null>(null)

  const setPlanWirePreviewPoint = useCallback((point: Point2 | null) => {
    pendingPreviewPointRef.current = point
    if (point == null) {
      if (previewAnimationFrameRef.current != null) {
        cancelAnimationFrame(previewAnimationFrameRef.current)
        previewAnimationFrameRef.current = null
      }
      setPreviewPoint(null)
      return
    }
    if (previewAnimationFrameRef.current != null) return
    previewAnimationFrameRef.current = requestAnimationFrame(() => {
      previewAnimationFrameRef.current = null
      setPreviewPoint(pendingPreviewPointRef.current)
    })
  }, [])

  useEffect(
    () => () => {
      if (previewAnimationFrameRef.current != null) {
        cancelAnimationFrame(previewAnimationFrameRef.current)
      }
    },
    []
  )

  return {
    planWireDragSourcePlacementId: dragSourcePlacementId,
    setPlanWireDragSourcePlacementId: setDragSourcePlacementId,
    planWireHoverPlacementId: hoverPlacementId,
    setPlanWireHoverPlacementId: setHoverPlacementId,
    planWirePreviewPoint: previewPoint,
    setPlanWirePreviewPoint,
  }
}
