import type { Endpoint, Panel } from '@/types/schema'

export type PlanSelection = {
  type: string | null
  ids: string[]
}

export type ResolveSelectionToEndpointIdsDeps = {
  getPanelById: (id: string) => Panel | undefined
  getPanelByName: (name: string) => Panel | undefined
  getAllEndpoints: () => Endpoint[]
  onUnresolvedPanel?: (panel: Panel, selection: PlanSelection) => void
}

/**
 * Resolve endpoint and panel selections to endpoint ids for sitplan operations.
 *
 * Panel distribution endpoints can lag behind panel renames. The label fallback
 * therefore maps an endpoint label back to the current panel object instead of
 * comparing the label directly with the selected panel's current name.
 */
export function resolveSelectionToEndpointIds(
  selection: PlanSelection,
  deps: ResolveSelectionToEndpointIdsDeps
): string[] {
  if (selection.type === 'endpoint') {
    return selection.ids
  }
  if (selection.type !== 'panel') {
    return []
  }

  const endpointIds: string[] = []
  const allEndpoints = deps.getAllEndpoints()
  selection.ids.forEach((panelId) => {
    const panel = deps.getPanelById(panelId)
    if (!panel) return
    const endpoint = allEndpoints.find((entry) => {
      if (entry.symbol !== 'panel_distribution') return false
      if (entry.panelId === panel.id) return true
      const labelPanel = entry.label ? deps.getPanelByName(entry.label) : undefined
      return labelPanel?.id === panel.id
    })
    if (endpoint) {
      endpointIds.push(endpoint.id)
    } else {
      deps.onUnresolvedPanel?.(panel, selection)
    }
  })
  return endpointIds
}
