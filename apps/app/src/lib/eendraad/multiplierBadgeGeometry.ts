import type { Point } from '@/types/ui'

export const MULTIPLIER_BADGE_FONT_SIZE = 8
export const MULTIPLIER_BADGE_HEIGHT = MULTIPLIER_BADGE_FONT_SIZE + 2

export function getMultiplierBadgeText(count: number): string {
  return `${count}x`
}

export function getMultiplierBadgeWidth(count: number): number {
  return Math.max(
    9,
    Math.ceil(getMultiplierBadgeText(count).length * MULTIPLIER_BADGE_FONT_SIZE * 0.58)
  )
}

/**
 * Return the badge's top-left position when its bottom-center is anchored to
 * the supplied symbol corner.
 */
export function getMultiplierBadgePosition(anchor: Point, count: number): Point {
  return {
    x: anchor.x - getMultiplierBadgeWidth(count) / 2,
    y: anchor.y - MULTIPLIER_BADGE_HEIGHT,
  }
}
