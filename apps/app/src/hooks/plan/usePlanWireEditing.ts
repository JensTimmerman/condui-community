import { useCallback } from 'react'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { ensureMutablePlanWiringForProject } from '@/lib/projectV2/planWiring'
import {
  buildManualPlanWireRoutesForPlacementMove,
  hidePlanSocketWireRouteForPlacementDrop,
  removePlanWireRouteWaypoint,
} from '@/lib/plan/planWiring'
import {
  movePlanWireRouteWaypoint,
  replacePlanWireSpanRoutes,
  upsertPlanWireRouteWaypoint,
} from '@/lib/plan/planWiringRouteEdits'
import type { Point2, PlanWireRoute } from '@/types/schema'

type UsePlanWireEditingOptions = {
  activeFloorId: string | null
  currentProject: ProjectState['currentProject']
}

export function usePlanWireEditing({
  activeFloorId,
  currentProject,
}: UsePlanWireEditingOptions) {
  const insertPlanWireWaypoint = useCallback(
    (route: PlanWireRoute, point: Point2, waypointIndex: number) => {
      useProjectStore.setState((state: ProjectState) => {
        const project = state.currentProject
        if (!project) return
        const planWiring = ensureMutablePlanWiringForProject(project)
        planWiring.routes = upsertPlanWireRouteWaypoint(
          planWiring.routes,
          route,
          point,
          waypointIndex,
        )
        state.isDirty = true
      })
    },
    [],
  )

  const movePlanWireWaypoint = useCallback(
    (route: PlanWireRoute, waypointIndex: number, point: Point2) => {
      useProjectStore.setState((state: ProjectState) => {
        const project = state.currentProject
        if (!project) return
        const planWiring = ensureMutablePlanWiringForProject(project)
        const nextRoutes = movePlanWireRouteWaypoint(
          planWiring.routes,
          route,
          waypointIndex,
          point,
        )
        if (!nextRoutes) return
        planWiring.routes = nextRoutes
        state.isDirty = true
      })
    },
    [],
  )

  const removePlanWireWaypoint = useCallback((route: PlanWireRoute, waypointIndex: number) => {
    useProjectStore.setState((state: ProjectState) => {
      const project = state.currentProject
      if (!project) return
      ensureMutablePlanWiringForProject(project)
      if (removePlanWireRouteWaypoint(project, route, waypointIndex)) {
        state.isDirty = true
      }
    })
  }, [])

  const reorderPlanWirePlacement = useCallback(
    (sourcePlacementId: string, targetPlacementId: string) => {
      if (!activeFloorId || !currentProject || sourcePlacementId === targetPlacementId) return
      const routes = buildManualPlanWireRoutesForPlacementMove(
        currentProject,
        activeFloorId,
        sourcePlacementId,
        targetPlacementId,
      )
      if (!routes || routes.length === 0) return
      useProjectStore.setState((state: ProjectState) => {
        const project = state.currentProject
        if (!project) return
        const planWiring = ensureMutablePlanWiringForProject(project)
        planWiring.routes = replacePlanWireSpanRoutes(planWiring.routes, routes)
        state.isDirty = true
      })
    },
    [activeFloorId, currentProject],
  )

  const hideSocketWireRouteForPlacementDrop = useCallback(
    (sourcePlacementId: string) => {
      if (!activeFloorId) return
      useProjectStore.setState((state: ProjectState) => {
        const project = state.currentProject
        if (!project) return
        if (hidePlanSocketWireRouteForPlacementDrop(project, activeFloorId, sourcePlacementId)) {
          state.isDirty = true
        }
      })
    },
    [activeFloorId],
  )

  return {
    insertPlanWireWaypoint,
    movePlanWireWaypoint,
    removePlanWireWaypoint,
    reorderPlanWirePlacement,
    hideSocketWireRouteForPlacementDrop,
  }
}
