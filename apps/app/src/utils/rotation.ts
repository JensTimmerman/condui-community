/**
 * Rotation utilities for symbol placement
 * Supports 4 cardinal orientations: 0°, 90°, 180°, 270°
 */

import type { Rotation } from '@/types/schema'

export const VALID_ROTATIONS: readonly Rotation[] = [0, 90, 180, 270] as const

/**
 * Rotate a value clockwise by 90°
 */
export function rotateClockwise(currentRotation: Rotation): Rotation {
  const index = VALID_ROTATIONS.indexOf(currentRotation)
  const nextIndex = (index + 1) % VALID_ROTATIONS.length
  return VALID_ROTATIONS[nextIndex] as Rotation
}

/**
 * Rotate a value counter-clockwise by 90°
 */
export function rotateCounterClockwise(currentRotation: Rotation): Rotation {
  const index = VALID_ROTATIONS.indexOf(currentRotation)
  const nextIndex = (index - 1 + VALID_ROTATIONS.length) % VALID_ROTATIONS.length
  return VALID_ROTATIONS[nextIndex] as Rotation
}

/**
 * Normalize any angle to the nearest valid rotation
 */
export function normalizeRotation(degrees: number): Rotation {
  const normalized = ((degrees % 360) + 360) % 360
  
  // Find the closest valid rotation
  let closest: Rotation = 0
  let minDiff = 360
  
  for (const validRotation of VALID_ROTATIONS) {
    const diff = Math.abs(normalized - validRotation)
    if (diff < minDiff) {
      minDiff = diff
      closest = validRotation
    }
  }
  
  return closest
}

/**
 * Check if a value is a valid rotation
 */
export function isValidRotation(value: number): value is Rotation {
  return VALID_ROTATIONS.includes(value as Rotation)
}

/**
 * Get the CSS transform string for a rotation
 */
export function getRotationTransform(rotation: Rotation): string {
  return `rotate(${rotation}deg)`
}

/**
 * Get user-friendly label for rotation
 */
export function getRotationLabel(rotation: Rotation): string {
  const labels: Record<Rotation, string> = {
    0: '0° (North)',
    90: '90° (East)',
    180: '180° (South)',
    270: '270° (West)',
  }
  return labels[rotation]
}
