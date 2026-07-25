import type { Panel } from '@/types/schema'
import type { PanelCanvasMode } from '@/types/ui'

export type PanelOption = {
  id: string
  name: string
  panel: Panel
  depth: number
  isRoot: boolean
}

export function isPanelOptionActive(mode: PanelCanvasMode, panelId: string): boolean {
  return mode.kind === 'panel' && mode.panelId === panelId
}

export function buildPanelSelectorLabel(
  mode: PanelCanvasMode,
  panelOptions: PanelOption[]
): string {
  if (mode.kind === 'all') return 'All (hierarchy)'
  return panelOptions.find((panelOption) => panelOption.id === mode.panelId)?.name ?? 'Panel'
}
