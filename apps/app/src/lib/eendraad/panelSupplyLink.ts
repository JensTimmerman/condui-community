import type { Circuit, Endpoint, Panel, ProtectionDevice } from '@/types/schema'
import {
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'

export interface PanelSupplyLink {
  sourcePanel: Panel
  targetPanel: Panel
  protection: ProtectionDevice
  feederCircuit?: Circuit
  sourcePanelEndpoint?: Endpoint
  targetPanelEndpoint?: Endpoint
}

export function isPanelDistributionEndpointForPanel(endpoint: Endpoint, panel: Panel): boolean {
  return (
    endpoint.symbol === 'panel_distribution' &&
    (endpoint.panelId === panel.id || endpoint.label === panel.name)
  )
}

export function findPanelDistributionEndpointInCircuit(
  circuit: Circuit | undefined,
  panel: Panel
): Endpoint | undefined {
  return circuit?.endpoints.find((endpoint) => isPanelDistributionEndpointForPanel(endpoint, panel))
}

export function findPanelOwnDistributionEndpoint(panel: Panel): Endpoint | undefined {
  const panelCircuit = panel.circuits?.find((circuit) => circuit.code === 'PANEL')
  return (
    panelCircuit?.endpoints.find((endpoint) =>
      isPanelDistributionEndpointForPanel(endpoint, panel)
    ) ??
    panel.circuits
      ?.flatMap((circuit) => circuit.endpoints)
      .find((endpoint) => isPanelDistributionEndpointForPanel(endpoint, panel))
  )
}

export function resolvePanelSupplyLinkForProtection(
  project: ProjectWithOptionalV2Electrical,
  sourcePanel: Panel,
  protection: ProtectionDevice
): PanelSupplyLink | null {
  if (!protection.subPanelId) return null
  const targetPanel = findPanelById(
    getElectricalPanelsFromProject(project),
    protection.subPanelId
  )
  if (!targetPanel) return null

  const circuits = protection.circuits ?? []
  const feederCircuit =
    circuits.find((circuit) => findPanelDistributionEndpointInCircuit(circuit, targetPanel)) ??
    circuits[0]
  const sourcePanelEndpoint = findPanelDistributionEndpointInCircuit(feederCircuit, targetPanel)
  const targetPanelEndpoint = findPanelOwnDistributionEndpoint(targetPanel)

  return {
    sourcePanel,
    targetPanel,
    protection,
    feederCircuit,
    sourcePanelEndpoint,
    targetPanelEndpoint,
  }
}

export function resolvePanelSupplyLinkForPanel(
  project: ProjectWithOptionalV2Electrical,
  targetPanelId: string
): PanelSupplyLink | null {
  const search = (panels: Panel[]): PanelSupplyLink | null => {
    for (const panel of panels) {
      for (const protection of panel.protections ?? []) {
        if (protection.subPanelId !== targetPanelId) continue
        const link = resolvePanelSupplyLinkForProtection(project, panel, protection)
        if (link) return link
      }
      const nested = search(panel.subPanels ?? [])
      if (nested) return nested
    }
    return null
  }

  return search(getElectricalPanelsFromProject(project))
}

export function resolvePanelSupplyLinksForSourcePanel(
  project: ProjectWithOptionalV2Electrical,
  sourcePanel: Panel
): PanelSupplyLink[] {
  return (sourcePanel.protections ?? [])
    .map((protection) => resolvePanelSupplyLinkForProtection(project, sourcePanel, protection))
    .filter((link): link is PanelSupplyLink => !!link)
}

export function panelSupplyLinkHasRenderableSymbol(link: PanelSupplyLink): boolean {
  return !!(link.sourcePanelEndpoint || link.targetPanelEndpoint)
}
