/**
 * Domotica drop context: resolves drop target to parent domotica, output group, and index.
 * Used by DragPreview and drop behavior to place children on the correct output wire.
 */

import type { Circuit, Endpoint } from '@/types/schema'
import type { DropTarget } from './findDropTarget'
import type { SymbolMetadata } from '@/lib/symbols'

export interface DomoticaDropContext {
  parent: Endpoint
  circuit: Circuit
  group: 'endpoint'
  outputIndex: number
}

/**
 * If the drop target is a domotica output wire (hit zone with outputGroup/outputIndex),
 * return the context needed for preview and drop execution.
 * Returns null when the target is not a domotica output or the parent endpoint is not in the circuit.
 */
export function getDomoticaDropContextForCircuit(
  circuit: Circuit,
  dropTarget: DropTarget,
  _symbolData: SymbolMetadata | null
): DomoticaDropContext | null {
  if (!dropTarget.domoticaOutput || !dropTarget.endpointId || !dropTarget.circuitId || dropTarget.circuitId !== circuit.id) {
    return null
  }
  const parent = circuit.endpoints.find((e) => e.id === dropTarget.endpointId)
  if (!parent || parent.symbol !== 'domotica' || parent.domoticaChildProps) {
    return null
  }
  return {
    parent,
    circuit,
    group: 'endpoint',
    outputIndex: dropTarget.domoticaOutput.index,
  }
}
