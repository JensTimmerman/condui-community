import {
  getBuildingFloorsFromProject,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { Endpoint, Panel } from '@/types/schema'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'

type SitplanExportProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

export interface SitplanExportTarget {
  id: string
  floorId: string
  panelId: string | null
  title: string | null
}

interface SitplanPlacementRecord {
  floorId: string
  panelId: string
  label: string
  symbol: Endpoint['symbol']
}

function collectPanels(panels: Panel[]): Panel[] {
  const all: Panel[] = []
  for (const panel of panels) {
    all.push(panel)
    all.push(...collectPanels(panel.subPanels))
  }
  return all
}

function findPanelForEndpointInPanel(
  panel: Panel,
  endpointId: string,
): Panel | undefined {
  if (panel.circuits.some((circuit) => circuit.endpoints.some((endpoint) => endpoint.id === endpointId))) {
    return panel
  }
  if (
    panel.protections.some((protection) =>
      (protection.circuits ?? []).some((circuit) =>
        circuit.endpoints.some((endpoint) => endpoint.id === endpointId),
      ),
    )
  ) {
    return panel
  }
  for (const subPanel of panel.subPanels) {
    const found = findPanelForEndpointInPanel(subPanel, endpointId)
    if (found) return found
  }
  return undefined
}

function findPanelForEndpoint(project: SitplanExportProject, endpointId: string): Panel | undefined {
  for (const panel of getElectricalPanelsFromProject(project)) {
    const found = findPanelForEndpointInPanel(panel, endpointId)
    if (found) return found
  }
  return undefined
}

function shouldCountEndpointForDuplicateLabels(endpoint: Endpoint): boolean {
  if (!endpoint.label?.trim()) return false
  if (endpoint.symbol === 'panel_distribution') {
    return false
  }
  return canSymbolAppearOnSituationPlan(endpoint.symbol)
}

function shouldCountEndpointForPanelContent(endpoint: Endpoint): boolean {
  return canSymbolAppearOnSituationPlan(endpoint.symbol)
}

function collectSitplanPlacements(project: SitplanExportProject): SitplanPlacementRecord[] {
  const placements: SitplanPlacementRecord[] = []
  const visitPanel = (panel: Panel) => {
    for (const circuit of panel.circuits) {
      for (const endpoint of circuit.endpoints) {
        if (!shouldCountEndpointForPanelContent(endpoint)) continue
        for (const placement of endpoint.placements) {
          placements.push({
            floorId: placement.floorId,
            panelId: panel.id,
            label: endpoint.label,
            symbol: endpoint.symbol,
          })
        }
      }
    }
    for (const protection of panel.protections) {
      for (const circuit of protection.circuits ?? []) {
        for (const endpoint of circuit.endpoints) {
          if (!shouldCountEndpointForPanelContent(endpoint)) continue
          for (const placement of endpoint.placements) {
            placements.push({
              floorId: placement.floorId,
              panelId: panel.id,
              label: endpoint.label,
              symbol: endpoint.symbol,
            })
          }
        }
      }
    }
    for (const subPanel of panel.subPanels) {
      visitPanel(subPanel)
    }
  }

  for (const panel of getElectricalPanelsFromProject(project)) {
    visitPanel(panel)
  }
  return placements
}

export function hasDuplicateSitplanEndpointLabels(project: SitplanExportProject): boolean {
  const labelCounts = new Map<string, number>()

  const visitPanel = (panel: Panel): boolean => {
    for (const circuit of panel.circuits) {
      for (const endpoint of circuit.endpoints) {
        if (!shouldCountEndpointForDuplicateLabels(endpoint)) continue
        for (const placement of endpoint.placements) {
          if (!placement.floorId) continue
          const next = (labelCounts.get(endpoint.label) ?? 0) + 1
          labelCounts.set(endpoint.label, next)
          if (next > 1) return true
        }
      }
    }
    for (const protection of panel.protections) {
      for (const circuit of protection.circuits ?? []) {
        for (const endpoint of circuit.endpoints) {
          if (!shouldCountEndpointForDuplicateLabels(endpoint)) continue
          for (const placement of endpoint.placements) {
            if (!placement.floorId) continue
            const next = (labelCounts.get(endpoint.label) ?? 0) + 1
            labelCounts.set(endpoint.label, next)
            if (next > 1) return true
          }
        }
      }
    }
    return panel.subPanels.some((subPanel) => visitPanel(subPanel))
  }

  return getElectricalPanelsFromProject(project).some((panel) => visitPanel(panel))
}

export function buildSitplanExportTargets(project: SitplanExportProject): SitplanExportTarget[] {
  const floors = getBuildingFloorsFromProject(project)

  if (!hasDuplicateSitplanEndpointLabels(project)) {
    return floors.map((floor) => ({
      id: `sitplan-${floor.id}`,
      floorId: floor.id,
      panelId: null,
      title: null,
    }))
  }

  const placements = collectSitplanPlacements(project)
  const panels = collectPanels(getElectricalPanelsFromProject(project))
  const targets: SitplanExportTarget[] = []

  for (const floor of floors) {
    for (const panel of panels) {
      const hasContent = placements.some(
        (placement) => placement.floorId === floor.id && placement.panelId === panel.id,
      )
      if (!hasContent) continue
      targets.push({
        id: `sitplan-${floor.id}-${panel.id}`,
        floorId: floor.id,
        panelId: panel.id,
        title: `${floor.name} - ${panel.name}`,
      })
    }
  }

  return targets
}

export function getSitplanPlacementPanelId(project: SitplanExportProject, endpointId: string): string | null {
  return findPanelForEndpoint(project, endpointId)?.id ?? null
}
