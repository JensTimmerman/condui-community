import type { Circuit, Panel } from '@/types/schema'

/** Circuits on this panel only (`panel.circuits` + `protection.circuits`). Subpanels are separate panels for naming. */
export function forEachCircuitOnPanel(panel: Panel, fn: (circuit: Circuit) => void): void {
  for (const c of panel.circuits) {
    fn(c)
  }
  for (const protection of panel.protections) {
    for (const c of protection.circuits ?? []) {
      fn(c)
    }
  }
}

/**
 * Resolve the prefix used for sequential endpoint-branch labels.
 *
 * Nested circuits can legitimately have an empty circuit code while already
 * carrying a branch label such as `C1`. In that case, preserve that established
 * prefix so newly added sibling branches become `C2`, `C3`, and so on.
 */
export function getEndpointBranchLabelPrefix(circuit: Circuit): string {
  if (circuit.code === 'PANEL') return ''
  const circuitCode = (circuit.code ?? '').trim()
  if (circuitCode) return circuitCode

  for (const branch of circuit.branches ?? []) {
    const match = (branch.label ?? '').trim().match(/^(.+?)(\d+)$/)
    const prefix = match?.[1]?.trim()
    if (prefix) return prefix
  }

  return ''
}

/**
 * True if branch labels or endpoint labels on those branches differ from `{code}{1..n}`
 * in `circuit.branches` array order.
 */
export function endpointBranchLabelsWouldChange(circuit: Circuit, circuitCodeForBranches: string): boolean {
  if (circuit.code === 'PANEL') return false
  const code = circuitCodeForBranches.trim()
  if (!code) return false
  const branches = circuit.branches
  if (!branches?.length) return false
  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i]!
    const expected = `${code}${i + 1}`
    if ((branch.label ?? '').trim() !== expected) return true
    for (const id of branch.endpointIds) {
      const ep = circuit.endpoints.find((e) => e.id === id)
      if (ep && (ep.label ?? '').trim() !== expected) return true
    }
  }
  return false
}

/**
 * Assign branch + endpoint labels `{circuitCode}1`…`{circuitCode}n` in stored branch order.
 * Always run after branch topology changes (delete, reorder, merge). Not gated on
 * `installation.eendraadAutomaticNaming` — that setting controls main-bus letters and
 * manual protection labels, not sequential branch numbering.
 */
export function syncSequentialEndpointBranchLabelsToCircuit(circuit: Circuit): void {
  if (circuit.supplySource?.kind === 'converter-backup') return
  const code = getEndpointBranchLabelPrefix(circuit)
  if (!code) return
  const branches = circuit.branches
  if (!branches?.length) return
  for (let i = 0; i < branches.length; i++) {
    const label = `${code}${i + 1}`
    const branch = branches[i]!
    branch.label = label
    for (const id of branch.endpointIds) {
      const ep = circuit.endpoints.find((e) => e.id === id)
      if (!ep || ep.domoticaChildProps) continue
      ep.label = label
    }
  }
}

export function applyAutomaticEndpointBranchLabelsToCircuit(circuit: Circuit): void {
  syncSequentialEndpointBranchLabelsToCircuit(circuit)
}

export function applyAutomaticEndpointBranchLabelsToPanel(panel: Panel): void {
  forEachCircuitOnPanel(panel, (circuit) => {
    if (circuit.supplySource?.kind === 'converter-backup') return
    syncSequentialEndpointBranchLabelsToCircuit(circuit)
  })
}
