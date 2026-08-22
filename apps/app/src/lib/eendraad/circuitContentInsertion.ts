import { clamp } from '@/lib/geometry'
import type { Circuit, Panel, TrunkDevice } from '@/types/schema'

export interface CircuitContentInsertionOptions {
  insertBeforeCircuitContent?: boolean
}

function circuitHasLocalContent(circuit: Circuit): boolean {
  return (
    circuit.endpoints.length > 0 ||
    (circuit.branches?.length ?? 0) > 0 ||
    (circuit.trunkDevices?.length ?? 0) > 0
  )
}

function getPanelCircuits(panel: Panel): Circuit[] {
  return [
    ...(panel.circuits ?? []),
    ...(panel.protections ?? []).flatMap((protection) => protection.circuits ?? []),
  ]
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)]
}

function circuitContainsDescendant(
  circuitId: string,
  candidateDescendantId: string,
  byId: ReadonlyMap<string, Circuit>
): boolean {
  const pending = [...(byId.get(circuitId)?.subCircuitIds ?? [])]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const id = pending.pop()!
    if (id === candidateDescendantId) return true
    if (visited.has(id)) continue
    visited.add(id)
    pending.push(...(byId.get(id)?.subCircuitIds ?? []))
  }
  return false
}

/**
 * Reparent an existing circuit onto another circuit's continuation.
 *
 * The ordinary/after placement leaves the target circuit's content in place and
 * attaches the moving circuit after it. The before placement moves that content
 * below the moving protection, matching creation of a new protection on the
 * lower trunk slot.
 */
export function moveCircuitToCircuitContentPosition(
  panel: Panel,
  parentCircuitId: string,
  movingCircuitId: string,
  insertIndex: number,
  options: CircuitContentInsertionOptions = {}
): boolean {
  if (parentCircuitId === movingCircuitId) return false

  const circuits = getPanelCircuits(panel)
  const byId = new Map(circuits.map((circuit) => [circuit.id, circuit]))
  const parentCircuit = byId.get(parentCircuitId)
  const movingCircuit = byId.get(movingCircuitId)
  if (!parentCircuit || !movingCircuit) return false
  if (circuitContainsDescendant(movingCircuitId, parentCircuitId, byId)) return false

  for (const circuit of circuits) {
    if (!circuit.subCircuitIds?.includes(movingCircuitId)) continue
    circuit.subCircuitIds = circuit.subCircuitIds.filter((id) => id !== movingCircuitId)
    if (circuit.subCircuitIds.length === 0) delete circuit.subCircuitIds
  }

  const siblings = (parentCircuit.subCircuitIds ?? []).filter((id) => id !== movingCircuitId)
  const at = clamp(insertIndex, 0, siblings.length)
  siblings.splice(at, 0, movingCircuitId)
  parentCircuit.subCircuitIds = siblings

  if (!options.insertBeforeCircuitContent) return true

  const parentChildren = siblings.filter((id) => id !== movingCircuitId)
  const movingBranchCount =
    movingCircuit.branches?.length ?? (movingCircuit.endpoints.length > 0 ? 1 : 0)
  const shiftedParentTrunkDevices = (parentCircuit.trunkDevices ?? []).map(
    (device): TrunkDevice => ({
      ...device,
      trunkPosition: (device.trunkPosition ?? 0) + movingBranchCount,
    })
  )

  movingCircuit.endpoints = uniqueById([...movingCircuit.endpoints, ...parentCircuit.endpoints])
  if (movingCircuit.branches || parentCircuit.branches) {
    movingCircuit.branches = uniqueById([
      ...(movingCircuit.branches ?? []),
      ...(parentCircuit.branches ?? []),
    ])
  }
  if (movingCircuit.trunkDevices || parentCircuit.trunkDevices) {
    movingCircuit.trunkDevices = uniqueById([
      ...(movingCircuit.trunkDevices ?? []),
      ...shiftedParentTrunkDevices,
    ])
  }
  const downstreamIds = uniqueIds([
    ...(movingCircuit.subCircuitIds ?? []),
    ...parentChildren,
  ]).filter((id) => id !== parentCircuitId && id !== movingCircuitId)
  movingCircuit.subCircuitIds = downstreamIds.length > 0 ? downstreamIds : undefined

  parentCircuit.endpoints = []
  parentCircuit.branches = []
  parentCircuit.trunkDevices = []
  parentCircuit.subCircuitIds = [movingCircuitId]
  return true
}

/**
 * Move a nested circuit's local endpoint/trunk content above its own protection.
 *
 * This is the inverse of inserting an empty protection before circuit content:
 * the nested circuit remains attached to the same parent, while only its local
 * content moves to that parent. Any circuits downstream of the protection stay
 * attached to it.
 */
export function liftCircuitContentAboveOwnProtection(panel: Panel, circuitId: string): boolean {
  const circuits = getPanelCircuits(panel)
  const movingCircuit = circuits.find((circuit) => circuit.id === circuitId)
  const parentCircuit = circuits.find((circuit) => circuit.subCircuitIds?.includes(circuitId))
  if (!movingCircuit || !parentCircuit || !circuitHasLocalContent(movingCircuit)) return false

  // This operation is deliberately a topology rotation, not a content merge.
  // A populated parent means the protection is already below parent content.
  if (circuitHasLocalContent(parentCircuit)) return false

  parentCircuit.endpoints = movingCircuit.endpoints
  parentCircuit.branches = movingCircuit.branches ?? []
  parentCircuit.trunkDevices = movingCircuit.trunkDevices ?? []

  movingCircuit.endpoints = []
  movingCircuit.branches = []
  movingCircuit.trunkDevices = []
  return true
}
