/**
 * Resolve eendraad selection into a duplicate action and run it.
 */

import { getCircuitBranches } from '@/lib/layout/endpointChains'
import {
  duplicateBranchAboveOnCircuit,
  duplicateEndpointOnCircuit,
  endpointSymbolCanBeDuplicated,
} from '@/lib/eendraad/duplicateEndpoint'
import { ensureSitplanPlacementsForEndpoints } from '@/lib/eendraad/duplicateSitplanHelpers'
import type { Panel, TrunkDevice } from '@/types/schema'
import type { Selection } from '@/types/ui'
import { generateId } from '@/utils'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { getElectricalPanelsFromProject } from '@/lib/projectV2/electrical'
import type {
  ProjectStoreActions,
  ProjectStoreGetters,
} from '@/lib/eendraad/contextMenuActions'

export type EendraadDuplicateResult = {
  selection: Selection
} | null

function protectionIdInSelection(selection: Selection, get: ProjectStoreGetters): string | undefined {
  return selection.ids.find((id) => get.getProtectionById?.(id))
}

function circuitIdInSelection(selection: Selection, get: ProjectStoreGetters): string | undefined {
  if (selection.type === 'circuit' && selection.ids.length === 1) {
    return selection.ids[0]
  }
  for (const id of selection.ids) {
    if (get.getCircuitById(id)) return id
  }
  return undefined
}

function endpointIdsShareCircuit(
  endpointIds: string[],
  get: ProjectStoreGetters,
): { circuitId: string } | null {
  if (endpointIds.length === 0) return null
  let circuitId: string | undefined
  for (const eid of endpointIds) {
    const ep = get.getEndpointById(eid)
    if (!ep || !endpointSymbolCanBeDuplicated(ep)) return null
    const info = get.findCircuitForEndpoint(eid)
    if (!info) return null
    if (circuitId == null) {
      circuitId = info.circuit.id
    } else if (circuitId !== info.circuit.id) {
      return null
    }
  }
  return circuitId ? { circuitId } : null
}

function protectionForCircuitId(get: ProjectStoreGetters, circuitId: string): string | undefined {
  const project = get.getCurrentProject?.()
  if (!project) return undefined
  const walk = (panels: Panel[]): string | undefined => {
    for (const panel of panels) {
      for (const prot of panel.protections) {
        if (prot.circuits?.some((c) => c.id === circuitId)) return prot.id
      }
      for (const sub of panel.subPanels ?? []) {
        const found = walk([sub])
        if (found) return found
      }
    }
    return undefined
  }
  return walk(getElectricalPanelsFromProject(project))
}

/** Whether Duplicate should appear for this eendraad selection. */
export function canDuplicateEendraadSelection(
  selection: Selection,
  get: ProjectStoreGetters,
): boolean {
  if (selection.ids.length === 0) return false
  if (selection.type === 'supply' || selection.type === 'ground') return false
  if (selection.ids.includes('supply') || selection.ids.includes('ground')) return false

  if (protectionIdInSelection(selection, get)) return true
  if (selection.type === 'circuit' && selection.ids.length === 1 && get.getCircuitById(selection.ids[0]!)) {
    return !!protectionForCircuitId(get, selection.ids[0]!)
  }

  const endpointIds = selection.ids.filter((id) => get.getEndpointById(id))
  if (endpointIds.length === selection.ids.length && endpointIds.length > 0) {
    return endpointIdsShareCircuit(endpointIds, get) != null
  }

  const trunkIds = selection.ids.filter((id) => get.getTrunkDeviceById(id))
  if (trunkIds.length === selection.ids.length && trunkIds.length > 0) {
    const first = get.getTrunkDeviceById(trunkIds[0]!)
    if (!first) return false
    const isSupply = first.isSupplyDevice
    const isGround = first.isGroundDevice
    const circuitId = first.circuit?.id
    for (let i = 1; i < trunkIds.length; i++) {
      const r = get.getTrunkDeviceById(trunkIds[i]!)
      if (!r) return false
      if (isSupply && !r.isSupplyDevice) return false
      if (isGround && !r.isGroundDevice) return false
      if (circuitId && r.circuit?.id !== circuitId) return false
    }
    return true
  }

  return false
}

