/**
 * Validates two-way / cross switch ordering on endpoint branches (eendraad topology).
 * Other switch types (push, impulse, dimmer, relay, …) are ignored.
 */

import { getCircuitBranches, initializeBranchesIfNeeded } from '@/lib/layout/endpointChains'
import type { Circuit, Endpoint, SymbolKey } from '@/types/schema'

export type SwitchSequenceRole = 'twoway' | 'cross'

export type SwitchSequenceIssueCode =
  | 'wrongTwoWayCount'
  | 'crossWithoutLeadingTwoWay'
  | 'crossWithoutTrailingTwoWay'
  | 'twoWayChaining'

export function getSwitchSequenceRole(symbol: SymbolKey | undefined): SwitchSequenceRole | null {
  if (symbol === 'switch_cross') return 'cross'
  if (symbol === 'switch_1p_twoway' || symbol === 'switch_2p_twoway') return 'twoway'
  return null
}

/**
 * Valid staircase sequences (two-way / cross only):
 * - Exactly two two-ways: `twoway → twoway`
 * - Or: `twoway → (cross)* → twoway` (any number of crosses; no extra two-ways)
 */
export function validateSwitchSequenceRoles(
  roles: SwitchSequenceRole[],
): SwitchSequenceIssueCode | null {
  if (roles.length === 0) return null

  if (roles[0] === 'twoway' && roles[roles.length - 1] !== 'twoway') {
    return 'crossWithoutTrailingTwoWay'
  }

  const twowayCount = roles.filter((r) => r === 'twoway').length
  if (twowayCount !== 2) {
    return 'wrongTwoWayCount'
  }

  if (roles[0] !== 'twoway') {
    return 'crossWithoutLeadingTwoWay'
  }
  // Middle must be crosses only (no two-way ↔ cross ↔ two-way ↔ … chaining)
  for (let i = 1; i < roles.length - 1; i++) {
    if (roles[i] === 'twoway') {
      return 'twoWayChaining'
    }
  }

  return null
}

export interface BranchSwitchSequenceIssue {
  branchLabel: string
  code: SwitchSequenceIssueCode
  switchEndpointIds: string[]
}

function branchLabelFromEndpoints(branchEndpoints: Endpoint[], fallback: string): string {
  return branchEndpoints.find((ep) => ep.label?.trim())?.label?.trim() || fallback
}

/**
 * Scan each branch on a circuit for invalid two-way/cross sequences.
 */
export function collectBranchSwitchSequenceIssues(circuit: Circuit): BranchSwitchSequenceIssue[] {
  initializeBranchesIfNeeded(circuit)
  const branchGroups = getCircuitBranches(circuit)
  const issues: BranchSwitchSequenceIssue[] = []

  branchGroups.forEach((branchEndpoints, index) => {
    const sequence = branchEndpoints
      .map((ep) => {
        const role = getSwitchSequenceRole(ep.symbol)
        return role ? { endpointId: ep.id, role } : null
      })
      .filter((entry): entry is { endpointId: string; role: SwitchSequenceRole } => entry != null)

    if (sequence.length === 0) return

    const code = validateSwitchSequenceRoles(sequence.map((s) => s.role))
    if (!code) return

    const storedBranch = circuit.branches?.find((b) =>
      (b.endpointIds ?? []).some((id) => sequence.some((s) => s.endpointId === id)),
    )
    const label = storedBranch?.label?.trim()
      || branchLabelFromEndpoints(branchEndpoints, `${circuit.code || '?'}${index + 1}`)

    issues.push({
      branchLabel: label,
      code,
      switchEndpointIds: sequence.map((s) => s.endpointId),
    })
  })

  // Endpoints not covered by getCircuitBranches (orphan linear chain)
  const covered = new Set<string>()
  for (const group of branchGroups) {
    for (const ep of group) covered.add(ep.id)
  }
  const orphanSwitches = (circuit.endpoints ?? []).filter(
    (ep) => ep.type === 'switch' && !covered.has(ep.id) && getSwitchSequenceRole(ep.symbol),
  )
  if (orphanSwitches.length > 0) {
    const roles = orphanSwitches
      .map((ep) => getSwitchSequenceRole(ep.symbol)!)
    const code = validateSwitchSequenceRoles(roles)
    if (code) {
      issues.push({
        branchLabel: branchLabelFromEndpoints(orphanSwitches, circuit.code || '?'),
        code,
        switchEndpointIds: orphanSwitches.map((ep) => ep.id),
      })
    }
  }

  return issues
}
