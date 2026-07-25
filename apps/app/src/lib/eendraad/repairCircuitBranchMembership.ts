import type { Branch, Circuit } from '@/types/schema'
import { generateId } from '@/utils/project'
import { ensureBranchPointLabel } from '@/lib/eendraad/branchLabelConsistency'
import { getNextBranchLabelForCircuit } from '@/lib/eendraad/getNextBranchLabelForCircuit'

function branchesStructureEqual(a: Branch[] | undefined, b: Branch[]): boolean {
  const aa = a ?? []
  if (aa.length !== b.length) return false
  return aa.every((branch, i) => {
    const o = b[i]
    return (
      o &&
      branch.id === o.id &&
      branch.endpointIds.length === o.endpointIds.length &&
      branch.endpointIds.every((id, j) => id === o.endpointIds[j])
    )
  })
}

/**
 * Ensures every non–panel_distribution endpoint on `circuit` appears in exactly one branch.
 * - Drops stale branch refs (endpoint ids no longer on the circuit).
 * - If branches are missing/empty but endpoints exist: one branch per endpoint (safe default).
 * - If branches exist: append a new branch for each endpoint not listed anywhere.
 *
 * @returns whether the circuit was mutated.
 */
export function repairCircuitBranchMembership(circuit: Circuit): boolean {
  if (circuit.code === 'PANEL') return false

  const realEndpoints = circuit.endpoints.filter((e) => e.symbol !== 'panel_distribution')
  if (realEndpoints.length === 0) return false

  const endpointIds = new Set(realEndpoints.map((e) => e.id))

  const branches = (circuit.branches ?? [])
    .map((b) => ({
      ...b,
      endpointIds: b.endpointIds.filter((id) => endpointIds.has(id)),
    }))
    .filter((b) => b.endpointIds.length > 0)

  const inBranch = new Set<string>()
  for (const b of branches) {
    for (const id of b.endpointIds) inBranch.add(id)
  }

  const missing = realEndpoints.filter((ep) => !inBranch.has(ep.id))

  let next: Branch[]
  if (missing.length > 0) {
    if (branches.length === 0) {
      next = realEndpoints.map((ep) => ({
        id: generateId(),
        label: ep.label?.trim() ?? '',
        endpointIds: [ep.id],
      }))
    } else {
      next = [...branches]
      for (const ep of missing) {
        let label = ep.label?.trim()
        if (!label) {
          label = getNextBranchLabelForCircuit(circuit)
          ep.label = label
        }
        next.push({
          id: generateId(),
          label,
          endpointIds: [ep.id],
        })
      }
    }
  } else {
    next = branches
  }

  if (branchesStructureEqual(circuit.branches, next)) return false

  circuit.branches = next.length > 0 ? next : undefined
  for (const br of next) {
    ensureBranchPointLabel(circuit, br)
  }
  return true
}
