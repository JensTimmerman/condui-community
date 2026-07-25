import { useMemo } from 'react'
import type { Floor } from '@/types/schema'
import type { PlanView } from '@/stores/uiStore'
import { calculatePxPerMeter } from './usePlanScale'

/**
 * Pixels per meter for distances in plan canvas coordinates.
 *
 * Uses floor calibration (`scale`) when present, or the same convention as
 * {@link usePlanGrid} when uncalibrated: grid slider is centimeters per cell,
 * and spacing in canvas units equals that value, so 1 canvas unit = 1 cm
 * (100 canvas units per meter).
 *
 * @param tempPxPerMeter - While redefining scale, the in-progress ruler value (matches grid override).
 */
export function resolvePlanCanvasPxPerMeter(
  floor: Floor | null,
  planViewGridSizeCm: number,
  gridSpacingCanvas: number,
  tempPxPerMeter?: number | null,
): number {
  const calibrated =
    tempPxPerMeter != null && Number.isFinite(tempPxPerMeter) && tempPxPerMeter > 0
      ? tempPxPerMeter
      : calculatePxPerMeter(floor)
  if (calibrated != null && calibrated > 0) {
    return calibrated
  }

  const cm = planViewGridSizeCm
  const px = gridSpacingCanvas
  if (!Number.isFinite(cm) || cm <= 0 || !Number.isFinite(px) || px <= 0) {
    return 100
  }
  return px / (cm / 100)
}

/**
 * Calculate grid spacing in world units for the plan canvas.
 *
 * Semantics:
 * - When a floor scale is calibrated (pxPerMeter known), `planView.gridSize` is
 *   interpreted as a physical spacing in centimeters. For example, a value of
 *   50 means a 0.5 m grid.
 * - When no scale is available, `planView.gridSize` falls back to raw pixels.
 */
export function usePlanGrid(
  activeFloor: Floor | null,
  planView: PlanView,
  _isFloorPlanMode: boolean,
  overridePxPerMeter?: number | null,
): number {
  const gridSize = useMemo(() => {
    const pxPerMeter =
      overridePxPerMeter != null
        ? overridePxPerMeter
        : calculatePxPerMeter(activeFloor)

    // No calibrated scale yet: treat gridSize as pixels in canvas space.
    if (!pxPerMeter) return planView.gridSize

    // With a calibrated scale, interpret planView.gridSize as centimeters.
    const gridStepCentimeters = planView.gridSize
    const gridStepMeters = gridStepCentimeters / 100

    if (!Number.isFinite(gridStepMeters) || gridStepMeters <= 0) {
      return pxPerMeter // fall back to 1 m if slider is somehow invalid
    }

    return pxPerMeter * gridStepMeters
  }, [activeFloor, planView.gridSize, overridePxPerMeter])

  return gridSize
}
