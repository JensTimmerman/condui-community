import type { Placement, Rotation } from '@/types/schema'

type SituationPlanRotation = Pick<Placement, 'rotationDeg' | 'rotationMode'>

export function normalizeSituationPlanRotation(rotationDeg: unknown): Rotation {
  if (rotationDeg === 90 || rotationDeg === 180 || rotationDeg === 270) return rotationDeg
  return 0
}

export function nextClockwiseSituationPlanRotation(rotationDeg: unknown): Rotation {
  return ((normalizeSituationPlanRotation(rotationDeg) + 90) % 360) as Rotation
}

export function hasExplicitSituationPlanRotation(
  placement: Pick<SituationPlanRotation, 'rotationMode'>
): boolean {
  return placement.rotationMode === 'explicit'
}

export function explicitClockwiseRotationPatch(
  placement: Pick<SituationPlanRotation, 'rotationDeg'>
): Pick<Placement, 'rotationDeg' | 'rotationMode'> {
  return {
    rotationDeg: nextClockwiseSituationPlanRotation(placement.rotationDeg),
    rotationMode: 'explicit',
  }
}
