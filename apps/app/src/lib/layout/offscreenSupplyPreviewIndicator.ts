import type { BottomUpLayoutResult } from './bottomUpLayout'
import type { CanvasSize, Point } from '@/types/ui'

export type OffscreenPreviewDirection = 'top' | 'right' | 'bottom' | 'left'

interface ResolveOffscreenSupplyPreviewDirectionParams {
  currentLayout: BottomUpLayoutResult
  previewLayout: BottomUpLayoutResult
  pan: Point
  zoom: number
  viewport: CanvasSize
}

/** Finds a newly detached supply frame that is completely outside the visible canvas. */
export function resolveOffscreenSupplyPreviewDirection({
  currentLayout,
  previewLayout,
  pan,
  zoom,
  viewport,
}: ResolveOffscreenSupplyPreviewDirectionParams): OffscreenPreviewDirection | null {
  if (viewport.width <= 0 || viewport.height <= 0 || zoom <= 0) return null

  const currentDetachedPanelIds = new Set(
    currentLayout.panels
      .filter((panelLayout) => panelLayout.frameRole === 'supply')
      .map((panelLayout) => panelLayout.panel.id)
  )
  const newlyDetachedFrame = previewLayout.panels.find(
    (panelLayout) =>
      panelLayout.frameRole === 'supply' && !currentDetachedPanelIds.has(panelLayout.panel.id)
  )
  if (!newlyDetachedFrame) return null

  const left = pan.x + newlyDetachedFrame.frame.x * zoom
  const top = pan.y + newlyDetachedFrame.frame.y * zoom
  const right = left + newlyDetachedFrame.frame.width * zoom
  const bottom = top + newlyDetachedFrame.frame.height * zoom

  const candidates: Array<{ direction: OffscreenPreviewDirection; distance: number }> = []
  if (right <= 0) candidates.push({ direction: 'left', distance: -right })
  if (left >= viewport.width) {
    candidates.push({ direction: 'right', distance: left - viewport.width })
  }
  if (bottom <= 0) candidates.push({ direction: 'top', distance: -bottom })
  if (top >= viewport.height) {
    candidates.push({ direction: 'bottom', distance: top - viewport.height })
  }

  candidates.sort((a, b) => a.distance - b.distance)
  return candidates[0]?.direction ?? null
}
