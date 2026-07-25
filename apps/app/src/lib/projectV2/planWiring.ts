import type { Installation, Panel, PlanWireRoute, PlanWiringModel } from '@/types/schema'
import type {
  DisciplineModelsV2,
  ElementModelV2,
  GeometryModelV2,
} from '@/types/projectV2'

export type ProjectWithOptionalV2PlanWiring = {
  installation?: Installation
  panels?: Panel[]
  planWiring?: PlanWiringModel
  disciplines?: Partial<DisciplineModelsV2>
  elements?: ElementModelV2[]
}

const SYSTEM_ELECTRICAL = 'system_electrical'
const ELECTRICAL_WIRING_LAYER_NAME = 'electrical-wiring'
const EMPTY_PLAN_WIRING: PlanWiringModel = { version: 1, routes: [] }

function hasCompatibilityPlanWiringField(document: ProjectWithOptionalV2PlanWiring): boolean {
  return Object.prototype.hasOwnProperty.call(document, 'planWiring')
}

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

export function getPlanWiringFromProject(
  document: ProjectWithOptionalV2PlanWiring
): PlanWiringModel {
  return document.disciplines?.electrical?.planWiring ?? document.planWiring ?? EMPTY_PLAN_WIRING
}

export function getMutablePlanWiringFromProject(
  document: ProjectWithOptionalV2PlanWiring
): PlanWiringModel | undefined {
  return document.disciplines?.electrical?.planWiring ?? document.planWiring
}

export function ensureMutablePlanWiringForProject(
  document: ProjectWithOptionalV2PlanWiring
): PlanWiringModel {
  const existing = getMutablePlanWiringFromProject(document)
  if (existing) return existing

  const planWiring: PlanWiringModel = { version: 1, routes: [] }
  const electrical = document.disciplines?.electrical
  if (electrical) {
    electrical.planWiring = planWiring
    return planWiring
  }

  if (hasCompatibilityPlanWiringField(document)) {
    document.planWiring = planWiring
    return planWiring
  }

  document.planWiring = planWiring
  return planWiring
}

export function deletePlanWiringFromProject(document: ProjectWithOptionalV2PlanWiring): void {
  const electrical = document.disciplines?.electrical
  if (electrical) {
    delete electrical.planWiring
    return
  }

  delete document.planWiring
}

export function syncPlanWiringFromCompatibility(
  document: ProjectWithOptionalV2PlanWiring
): void {
  const electrical = document.disciplines?.electrical
  const planWiring = document.planWiring ?? electrical?.planWiring
  if (electrical) {
    if (document.installation) electrical.installation = document.installation
    if (document.panels) electrical.panels = document.panels
    if (document.planWiring) {
      electrical.planWiring = document.planWiring
    } else if (hasCompatibilityPlanWiringField(document)) {
      delete electrical.planWiring
    }
  }

  const nonPlanWireElements = Array.isArray(document.elements)
    ? document.elements.filter((element) => !isPlanWireElement(element))
    : []
  const planWireElements = (planWiring?.routes ?? []).map(planWireRouteToElement)
  document.elements = [...nonPlanWireElements, ...planWireElements]
}