function finishSitplanForNewEndpoints(endpointIds: string[], get: ProjectStoreGetters): void {
  const project = get.getCurrentProject?.()
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

export function runEendraadDuplicate(
  selection: Selection,
  get: ProjectStoreGetters,
  actions: ProjectStoreActions,
  duplicateProtection: (protectionId: string) => string | null,
  withSingleUndoEntry?: (fn: () => boolean, options?: { sessionLabel?: string }) => boolean,
): EendraadDuplicateResult {
  if (selection.ids.length === 0) return null

  const protId =
    protectionIdInSelection(selection, get) ??
    (() => {
      const circuitId = circuitIdInSelection(selection, get)
      return circuitId ? protectionForCircuitId(get, circuitId) : undefined
    })()

  if (protId) {
    const newProtId = duplicateProtection(protId)
    if (!newProtId) return null
    return { selection: { type: 'protection', ids: [newProtId] } }
  }

  const runBatch = (fn: () => EendraadDuplicateResult): EendraadDuplicateResult => {
    if (!withSingleUndoEntry) return fn()
    let result: EendraadDuplicateResult = null
    withSingleUndoEntry(
      () => {
        result = fn()
        return result != null
      },
      { sessionLabel: 'duplicate selection' },
    )
    return result
  }

  const endpointIds = selection.ids.filter((id) => get.getEndpointById(id))
  const trunkIds = selection.ids.filter((id) => get.getTrunkDeviceById(id))

  if (endpointIds.length === selection.ids.length && endpointIds.length > 0) {
    return runBatch(() => {
    const info = get.findCircuitForEndpoint(endpointIds[0]!)
    if (!info) return null
    const project = get.getCurrentProject?.() ?? null
    const deps = {
      getCircuitById: get.getCircuitById,
      getEndpointById: get.getEndpointById,
      addEndpoint: actions.addEndpoint,
      updateCircuit: actions.updateCircuit,
      setSelection: actions.setSelection,
    }

    if (endpointIds.length === 1) {
      const eid = endpointIds[0]!
      const ep = get.getEndpointById(eid)
      if (!ep || !endpointSymbolCanBeDuplicated(ep)) return null
      const r = duplicateEndpointOnCircuit(
        project,
        {
          circuitId: info.circuit.id,
          sourceEndpointId: eid,
          context: 'eendraad',
          placement: { mode: 'new_branch', order: 'before_source_branch' },
        },
        deps,
      )
      if (!r.ok || !r.newEndpointId) return null
      finishSitplanForNewEndpoints([r.newEndpointId], get)
      return { selection: { type: 'endpoint', ids: [r.newEndpointId] } }
    }

    const branches = getCircuitBranches(info.circuit)
    const branch = branches.find((b) => endpointIds.every((eid) => b.some((ep) => ep.id === eid)))
    if (branch) {
      const orderedIds = branch.map((ep) => ep.id).filter((id) => endpointIds.includes(id))
      const r = duplicateBranchAboveOnCircuit(
        project,
        { circuitId: info.circuit.id, sourceEndpointIds: orderedIds, selectNew: false },
        deps,
      )
      if (!r.ok || !r.newEndpointIds?.length) return null
      finishSitplanForNewEndpoints(r.newEndpointIds, get)
      return { selection: { type: 'endpoint', ids: r.newEndpointIds } }
    }

    const sortedSourceIds = [...endpointIds].sort((a, b) => {
      const idxA = branches.findIndex((br) => br.some((ep) => ep.id === a))
      const idxB = branches.findIndex((br) => br.some((ep) => ep.id === b))
      return idxA - idxB
    })
    const newEndpointIds: string[] = []
    for (const eid of sortedSourceIds) {
      const ep = get.getEndpointById(eid)
      if (!ep || !endpointSymbolCanBeDuplicated(ep)) return null
      const r = duplicateEndpointOnCircuit(
        project,
        {
          circuitId: info.circuit.id,
          sourceEndpointId: eid,
          context: 'eendraad',
          placement: { mode: 'new_branch', order: 'before_source_branch' },
          selectNew: false,
        },
        deps,
      )
      if (!r.ok || !r.newEndpointId) return null
      newEndpointIds.push(r.newEndpointId)
    }
    if (newEndpointIds.length === 0) return null
    finishSitplanForNewEndpoints(newEndpointIds, get)
    return { selection: { type: 'endpoint', ids: newEndpointIds } }
    })
  }

  if (trunkIds.length === selection.ids.length && trunkIds.length > 0) {
    return runBatch(() => {
    const first = get.getTrunkDeviceById(trunkIds[0]!)
    if (!first) return null
    const { circuit, isSupplyDevice, isGroundDevice } = first
    const devices = trunkIds
      .map((id) => get.getTrunkDeviceById(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .sort((a, b) => (a.device.trunkPosition ?? 0) - (b.device.trunkPosition ?? 0))
    const minPos = Math.min(...devices.map((d) => d.device.trunkPosition ?? 0))
    const newIds: string[] = []

    if (isSupplyDevice && get.getSupplyTrunkDeviceIndex) {
      const indices = trunkIds.map((id) => get.getSupplyTrunkDeviceIndex!(id)).filter((i) => i >= 0)
      const insertIndex = indices.length > 0 ? Math.min(...indices) : 0
      for (let i = 0; i < devices.length; i++) {
        const clone: TrunkDevice = {
          ...JSON.parse(JSON.stringify(devices[i]!.device)),
          id: generateId(),
          trunkPosition: insertIndex + i,
        }
        actions.addSupplyTrunkDevice(clone, insertIndex + i)
        newIds.push(clone.id)
      }
    } else if (isGroundDevice && get.getGroundTrunkDeviceIndex) {
      const indices = trunkIds.map((id) => get.getGroundTrunkDeviceIndex!(id)).filter((i) => i >= 0)
      const insertIndex = indices.length > 0 ? Math.min(...indices) : 0
      for (let i = 0; i < devices.length; i++) {
        const clone: TrunkDevice = {
          ...JSON.parse(JSON.stringify(devices[i]!.device)),
          id: generateId(),
          trunkPosition: insertIndex + i,
        }
        actions.addGroundTrunkDevice(clone, insertIndex + i)
        newIds.push(clone.id)
      }
    } else if (circuit && actions.updateTrunkDevice) {
      for (let i = 0; i < devices.length; i++) {
        const clone: TrunkDevice = {
          ...JSON.parse(JSON.stringify(devices[i]!.device)),
          id: generateId(),
          trunkPosition: minPos + i,
        }
        actions.addTrunkDevice(circuit.id, clone)
        newIds.push(clone.id)
      }
      for (const id of trunkIds) {
        const r = get.getTrunkDeviceById(id)
        if (r?.circuit?.id === circuit.id) {
          actions.updateTrunkDevice(circuit.id, id, {
            trunkPosition: (r.device.trunkPosition ?? 0) + devices.length,
          })
        }
      }
    }

    if (newIds.length > 0) {
      return { selection: { type: 'trunkDevice', ids: newIds } }
    }
    return null
    })
  }

  return null
}
