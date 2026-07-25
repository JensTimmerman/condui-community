/**
 * Alt-drag duplicate on the situation plan: new endpoint with source properties,
 * placement at drop position, and sitplan orphan guard.
 */

import {
  duplicateEndpointOnCircuit,
  endpointSymbolCanBeDuplicated,
} from '@/lib/eendraad/duplicateEndpoint'
import { ensureSitplanPlacementsForEndpoints } from '@/lib/eendraad/duplicateSitplanHelpers'
import type { Endpoint, Placement } from '@/types/schema'
import type { Point } from '@/types/ui'
import { generateId } from '@/utils'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { getBuildingFloorsFromProject } from '@/lib/projectV2/buildingFloors'

/** Initial nudge so the copy is visible while dragging; pointer updates position live. */
export const PLAN_ALT_DRAG_COPY_OFFSET = { x: 24, y: 24 } as const

/** Add another placement on the same endpoint (lights / multiplier symbols). */
export function createPlanMultiplierAltDuplicatePlacement(
  endpoint: Endpoint,
  refPlacement: Placement,
): string | null {
  const newPlacementId = generateId()
  useProjectStore.getState().addPlacement(endpoint.id, {
    ...refPlacement,
    id: newPlacementId,
    pos: {
      x: refPlacement.pos.x + PLAN_ALT_DRAG_COPY_OFFSET.x,
      y: refPlacement.pos.y + PLAN_ALT_DRAG_COPY_OFFSET.y,
    },
    locked: false,
  })
  useUIStore.getState().setSelection({ type: 'placement', ids: [newPlacementId] })
  return newPlacementId
}

/** New endpoint + placement (properties from source, new label on 1-wire). */
export function createPlanPropertyAltDuplicatePlacement(
  sourceEndpointId: string,
  refPlacement: Placement,
): string | null {
  const store = useProjectStore.getState()
  const source = store.getEndpointById(sourceEndpointId)
  if (!source || !endpointSymbolCanBeDuplicated(source)) return null

  const circuitInfo = store.findCircuitForEndpoint(sourceEndpointId)
  const project = store.currentProject
  if (!circuitInfo || !project) return null

  const r = duplicateEndpointOnCircuit(
    project,
    {
      circuitId: circuitInfo.circuit.id,
      sourceEndpointId,
      context: 'plan',
      placement: { mode: 'new_branch', order: 'before_source_branch' },
    },
    {
      getCircuitById: store.getCircuitById,
      getEndpointById: store.getEndpointById,
      addEndpoint: store.addEndpoint,
      updateCircuit: store.updateCircuit,
      setSelection: undefined,
    },
  )
  if (!r.ok || !r.newEndpointId) return null

  const newEndpointId = r.newEndpointId
  const newEp = store.getEndpointById(newEndpointId)
  if (!newEp) return null

  for (const p of [...(newEp.placements ?? [])]) {
    store.deletePlacement(p.id)
  }

  const newPlacementId = generateId()
  store.addPlacement(newEndpointId, {
    id: newPlacementId,
    floorId: refPlacement.floorId,
    layer: refPlacement.layer ?? 'electrical',
    pos: {
      x: refPlacement.pos.x + PLAN_ALT_DRAG_COPY_OFFSET.x,
      y: refPlacement.pos.y + PLAN_ALT_DRAG_COPY_OFFSET.y,
    },
    rotationDeg: refPlacement.rotationDeg ?? 0,
    scale: refPlacement.scale ?? 1,
    locked: false,
  })

  const ui = useUIStore.getState()
  ensureSitplanPlacementsForEndpoints(
    store.currentProject!,
    [newEndpointId],
    (id) => store.getEndpointById(id),
    (endpointId, placement) => store.addPlacement(endpointId, placement),
    {
      activeFloorId: ui.activeFloorId,
      viewportLayout: ui.viewportLayout,
      planCanvasViewportPx: ui.planCanvasViewportPx,
      planView: ui.planView,
    },
  )

  useUIStore.getState().setSelection({ type: 'placement', ids: [newPlacementId] })
  return newPlacementId
}

export function runPlanEndpointAltDragDuplicate(
  sourceEndpointId: string,
  dropPos: Point,
  refPlacement: Placement | undefined,
): boolean {
  const store = useProjectStore.getState()
  const source = store.getEndpointById(sourceEndpointId)
  if (!source || !endpointSymbolCanBeDuplicated(source)) return false

  const circuitInfo = store.findCircuitForEndpoint(sourceEndpointId)
  const project = store.currentProject
  if (!circuitInfo || !project) return false

  const r = duplicateEndpointOnCircuit(
    project,
    {
      circuitId: circuitInfo.circuit.id,
      sourceEndpointId,
      context: 'plan',
      placement: { mode: 'new_branch', order: 'before_source_branch' },
    },
    {
      getCircuitById: store.getCircuitById,
      getEndpointById: store.getEndpointById,
      addEndpoint: store.addEndpoint,
      updateCircuit: store.updateCircuit,
      setSelection: undefined,
    },
  )
  if (!r.ok || !r.newEndpointId) return false

  const newEndpointId = r.newEndpointId
  const newEp = store.getEndpointById(newEndpointId)
  if (!newEp) return false

  // Drop behavior clones placements with a fixed offset; replace with the dragged position.
  for (const p of [...(newEp.placements ?? [])]) {
    store.deletePlacement(p.id)
  }

  const ui = useUIStore.getState()
  const floorId =
    refPlacement?.floorId ??
    ui.activeFloorId ??
    getBuildingFloorsFromProject(project)[0]?.id
  if (!floorId) return false

  const newPlacementId = generateId()
  store.addPlacement(newEndpointId, {
    id: newPlacementId,
    floorId,
    layer: refPlacement?.layer ?? 'electrical',
    pos: { x: dropPos.x, y: dropPos.y },
    rotationDeg: refPlacement?.rotationDeg ?? 0,
    scale: refPlacement?.scale ?? 1,
    locked: false,
  })

  ensureSitplanPlacementsForEndpoints(
    store.currentProject!,
    [newEndpointId],
    (id) => store.getEndpointById(id),
    (endpointId, placement) => store.addPlacement(endpointId, placement),
    {
      activeFloorId: ui.activeFloorId,
      viewportLayout: ui.viewportLayout,
      planCanvasViewportPx: ui.planCanvasViewportPx,
      planView: ui.planView,
    },
  )

  useUIStore.getState().setSelection({ type: 'placement', ids: [newPlacementId] })
  return true
}
