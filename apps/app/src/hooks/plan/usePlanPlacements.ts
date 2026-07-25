import { useMemo } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import { getSymbolById } from '@/lib/symbols'
import { getSymbolCategory } from '@/components/plan/SitplanVisibilityPanel'
import type { SymbolKey, Placement } from '@/types/schema'
import type { PlanVisibility } from '@/stores/uiStore'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
} from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'

type SitplanPlacementRow = Placement & {
  endpointId?: string
  isEarthing?: boolean
  junctionPanelLabel?: string
}

/**
 * Hook to get and filter placements for the plan canvas
 */
export function usePlanPlacements(
  activeFloorId: string | null,
  sitplanPanelFilterId: string | null,
  planVisibility: PlanVisibility
) {
  const {
    currentProject,
    getPlacementsByFloor,
    getEndpointById,
    findCircuitForEndpoint,
    getFloorById,
  } = useProjectStore()

  // Get placements for the active floor, filtered by scope and optional panel filter
  // Include panel_distribution symbols (panels) which have scope 'both'
  const placements = useMemo(() => {
    if (!activeFloorId || !currentProject) return []
    const floorPlacements = getPlacementsByFloor(activeFloorId)
    const hasGround = getElectricalInstallationFromProject(currentProject)?.hasGround !== false
    let filtered = floorPlacements.filter((placement: SitplanPlacementRow) => {
      if (placement.isEarthing) return hasGround
      if (placement.junctionPanelLabel != null) return true
      if (!placement.endpointId) return false
      const endpoint = getEndpointById(placement.endpointId)
      if (!endpoint || !endpoint.symbol) return false
      if (endpoint.symbol === 'domotica') return false
      const symbol = getSymbolById(endpoint.symbol)
      if (!symbol) return false
      return symbol.scope === 'situatieplan' || symbol.scope === 'both'
    })
    if (sitplanPanelFilterId) {
      const selectedPanel = findPanelById(
        getElectricalPanelsFromProject(currentProject),
        sitplanPanelFilterId
      )
      filtered = filtered.filter((placement: SitplanPlacementRow) => {
        if (placement.isEarthing) return selectedPanel?.isMain === true
        if (placement.junctionPanelLabel != null) return true
        if (!placement.endpointId) return false
        const info = findCircuitForEndpoint(placement.endpointId)
        return info?.panel.id === sitplanPanelFilterId
      })
    }
    return filtered
  }, [
    activeFloorId,
    currentProject,
    getPlacementsByFloor,
    getEndpointById,
    findCircuitForEndpoint,
    sitplanPanelFilterId,
  ])

  // Filter placements by visibility (symbols master + per-category)
  const visiblePlacements = useMemo(() => {
    if (!planVisibility.symbolsVisible) return []
    const floor = activeFloorId ? getFloorById(activeFloorId) : null
    const hiddenIds = new Set<string>(floor?.hiddenSitplanPlacementIds ?? [])
    return placements.filter((placement: SitplanPlacementRow) => {
      if (hiddenIds.has(placement.id)) return false
      if (placement.isEarthing) return planVisibility.panelsVisible
      if (placement.junctionPanelLabel != null) return planVisibility.panelsVisible
      if (!placement.endpointId) return false
      const endpoint = getEndpointById(placement.endpointId)
      if (!endpoint?.symbol) return false
      const cat = getSymbolCategory(endpoint.symbol as SymbolKey)
      if (cat === null) return true
      const flag =
        cat === 'sockets'
          ? planVisibility.socketsVisible
          : cat === 'lights'
            ? planVisibility.lightsVisible
            : cat === 'switches'
              ? planVisibility.switchesVisible
              : cat === 'panels'
                ? planVisibility.panelsVisible
                : planVisibility.fixedAppliancesVisible
      return flag
    })
  }, [placements, planVisibility, getEndpointById, activeFloorId, getFloorById])

  return {
    placements,
    visiblePlacements,
  }
}
