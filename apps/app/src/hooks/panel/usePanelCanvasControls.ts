import { useCallback, useState } from 'react'
import { ZOOM_MAX, ZOOM_MIN } from '@/constants/canvasConstants'
import { clamp } from '@/lib/geometry'
import { useUIStore } from '@/stores/uiStore'
import type { Point } from '@/types/ui'

export function usePanelViewportHandlers() {
  const setPanelView = useUIStore((s) => s.setPanelView)

  const handleZoomChange = useCallback(
    (zoom: number) => {
      setPanelView({ zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX) })
    },
    [setPanelView]
  )

  const handlePanChange = useCallback(
    (pan: { x: number; y: number }) => {
      setPanelView({ pan })
    },
    [setPanelView]
  )

  const handleViewTransformCommit = useCallback(
    (patch: { pan?: Point; zoom?: number }) => {
      const next: { pan?: Point; zoom?: number } = { ...patch }
      if (typeof next.zoom === 'number') {
        next.zoom = clamp(next.zoom, ZOOM_MIN, ZOOM_MAX)
      }
      setPanelView(next)
    },
    [setPanelView]
  )

  return {
    handlePanChange,
    handleViewTransformCommit,
    handleZoomChange,
  }
}

export function usePanelOptionsMenuState() {
  const [feedSideDirection, setFeedSideDirection] = useState<'left' | 'right'>('left')
  const [panelOptionsMenuOpen, setPanelOptionsMenuOpen] = useState(false)

  const closePanelOptionsMenu = useCallback(() => {
    setPanelOptionsMenuOpen(false)
  }, [])

  return {
    closePanelOptionsMenu,
    feedSideDirection,
    panelOptionsMenuOpen,
    setFeedSideDirection,
    setPanelOptionsMenuOpen,
  }
}
