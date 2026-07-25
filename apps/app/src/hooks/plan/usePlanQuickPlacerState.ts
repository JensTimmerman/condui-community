import { useState } from 'react'
import type { Point } from '@/types/ui'

export type QuickPlacerMode = 'slow' | 'fast'

export type QuickPlacerCursorHint = {
  message: string
  x: number
  y: number
  tone: 'error' | 'info'
}

export function usePlanQuickPlacerState() {
  const [quickPlacerMode, setQuickPlacerMode] = useState<QuickPlacerMode>('slow')
  const [quickPlacerSelectedCircuitId, setQuickPlacerSelectedCircuitId] = useState<string | null>(
    null,
  )
  const [quickPlacerManualCircuitFocusToken, setQuickPlacerManualCircuitFocusToken] = useState(0)
  const [quickPlacerFastIndex, setQuickPlacerFastIndex] = useState(0)
  const [quickPlacerFastAutoSkipCustom, setQuickPlacerFastAutoSkipCustom] = useState(true)
  const [quickPlacerDockHost, setQuickPlacerDockHost] = useState<HTMLElement | null>(null)
  const [quickPlacerDraggedPlacementId, setQuickPlacerDraggedPlacementId] = useState<string | null>(
    null,
  )
  const [quickPlacerCursorHint, setQuickPlacerCursorHint] =
    useState<QuickPlacerCursorHint | null>(null)
  const [quickPlacerFastPreviewClient, setQuickPlacerFastPreviewClient] = useState<Point | null>(
    null,
  )

  return {
    quickPlacerMode,
    setQuickPlacerMode,
    quickPlacerSelectedCircuitId,
    setQuickPlacerSelectedCircuitId,
    quickPlacerManualCircuitFocusToken,
    setQuickPlacerManualCircuitFocusToken,
    quickPlacerFastIndex,
    setQuickPlacerFastIndex,
    quickPlacerFastAutoSkipCustom,
    setQuickPlacerFastAutoSkipCustom,
    quickPlacerDockHost,
    setQuickPlacerDockHost,
    quickPlacerDraggedPlacementId,
    setQuickPlacerDraggedPlacementId,
    quickPlacerCursorHint,
    setQuickPlacerCursorHint,
    quickPlacerFastPreviewClient,
    setQuickPlacerFastPreviewClient,
  }
}
