import type { Branch, Circuit } from '@/types/schema'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'

/**
 * Ensures branch + endpoint labels follow `{circuitCode}1`…`n` in stored branch order.
 * Call after mutating `circuit.branches` / `endpointIds` in add flows.
 */
export function ensureBranchPointLabel(circuit: Circuit, _branch?: Branch): void {
  syncSequentialEndpointBranchLabelsToCircuit(circuit)
}
