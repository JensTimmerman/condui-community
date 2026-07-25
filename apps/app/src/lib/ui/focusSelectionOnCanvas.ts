import { useUIStore } from '@/stores/uiStore'
import type { CanvasType, Selection } from '@/types/ui'

const PLAN_ONLY_SELECTIONS = new Set<Selection['type']>([
  'placement',
  'wall',
  'wallPoint',
  'door',
  'window',
  'stair',
  'stairPoint',
  'graphicElement',
])

const ONE_WIRE_SELECTIONS = new Set<Selection['type']>([
  'panel',
  'supplyPanel',
  'protection',
  'circuit',
  'endpoint',
  'wire',
  'ground',
  'supply',
  'trunkDevice',
  'frame',
  'note',
  'infoBlock',
])

function isCompactRenderedViewport(): boolean {
  if (typeof window === 'undefined') return false
  const width = window.innerWidth
  const height = window.innerHeight
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  const isPortrait = height >= width
  return width < 900 || (coarsePointer && isPortrait && width < 1100) || (coarsePointer && !isPortrait && height < 620)
}

export function getPreferredCanvasForSelection(
  selection: Selection,
  currentCanvas: CanvasType = 'eendraad'
): CanvasType {
  if (!selection.type || selection.ids.length === 0) return currentCanvas
  if (PLAN_ONLY_SELECTIONS.has(selection.type)) return 'plan'
  if (ONE_WIRE_SELECTIONS.has(selection.type)) {
    if (currentCanvas === 'panel' && selection.type === 'protection') return 'panel'
    return currentCanvas === 'eendraad' ? currentCanvas : 'eendraad'
  }
  return currentCanvas
}

export function focusSelectionOnCanvas(
  selection: Selection,
  options?: { preferredCanvas?: CanvasType; delayMs?: number }
) {
  if (!selection.type || selection.ids.length === 0) return

  const state = useUIStore.getState()
  const currentCanvas = state.viewportLayout.panels[0]?.canvas ?? 'eendraad'
  const targetCanvas =
    options?.preferredCanvas ?? getPreferredCanvasForSelection(selection, currentCanvas)
  const visiblePanelIndex = state.viewportLayout.panels.findIndex(
    (panel) => panel.canvas === targetCanvas
  )
  const firstPanelCanvas = state.viewportLayout.panels[0]?.canvas
  const compactViewport = isCompactRenderedViewport()

  if (visiblePanelIndex === -1 || (compactViewport && firstPanelCanvas !== targetCanvas)) {
    state.setPanelCanvas(0, targetCanvas)
  }

  for (const delayMs of [0, options?.delayMs ?? 80, 220, 500]) {
    window.setTimeout(() => {
      useUIStore.getState().requestFitToView([targetCanvas])
    }, delayMs)
  }
}
