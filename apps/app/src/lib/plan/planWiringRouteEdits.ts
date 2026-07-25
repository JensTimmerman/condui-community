import { clamp } from '@/lib/geometry'
import type { PlanWireRoute } from '@/types/schema'
import { planWireSpanSetKey } from './planWiring'

function routeWithManualWaypoints(
  route: PlanWireRoute,
  existing: PlanWireRoute | undefined,
  waypoints: NonNullable<PlanWireRoute['waypoints']>,
): PlanWireRoute {
  return {
    ...route,
    ...existing,
    source: 'manual',
    waypoints,
  }
}

export function upsertPlanWireRouteWaypoint(
  routes: PlanWireRoute[],
  route: PlanWireRoute,
  point: { x: number; y: number },
  waypointIndex: number,
): PlanWireRoute[] {
  const routeIndex = routes.findIndex((candidate) => candidate.id === route.id)
  const existing = routeIndex >= 0 ? routes[routeIndex] : undefined
  const waypoints = [...(existing?.waypoints ?? route.waypoints ?? [])]
  const insertAt = clamp(waypointIndex, 0, waypoints.length)
  waypoints.splice(insertAt, 0, point)
  const nextRoute = routeWithManualWaypoints(route, existing, waypoints)
  if (routeIndex < 0) return [...routes, nextRoute]
  return routes.map((candidate, index) => (index === routeIndex ? nextRoute : candidate))
}

export function movePlanWireRouteWaypoint(
  routes: PlanWireRoute[],
  route: PlanWireRoute,
  waypointIndex: number,
  point: { x: number; y: number },
): PlanWireRoute[] | null {
  const routeIndex = routes.findIndex((candidate) => candidate.id === route.id)
  const existing = routeIndex >= 0
    ? routes[routeIndex]
    : { ...route, source: 'manual' as const, waypoints: [...(route.waypoints ?? [])] }
  if (!existing) return null
  const waypoints = [...(existing.waypoints ?? [])]
  if (waypointIndex < 0 || waypointIndex >= waypoints.length) return null
  waypoints[waypointIndex] = point
  const nextRoute = routeWithManualWaypoints(route, existing, waypoints)
  if (routeIndex < 0) return [...routes, nextRoute]
  return routes.map((candidate, index) => (index === routeIndex ? nextRoute : candidate))
}

export function replacePlanWireSpanRoutes(
  routes: PlanWireRoute[],
  replacementRoutes: PlanWireRoute[],
): PlanWireRoute[] {
  const first = replacementRoutes[0]
  if (!first) return routes
  const groupKey = planWireSpanSetKey(first)
  return [
    ...routes.filter((route) => planWireSpanSetKey(route) !== groupKey),
    ...replacementRoutes,
  ]
}
