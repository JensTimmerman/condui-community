const STAIR_REFERENCE_PX_PER_METER = 100

function resolveStairPlanScale(pxPerMeter: number): number {
  return Number.isFinite(pxPerMeter) && pxPerMeter > 0
    ? pxPerMeter / STAIR_REFERENCE_PX_PER_METER
    : 1
}

export function getStairRenderMetrics(pxPerMeter: number): {
  outlineStroke: number
  stepStroke: number
  arrowStroke: number
  arrowHeadLength: number
  arrowHeadWidth: number
} {
  const scale = resolveStairPlanScale(pxPerMeter)
  return {
    outlineStroke: 1 * scale,
    stepStroke: 0.8 * scale,
    arrowStroke: 0.9 * scale,
    arrowHeadLength: 8 * scale,
    arrowHeadWidth: 7 * scale,
  }
}

export function stairCanvasUnitsToCentimeters(
  canvasUnits: number,
  pxPerMeter: number,
): number {
  if (!Number.isFinite(pxPerMeter) || pxPerMeter <= 0) return canvasUnits
  return (canvasUnits / pxPerMeter) * 100
}

export function stairCentimetersToCanvasUnits(
  centimeters: number,
  pxPerMeter: number,
): number {
  if (!Number.isFinite(pxPerMeter) || pxPerMeter <= 0) return centimeters
  return (centimeters / 100) * pxPerMeter
}
