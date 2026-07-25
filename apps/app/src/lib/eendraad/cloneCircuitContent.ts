import {
  clonePlacementsForDuplicate,
  clonePlacementsOptionsForEndpoint,
} from '@/lib/eendraad/duplicateSitplanHelpers'
import { migrateEndpointLabelsAfterCircuitCodeChange } from '@/lib/eendraad/circuitEndpointLabels'
import type { Branch, Circuit, Endpoint, TrunkDevice } from '@/types/schema'
import { generateId } from '@/utils'

export type CircuitCloneIdMaps = {
  endpoint: Map<string, string>
  trunkDevice: Map<string, string>
  circuit: Map<string, string>
}

function cloneEndpointContent(source: Endpoint, newId: string): Endpoint {
  const clone: Endpoint = JSON.parse(JSON.stringify(source))
  clone.id = newId
  clone.placements =
    source.placements?.length > 0
      ? clonePlacementsForDuplicate(
          source.placements,
          clonePlacementsOptionsForEndpoint(source),
        )
      : []
  clone.controlledEndpointIds = undefined
  if (clone.domoticaProps) {
    clone.domoticaProps = {
      ...clone.domoticaProps,
      endpointChildEndpointIds: undefined,
      controlChildEndpointIds: undefined,
    }
  }
  return clone
}

/**
 * Deep-clone a circuit's consumers (endpoints, branches, trunk devices).
 * `subCircuitIds` are cleared; wire them after all circuits in a subtree are mapped.
 */
export function cloneCircuitContent(
  source: Circuit,
  maps: CircuitCloneIdMaps,
  newCircuitId: string,
  newCode: string,
): Circuit {
  maps.circuit.set(source.id, newCircuitId)

  const endpointIdMap = maps.endpoint
  const newEndpoints: Endpoint[] = []
  for (const ep of source.endpoints) {
    const newEpId = generateId()
    endpointIdMap.set(ep.id, newEpId)
    newEndpoints.push(cloneEndpointContent(ep, newEpId))
  }

  const newTrunkDevices: TrunkDevice[] | undefined = source.trunkDevices?.map((td) => {
    const newTdId = generateId()
    maps.trunkDevice.set(td.id, newTdId)
    return { ...JSON.parse(JSON.stringify(td)), id: newTdId }
  })

  let newBranches: Branch[] | undefined
  if (source.branches?.length) {
    newBranches = source.branches.map((branch) => ({
      id: generateId(),
      label: branch.label,
      endpointIds: branch.endpointIds
        .map((eid) => endpointIdMap.get(eid))
        .filter((id): id is string => !!id),
    }))
  }

  const clone: Circuit = {
    ...JSON.parse(JSON.stringify(source)),
    id: newCircuitId,
    code: newCode,
    endpoints: newEndpoints,
    branches: newBranches,
    trunkDevices: newTrunkDevices,
    subCircuitIds: undefined,
  }

  remapSectionWireOverrides(clone, maps)
  relabelClonedCircuit(source, clone, newCode)
  return clone
}

/** Rename branch + endpoint labels from source circuit code to the new circuit code. */
export function relabelClonedCircuit(source: Circuit, clone: Circuit, newCode: string): void {
  const oldCode = (source.code ?? '').trim()
  const newTrim = newCode.trim()
  migrateEndpointLabelsAfterCircuitCodeChange(clone, oldCode, newTrim)
  clone.code = newTrim
  syncBranchLabelsFromEndpoints(clone)
}

function syncBranchLabelsFromEndpoints(circuit: Circuit): void {
  for (const branch of circuit.branches ?? []) {
    const firstId = branch.endpointIds[0]
    if (!firstId) continue
    const ep = circuit.endpoints.find((e) => e.id === firstId)
    const label = ep?.label?.trim()
    if (label) branch.label = label
  }
}

function remapSectionWireOverrides(circuit: Circuit, maps: CircuitCloneIdMaps): void {
  if (!circuit.sectionWireOverrides?.length) return
  for (const section of circuit.sectionWireOverrides) {
    if (section.fromElementId) {
      section.fromElementId =
        maps.endpoint.get(section.fromElementId) ??
        maps.trunkDevice.get(section.fromElementId) ??
        section.fromElementId
    }
    if (section.toElementId) {
      section.toElementId =
        maps.endpoint.get(section.toElementId) ??
        maps.trunkDevice.get(section.toElementId) ??
        section.toElementId
    }
  }
}

export function wireClonedSubCircuitIds(
  source: Circuit,
  clone: Circuit,
  circuitIdMap: Map<string, string>,
): void {
  if (!source.subCircuitIds?.length) {
    delete clone.subCircuitIds
    return
  }
  const next = source.subCircuitIds
    .map((id) => circuitIdMap.get(id))
    .filter((id): id is string => !!id)
  clone.subCircuitIds = next.length > 0 ? next : undefined
}

export function findCircuitOnPanel(panel: { circuits: Circuit[]; protections: { circuits?: Circuit[] }[] }, circuitId: string): Circuit | undefined {
  for (const c of panel.circuits) {
    if (c.id === circuitId) return c
  }
  for (const p of panel.protections) {
    const hit = p.circuits?.find((c) => c.id === circuitId)
    if (hit) return hit
  }
  return undefined
}
