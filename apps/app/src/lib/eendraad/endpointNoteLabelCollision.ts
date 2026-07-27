export const ENDPOINT_NOTE_WIRE_CLEARANCE = 4

/** Minimum label-left X relative to an endpoint, based on the vertical branch wire. */
export function getEndpointNoteMinimumLeftX(
  endpointX: number,
  branchWireX: number,
): number {
  return branchWireX - endpointX + ENDPOINT_NOTE_WIRE_CLEARANCE
}

/** Maximum label-right X relative to an endpoint, based on its circuit column. */
export function getEndpointNoteMaximumRightX(
  endpointX: number,
  circuitRightX: number,
): number {
  return circuitRightX - endpointX - ENDPOINT_NOTE_WIRE_CLEARANCE
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
