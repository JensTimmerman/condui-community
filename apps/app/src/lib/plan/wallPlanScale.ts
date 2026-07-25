const WALL_REFERENCE_PX_PER_METER = 100

function resolveWallPlanScale(pxPerMeter: number | null | undefined): number {
  return typeof pxPerMeter === 'number' && Number.isFinite(pxPerMeter) && pxPerMeter > 0
    ? pxPerMeter / WALL_REFERENCE_PX_PER_METER
    : 1
}

/**
 * Wall outlines are intentionally stronger than door and stair detail lines.
 * At their shared reference scale this is about 3.5 px where those details
 * visually read as roughly 2 px, and all of them zoom together.
 */
export function getWallOutlineStrokeWidth(
  pxPerMeter: number | null | undefined,
): number {
  return 1.75 * resolveWallPlanScale(pxPerMeter)
}
