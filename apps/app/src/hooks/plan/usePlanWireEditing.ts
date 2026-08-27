import { useCallback } from 'react'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { ensureMutablePlanWiringForProject } from '@/lib/projectV2/planWiring'
import {
  buildManualOtherPlanWireRoute,
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

  const drawPlanWire = useCallback(
    (sourcePlacementId: string, targetPlacementId: string) => {
      if (!activeFloorId || !currentProject || sourcePlacementId === targetPlacementId) return
      const otherRoute = buildManualOtherPlanWireRoute(
        currentProject,
        activeFloorId,
        sourcePlacementId,
        targetPlacementId,
      )
      const routes = buildManualPlanWireRoutesForPlacementMove(
        currentProject,
        activeFloorId,
        sourcePlacementId,
        targetPlacementId,
      )
      if (!otherRoute && (!routes || routes.length === 0)) return
      useProjectStore.setState((state: ProjectState) => {
        const project = state.currentProject
        if (!project) return
        const planWiring = ensureMutablePlanWiringForProject(project)
        if (otherRoute) {
          planWiring.routes = [
            ...planWiring.routes.filter((route) => route.id !== otherRoute.id),
            otherRoute,
          ]
          planWiring.visibility = {
            ...planWiring.visibility,
            wiresVisible: true,
            otherVisible: true,
          }
        } else if (routes) {
          planWiring.routes = replacePlanWireSpanRoutes(planWiring.routes, routes)
          const kind = routes[0]?.kind
          planWiring.visibility = {
            ...planWiring.visibility,
            wiresVisible: true,
            ...(kind === 'lighting-control' ? { lightingVisible: true } : { socketsVisible: true }),
          }
        }
        state.isDirty = true
      })
    },
    [activeFloorId, currentProject],
  )

  const removeManualOtherPlanWiresFromOrigin = useCallback(
    (sourcePlacementId: string) => {
      if (!activeFloorId) return false
      let removed = false
      useProjectStore.setState((state: ProjectState) => {
        const project = state.currentProject
        if (!project) return
        const planWiring = ensureMutablePlanWiringForProject(project)
        const routes = planWiring.routes.filter(
          (route) =>
            !(
              route.source === 'manual' &&
              route.kind === 'other' &&
              route.floorId === activeFloorId &&
              route.from.placementId === sourcePlacementId
            )
        )
        if (routes.length === planWiring.routes.length) return
        planWiring.routes = routes
        state.isDirty = true
        removed = true
      })
      return removed
    },
    [activeFloorId],
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
    drawPlanWire,
    removeManualOtherPlanWiresFromOrigin,
    hideSocketWireRouteForPlacementDrop,
  }
}
