import type {
  Installation,
  Panel,
  PlanWireRoute,
  PlanWiringModel,
  PlanWiringVisibility,
} from '@/types/schema'
import type { DisciplineModelsV2, ElementModelV2, GeometryModelV2 } from '@/types/projectV2'

export type ProjectWithOptionalV2PlanWiring = {
  installation?: Installation
  panels?: Panel[]
  planWiring?: PlanWiringModel
  disciplines?: Partial<DisciplineModelsV2>
  elements?: ElementModelV2[]
}

const SYSTEM_ELECTRICAL = 'system_electrical'
const ELECTRICAL_WIRING_LAYER_NAME = 'electrical-wiring'
const EMPTY_VISIBILITY: PlanWiringVisibility = {}

function layerIdFor(floorId: string | undefined, layerName: string): string {
  const normalized =
    layerName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_') || 'layer'
  return floorId ? `layer_${floorId}_${normalized}` : `layer_${normalized}`
}

function planWireGeometry(route: PlanWireRoute): GeometryModelV2 {
  return { kind: 'polyline', points: route.waypoints ?? [] }
}

function planWireRouteToElement(route: PlanWireRoute): ElementModelV2 {
  return {
    id: `elem_plan_wire_${route.id}`,
    scopeId: 'electrical',
    kind: `electrical.plan-wire.${route.kind}`,
    floorId: route.floorId,
    systemId: SYSTEM_ELECTRICAL,
    layerId: layerIdFor(route.floorId, ELECTRICAL_WIRING_LAYER_NAME),
    geometry: planWireGeometry(route),
    properties: {
      route,
      source: route.source,
      circuitId: route.circuitId,
      branchId: route.branchId,
      from: route.from,
      to: route.to,
    },
    sourceRefs: [{ kind: 'v1', id: route.id, path: 'planWiring.routes' }],
  }
}

function isPlanWireElement(element: ElementModelV2): boolean {
  return element.kind.startsWith('electrical.plan-wire.')
}

function routeFromElement(element: ElementModelV2): PlanWireRoute | undefined {
  if (!isPlanWireElement(element)) return undefined
  const route = element.properties?.route
  if (!route || typeof route !== 'object' || typeof (route as PlanWireRoute).id !== 'string') {
    return undefined
  }
  const typedRoute = route as PlanWireRoute
  // Keep this projection compatible with Immer drafts: route readers are also called from
  // inside store mutations, where structuredClone cannot clone the proxy-backed payload.
  return {
    ...typedRoute,
    from: { ...typedRoute.from },
    to: { ...typedRoute.to },
    ...(typedRoute.waypoints
      ? { waypoints: typedRoute.waypoints.map((point) => ({ ...point })) }
      : {}),
  }
}

/** Canonical plan-wire query. Routes are owned by generic V2 elements. */
export function selectProjectPlanWireRoutes(
  document: ProjectWithOptionalV2PlanWiring
): PlanWireRoute[] {
  return (document.elements ?? [])
    .map(routeFromElement)
    .filter((route): route is PlanWireRoute => route !== undefined)
}

/** Atomic canonical route replacement; callers never mutate element payloads in place. */
export function replacePlanWireRoutesForProject(
  document: ProjectWithOptionalV2PlanWiring,
  routes: readonly PlanWireRoute[]
): void {
  if (!document.elements) document.elements = []
  const retained = document.elements.filter((element) => !isPlanWireElement(element))
  document.elements = [
    ...retained,
    ...routes.map((route) => planWireRouteToElement(structuredClone(route))),
  ]
}

export function updatePlanWireRoutesForProject(
  document: ProjectWithOptionalV2PlanWiring,
  update: (routes: readonly PlanWireRoute[]) => readonly PlanWireRoute[]
): void {
  replacePlanWireRoutesForProject(document, update(selectProjectPlanWireRoutes(document)))
}

export function selectProjectPlanWiringVisibility(
  document: ProjectWithOptionalV2PlanWiring
): PlanWiringVisibility {
  return document.disciplines?.electrical?.planWiring?.visibility ?? EMPTY_VISIBILITY
}

export function replacePlanWiringVisibilityForProject(
  document: ProjectWithOptionalV2PlanWiring,
  visibility: PlanWiringVisibility | undefined
): void {
  const electrical = document.disciplines?.electrical
  if (!electrical) throw new Error('Electrical discipline is required to edit plan wiring.')
  if (!visibility && selectProjectPlanWireRoutes(document).length === 0) {
    delete electrical.planWiring
    return
  }
  electrical.planWiring = { version: 1, routes: [], visibility }
}

/** Read-only view projection retained for canvas/export consumers during the UI migration. */
export function selectProjectPlanWiringProjection(
  document: ProjectWithOptionalV2PlanWiring
): PlanWiringModel {
  return {
    version: 1,
    routes: selectProjectPlanWireRoutes(document),
    visibility: selectProjectPlanWiringVisibility(document),
  }
}

export function clearPlanWiringForProject(document: ProjectWithOptionalV2PlanWiring): void {
  replacePlanWireRoutesForProject(document, [])
  replacePlanWiringVisibilityForProject(document, undefined)
}

/** One-shot storage/import normalization; ordinary runtime code must never call this. */
export function normalizeLegacyPlanWiringAtBoundary(
  document: ProjectWithOptionalV2PlanWiring
): void {
  const legacy = document.disciplines?.electrical?.planWiring
  if (!legacy || legacy.routes.length === 0) return
  const existing = selectProjectPlanWireRoutes(document)
  if (legacy.routes.length > 0 && existing.length === 0) {
    replacePlanWireRoutesForProject(document, legacy.routes)
  }
  replacePlanWiringVisibilityForProject(document, legacy.visibility)
}
