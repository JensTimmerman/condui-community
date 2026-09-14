import type { Endpoint, Panel } from '@/types/schema'
import { findPanelById, findPanelByName } from '@/lib/panel/panelTree'
import {
  selectProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

/**
 * Resolve the board a `panel_distribution` endpoint represents.
 * Prefer `panelId` (stable); fall back to matching `label` to the panel name.
 */
export function resolvePanelForDistributionEndpoint(
  project: ProjectWithOptionalV2Electrical,
  endpoint: Pick<Endpoint, 'symbol' | 'label' | 'panelId'>
): Panel | null {
  if (endpoint.symbol !== 'panel_distribution') return null
  const panels = selectProjectElectricalPanels(project)
  if (endpoint.panelId) {
    const byId = findPanelById(panels, endpoint.panelId)
    if (byId) return byId
  }
  if (endpoint.label) {
    return findPanelByName(panels, endpoint.label) ?? null
  }
  return null
}

export function isMainPanelDistributionEndpoint(
  project: ProjectWithOptionalV2Electrical,
  endpoint: Endpoint
): boolean {
  const panel = resolvePanelForDistributionEndpoint(project, endpoint)
  return panel?.isMain === true
}
