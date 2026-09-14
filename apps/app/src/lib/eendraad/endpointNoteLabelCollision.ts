export const ENDPOINT_NOTE_WIRE_CLEARANCE = 4
export const ENDPOINT_NOTE_SLOT_GAP = 2

/** Minimum label-left X relative to an endpoint, keeping the note just clear of the branch wire. */
export function getEndpointNoteMinimumLeftX(endpointX: number, branchWireX: number): number {
  return branchWireX - endpointX + ENDPOINT_NOTE_WIRE_CLEARANCE
}

/**
 * Keep a short label centered, but shift a wide label right when its left edge
 * would cross the branch-wire clearance boundary.
 */
export function getCollisionSafeCenteredLabelLeftX(
  labelWidth: number,
  minimumLeftX?: number,
): number {
  const centeredLeftX = -labelWidth / 2
  return minimumLeftX == null ? centeredLeftX : Math.max(centeredLeftX, minimumLeftX)
}

export interface EndpointNoteLabelBounds {
  minimumLeftX?: number
  maximumRightX?: number
}

/**
 * Give crowded bottom notes a slot between neighboring endpoint symbols.
 * A single note keeps the branch-growth behavior; this only activates when
 * at least two bottom notes share the branch.
 */
export function getCrowdedEndpointNoteLabelBounds(
  endpointIndex: number,
  endpointXs: number[],
  bottomNoteEndpointIndexes: ReadonlySet<number>,
  branchWireX: number,
): EndpointNoteLabelBounds | undefined {
  if (bottomNoteEndpointIndexes.size < 2 || !bottomNoteEndpointIndexes.has(endpointIndex)) {
    return undefined
  }

  const endpointX = endpointXs[endpointIndex]
  if (endpointX == null) return undefined

  const previousEndpointX = endpointXs[endpointIndex - 1]
  const nextEndpointX = endpointXs[endpointIndex + 1]
  return {
    minimumLeftX:
      previousEndpointX == null
        ? getEndpointNoteMinimumLeftX(endpointX, branchWireX)
        : (previousEndpointX + endpointX) / 2 - endpointX + ENDPOINT_NOTE_SLOT_GAP,
    maximumRightX:
      nextEndpointX == null
        ? undefined
        : (endpointX + nextEndpointX) / 2 - endpointX - ENDPOINT_NOTE_SLOT_GAP,
  }
}

/** Available rendered width before a shifted label reaches its right boundary. */
export function getCollisionSafeLabelWidth(
  labelWidth: number,
  leftX: number,
  maximumRightX?: number,
): number {
  return maximumRightX == null
    ? labelWidth
    : Math.max(0, Math.min(labelWidth, maximumRightX - leftX))
}
