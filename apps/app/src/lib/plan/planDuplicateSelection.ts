/**
 * Sitplan duplicate: multiplier symbols add placements on the same endpoint;
 * other symbols get a new 1-wire branch + sitplan placement (same as context menu).
 */

import {
  duplicateBranchAboveOnCircuit,
  duplicateEndpointOnCircuit,
  endpointSymbolCanBeDuplicated,
} from '@/lib/eendraad/duplicateEndpoint'
import { ensureSitplanPlacementsForEndpoints } from '@/lib/eendraad/duplicateSitplanHelpers'
import { getCircuitBranches } from '@/lib/layout/endpointChains'
import {
  isMainPanelDistributionEndpoint,
} from '@/lib/plan/panelDistributionEndpoint'
import type { Endpoint, Panel, Placement } from '@/types/schema'
import type { Point, Selection } from '@/types/ui'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import { generateId } from '@/utils'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import {
  getBuildingFloorsFromProject,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'

type PlanDuplicateProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

const MULTIPLIER_PLACEMENT_OFFSET = 24

export type PlanDuplicateItem = {
  endpointId: string
  placementId?: string
  placement?: Placement
}

export type PlanDuplicateGetters = {
  getEndpointById: (id: string) => Endpoint | undefined
  getPlacementById: (id: string) => (Placement & { endpointId?: string }) | undefined
  getPlacementsByFloor: (
    floorId: string
  ) => Array<Placement & { endpointId?: string; junctionPanelLabel?: string; isEarthing?: boolean }>
  findCircuitForEndpoint: (endpointId: string) => { circuit: { id: string; endpoints: Endpoint[]; branches?: Array<{ id: string; label: string; endpointIds: string[] }> } } | undefined
  getPanelById: (id: string) => Panel | undefined
  getPanelByName: (name: string) => Panel | undefined
  getAllEndpoints: () => Endpoint[]
  getCurrentProject: () => PlanDuplicateProject | null
}

export function resolvePlanDuplicateFloorId(
  project: PlanDuplicateProject,
  activeFloorId: string | null,
  refPlacement?: Pick<Placement, 'floorId'>,
): string | undefined {
  return activeFloorId ?? refPlacement?.floorId ?? getBuildingFloorsFromProject(project)[0]?.id
}

function resolvePanelToEndpointId(getters: PlanDuplicateGetters, panelId: string): string | undefined {
  const panel = getters.getPanelById(panelId)
  if (!panel) return undefined
  const endpoint = getters.getAllEndpoints().find((e) => {
    if (e.symbol !== 'panel_distribution') return false
    if (e.panelId === panel.id) return true
    const labelPanel = e.label ? getters.getPanelByName(e.label) : null
    return labelPanel?.id === panel.id
  })
  return endpoint?.id
}

/** Map global selection to endpoint/placement rows on the active floor. */
export function resolvePlanDuplicateItems(
  selection: Selection,
  activeFloorId: string | null,
  getters: PlanDuplicateGetters,
): PlanDuplicateItem[] {
  const result: PlanDuplicateItem[] = []
  if (selection.ids.length === 0) return result

  if (selection.type === 'placement') {
    for (const placementId of selection.ids) {
      const row = getters.getPlacementById(placementId)
      if (!row) continue
      if (!row.endpointId) continue
      const endpoint = getters.getEndpointById(row.endpointId)
      if (!endpoint) continue
      const placement = endpoint.placements.find((p) => p.id === placementId)
      result.push({
        endpointId: endpoint.id,
        placementId,
        placement,
      })
    }
    return result
  }

  let endpointIds: string[] = []
  if (selection.type === 'endpoint') {
    endpointIds = selection.ids
  } else if (selection.type === 'panel') {
    endpointIds = selection.ids
      .map((panelId) => resolvePanelToEndpointId(getters, panelId))
      .filter((id): id is string => !!id)
  } else {
    return result
  }

  for (const endpointId of endpointIds) {
    const endpoint = getters.getEndpointById(endpointId)
    if (!endpoint) continue
    const placement =
      (activeFloorId
        ? endpoint.placements.find((p) => p.floorId === activeFloorId)
        : undefined) ??
      (endpoint.placements.length === 1 ? endpoint.placements[0] : undefined)
    result.push({
      endpointId,
      placementId: placement?.id,
      placement,
    })
  }
  return result
}

function endpointsShareCircuit(
  getters: PlanDuplicateGetters,
  endpointIds: string[],
): boolean {
  if (endpointIds.length <= 1) return true
  let circuitId: string | undefined
  for (const endpointId of endpointIds) {
    const info = getters.findCircuitForEndpoint(endpointId)
    if (!info) return false
    if (circuitId == null) {
      circuitId = info.circuit.id
    } else if (circuitId !== info.circuit.id) {
      return false
    }
  }
  return true
}

/** Whether Duplicate should run for this sitplan selection. */
export function canDuplicatePlanSelection(
  selection: Selection,
  getters: PlanDuplicateGetters,
  activeFloorId: string | null = useUIStore.getState().activeFloorId,
): boolean {
  if (selection.ids.length === 0) return false
  if (selection.type !== 'placement' && selection.type !== 'endpoint' && selection.type !== 'panel') {
    return false
  }

  const items = resolvePlanDuplicateItems(selection, activeFloorId, getters)
  if (items.length === 0) return false

  const project = getters.getCurrentProject()
  const endpointIds = [...new Set(items.map((item) => item.endpointId))]

  for (const endpointId of endpointIds) {
    const endpoint = getters.getEndpointById(endpointId)
    if (!endpoint || !endpointSymbolCanBeDuplicated(endpoint)) return false
    if (
      endpoint.symbol === 'panel_distribution' &&
      project &&
      isMainPanelDistributionEndpoint(project, endpoint)
    ) {
      return false
    }
    if (!endpointSupportsMultiplier(endpoint) && !getters.findCircuitForEndpoint(endpointId)) {
      return false
    }
  }

  const endpoints = endpointIds
    .map((id) => getters.getEndpointById(id))
    .filter((ep): ep is Endpoint => !!ep)
  const allMultiplier = endpoints.every((ep) => endpointSupportsMultiplier(ep))
  const noneMultiplier = endpoints.every((ep) => !endpointSupportsMultiplier(ep))
  if (!allMultiplier && !noneMultiplier) return false

  if (endpointIds.length > 1 && !allMultiplier && !endpointsShareCircuit(getters, endpointIds)) {
    return false
  }

  return true
}

function duplicateMultiplierPlacementsForEndpoint(
  endpointId: string,
  refPlacement: Placement | undefined,
  count: number,
  floorId: string,
  fallbackPosition: Point,
): string[] {
  const store = useProjectStore.getState()
  const endpoint = store.getEndpointById(endpointId)
  if (!endpoint || count < 1) return []

  const newIds: string[] = []
  if (!refPlacement) {
    for (let i = 0; i < count; i++) {
      const id = generateId()
      store.addPlacement(endpointId, {
        id,
        floorId,
        layer: 'electrical',
        pos: {
          x: fallbackPosition.x + MULTIPLIER_PLACEMENT_OFFSET * i,
          y: fallbackPosition.y + MULTIPLIER_PLACEMENT_OFFSET * i,
        },
        rotationDeg: 0,
        scale: 1,
        locked: false,
      })
      newIds.push(id)
    }
    return newIds
  }

  for (let i = 0; i < count; i++) {
    const step = i + 1
    const id = generateId()
    store.addPlacement(endpointId, {
      ...refPlacement,
      id,
      floorId: refPlacement.floorId,
      pos: {
        x: refPlacement.pos.x + MULTIPLIER_PLACEMENT_OFFSET * step,
        y: refPlacement.pos.y + MULTIPLIER_PLACEMENT_OFFSET * step,
      },
      locked: false,
    })
    newIds.push(id)
  }
  return newIds
}

function finishSitplanForNewEndpoints(endpointIds: string[]): void {
  const project = useProjectStore.getState().currentProject
  if (!project || endpointIds.length === 0) return
  const store = useProjectStore.getState()
  const ui = useUIStore.getState()
  ensureSitplanPlacementsForEndpoints(
    project,
    endpointIds,
    (id) => store.getEndpointById(id),
    (endpointId, placement) => store.addPlacement(endpointId, placement),
    {
      activeFloorId: ui.activeFloorId,
      viewportLayout: ui.viewportLayout,
      planCanvasViewportPx: ui.planCanvasViewportPx,
      planView: ui.planView,
    },
  )
}

function duplicateNonMultiplierProperty(
  sourceEndpointId: string,
  refPlacement: Placement | undefined,
  activeFloorId: string | null,
  fallbackPosition: Point,
): string | null {
  const store = useProjectStore.getState()
  const project = store.currentProject
  const circuitInfo = store.findCircuitForEndpoint(sourceEndpointId)
  if (!project || !circuitInfo) return null

  const r = duplicateEndpointOnCircuit(
    project,
    {
      circuitId: circuitInfo.circuit.id,
      sourceEndpointId,
      context: 'plan',
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

  const created = store.getEndpointById(r.newEndpointId)
  if ((created?.placements?.length ?? 0) === 0) {
    const floorId = resolvePlanDuplicateFloorId(project, activeFloorId, refPlacement)
    if (!floorId) return null
    const basePos = refPlacement?.pos ?? fallbackPosition
    const newPlacementId = generateId()
    store.addPlacement(r.newEndpointId, {
      id: newPlacementId,
      floorId,
      layer: refPlacement?.layer ?? 'electrical',
      pos: {
        x: basePos.x + MULTIPLIER_PLACEMENT_OFFSET,
        y: basePos.y + MULTIPLIER_PLACEMENT_OFFSET,
      },
      rotationDeg: refPlacement?.rotationDeg ?? 0,
      scale: refPlacement?.scale ?? 1,
      locked: false,
    })
    return newPlacementId
  }

  return created?.placements[0]?.id ?? null
}

export type PlanDuplicateResult = Selection | null

export function runPlanDuplicate(
  selection: Selection,
  activeFloorId: string | null,
  options?: {
    fallbackPosition?: Point
    withSingleUndoEntry?: (fn: () => boolean, opts?: { sessionLabel?: string }) => boolean
  },
): PlanDuplicateResult {
  const getters: PlanDuplicateGetters = {
    getEndpointById: (id) => useProjectStore.getState().getEndpointById(id),
    getPlacementById: (id) => useProjectStore.getState().getPlacementById(id),
    getPlacementsByFloor: (floorId) => useProjectStore.getState().getPlacementsByFloor(floorId),
    findCircuitForEndpoint: (id) => useProjectStore.getState().findCircuitForEndpoint(id),
    getPanelById: (id) => useProjectStore.getState().getPanelById(id),
    getPanelByName: (name) => useProjectStore.getState().getPanelByName(name),
    getAllEndpoints: () => useProjectStore.getState().getAllEndpoints(),
    getCurrentProject: () => useProjectStore.getState().currentProject,
  }

  if (!canDuplicatePlanSelection(selection, getters, activeFloorId)) return null

  const items = resolvePlanDuplicateItems(selection, activeFloorId, getters)
  if (items.length === 0) return null

  const fallbackPosition = options?.fallbackPosition ?? { x: 0, y: 0 }
  const run = (): PlanDuplicateResult => {
    const store = useProjectStore.getState()
    const project = store.currentProject
    if (!project) return null

    const endpointIds = [...new Set(items.map((item) => item.endpointId))]
    const firstEndpoint = store.getEndpointById(endpointIds[0]!)
    if (!firstEndpoint) return null

    if (endpointSupportsMultiplier(firstEndpoint)) {
      const floorId =
        resolvePlanDuplicateFloorId(project, activeFloorId, items[0]?.placement)
      if (!floorId) return null

      const byEndpoint = new Map<string, PlanDuplicateItem[]>()
      for (const item of items) {
        const group = byEndpoint.get(item.endpointId) ?? []
        group.push(item)
        byEndpoint.set(item.endpointId, group)
      }

      const newPlacementIds: string[] = []
      for (const [endpointId, group] of byEndpoint) {
        const endpoint = store.getEndpointById(endpointId)
        if (!endpoint || !endpointSupportsMultiplier(endpoint)) continue
        const refPlacement =
          group[0]?.placement ??
          endpoint.placements.find((p: Placement) => p.floorId === floorId) ??
          endpoint.placements[0]
        newPlacementIds.push(
          ...duplicateMultiplierPlacementsForEndpoint(
            endpointId,
            refPlacement,
            group.length,
            floorId,
            fallbackPosition,
          ),
        )
      }

      if (newPlacementIds.length === 0) return null
      return { type: 'placement', ids: newPlacementIds }
    }

    if (endpointIds.length === 1) {
      const item = items[0]!
      const newPlacementId = duplicateNonMultiplierProperty(
        item.endpointId,
        item.placement,
        activeFloorId,
        fallbackPosition,
      )
      if (!newPlacementId) return null
      return { type: 'placement', ids: [newPlacementId] }
    }

    const circuitInfo = store.findCircuitForEndpoint(endpointIds[0]!)
    if (!circuitInfo) return null
    const branches = getCircuitBranches(circuitInfo.circuit)
    const branch = branches.find((b) =>
      endpointIds.every((eid) => b.some((ep) => ep.id === eid)),
    )
    if (branch) {
      const orderedIds = branch.map((ep) => ep.id).filter((id) => endpointIds.includes(id))

      const r = duplicateBranchAboveOnCircuit(
        project,
        { circuitId: circuitInfo.circuit.id, sourceEndpointIds: orderedIds, selectNew: false },
        {
          getCircuitById: store.getCircuitById,
          getEndpointById: store.getEndpointById,
          addEndpoint: store.addEndpoint,
          updateCircuit: store.updateCircuit,
          setSelection: undefined,
        },
      )
      if (!r.ok || !r.newEndpointIds?.length) return null
      finishSitplanForNewEndpoints(r.newEndpointIds)

      const newPlacementIds = r.newEndpointIds
        .map((endpointId) => store.getEndpointById(endpointId)?.placements[0]?.id)
        .filter((id): id is string => !!id)
      if (newPlacementIds.length > 0) {
        return { type: 'placement', ids: newPlacementIds }
      }
      return { type: 'endpoint', ids: r.newEndpointIds }
    }

    const newPlacementIds: string[] = []
    for (const item of items) {
      const newPlacementId = duplicateNonMultiplierProperty(
        item.endpointId,
        item.placement,
        activeFloorId,
        fallbackPosition,
      )
      if (!newPlacementId) return null
      newPlacementIds.push(newPlacementId)
    }
    if (newPlacementIds.length === 0) return null
    return { type: 'placement', ids: newPlacementIds }
  }

  if (options?.withSingleUndoEntry) {
    let result: PlanDuplicateResult = null
    options.withSingleUndoEntry(
      () => {
        result = run()
        return result != null
      },
      { sessionLabel: 'duplicate plan selection' },
    )
    return result
  }

  return run()
}
