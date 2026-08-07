import { useMemo } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import { getSymbolCategory } from '@/components/plan/SitplanVisibilityPanel'
import type { SymbolKey, Placement } from '@/types/schema'
import type { PlanVisibility } from '@/stores/uiStore'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
} from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'

type SitplanPlacementRow = Placement & {
  endpointId?: string
  trunkDeviceId?: string
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
    getTrunkDeviceById,
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
      const endpoint = placement.endpointId ? getEndpointById(placement.endpointId) : undefined
      const trunkDevice = placement.trunkDeviceId
        ? getTrunkDeviceById(placement.trunkDeviceId)?.device
        : undefined
      const symbolKey = endpoint?.symbol ?? trunkDevice?.symbol
      return canSymbolAppearOnSituationPlan(symbolKey)
    })
    if (sitplanPanelFilterId) {
      const selectedPanel = findPanelById(
        getElectricalPanelsFromProject(currentProject),
        sitplanPanelFilterId
      )
      filtered = filtered.filter((placement: SitplanPlacementRow) => {
        if (placement.isEarthing) return selectedPanel?.isMain === true
        if (placement.junctionPanelLabel != null) return true
        if (placement.endpointId) {
          return findCircuitForEndpoint(placement.endpointId)?.panel.id === sitplanPanelFilterId
        }
        if (placement.trunkDeviceId) {
          const circuitId = getTrunkDeviceById(placement.trunkDeviceId)?.circuit?.id
          return circuitId
            ? useProjectStore.getState().findPanelForCircuit(circuitId)?.id === sitplanPanelFilterId
            : false
        }
        return false
      })
    }
    return filtered
  }, [
    activeFloorId,
    currentProject,
    getPlacementsByFloor,
    getEndpointById,
    getTrunkDeviceById,
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
      const endpoint = placement.endpointId ? getEndpointById(placement.endpointId) : undefined
      const trunkDevice = placement.trunkDeviceId
        ? getTrunkDeviceById(placement.trunkDeviceId)?.device
        : undefined
      const symbolKey = endpoint?.symbol ?? trunkDevice?.symbol
      if (!symbolKey) return false
      const cat = getSymbolCategory(symbolKey as SymbolKey)
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
  }, [placements, planVisibility, getEndpointById, getTrunkDeviceById, activeFloorId, getFloorById])

  return {
    placements,
    visiblePlacements,
  }
}
