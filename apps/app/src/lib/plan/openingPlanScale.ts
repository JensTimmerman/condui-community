const OPENING_REFERENCE_PX_PER_METER = 100

function resolveOpeningPlanScale(pxPerMeter: number | null | undefined): number {
  return typeof pxPerMeter === 'number' && Number.isFinite(pxPerMeter) && pxPerMeter > 0
    ? pxPerMeter / OPENING_REFERENCE_PX_PER_METER
    : 1
}

export function getOpeningRenderMetrics(pxPerMeter: number | null | undefined): {
  strokeWidth: number
  swingArcStrokeWidth: number
  frameLength: number
  doorLeafHeight: number
  roomProbeMinimum: number
} {
  const scale = resolveOpeningPlanScale(pxPerMeter)
  return {
    strokeWidth: 1 * scale,
    swingArcStrokeWidth: 0.8 * scale,
    frameLength: 5 * scale,
    doorLeafHeight: 5 * scale,
    roomProbeMinimum: 4 * scale,
  }
}
