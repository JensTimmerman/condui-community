import type { DropTarget } from './findDropTarget'

/**
 * Pick the circuit whose top nesting slot should anchor a protection preview.
 * The resolved drop target is authoritative; debug hit nodes can belong to an
 * overlapping parent slot when nesting below an existing secondary bus.
 */
export function resolveProtectionNestPreviewCircuitId(
  dropTarget: DropTarget | null | undefined,
  matchedNestCircuitId: string | undefined,
): string | undefined {
  if (
    dropTarget?.type === 'circuit' &&
    dropTarget.circuitId &&
    typeof dropTarget.secondaryBusInsertIndex !== 'number'
  ) {
    return dropTarget.circuitId
  }
  return matchedNestCircuitId
}
