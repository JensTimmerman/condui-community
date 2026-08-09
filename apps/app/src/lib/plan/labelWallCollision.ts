import type { Wall } from '@/types/schema'
import { resolveWallThicknessPx } from '@/lib/plan/wallVolumeGeometry'
import { getWallPathPoints } from '@/lib/plan/wallCurve'

/** Plan-space axis-aligned bounds for a thick wall segment (canvas units). */
export type WallObstacleRect = { left: number; right: number; top: number; bottom: number }

/**
 * Build AABBs for wall centerlines expanded by half thickness (+ padding) for label overlap tests.
 * Matches {@link resolveWallThicknessPx} / WallRenderer interpretation of wall width.
 */
export function buildWallObstacleRects(
  walls: Wall[],
  masterWallThickness: number,
  pxPerMeter: number | null,
  extraPadPx = 2,
): WallObstacleRect[] {
  const rects: WallObstacleRect[] = []
  for (const wall of walls) {
    const pts = getWallPathPoints(wall)
    const halfThickness = resolveWallThicknessPx(wall, masterWallThickness, pxPerMeter) / 2 + extraPadPx
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!
      const b = pts[i + 1]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      if (len < 1e-6) continue
      const nx = (-dy / len) * halfThickness
      const ny = (dx / len) * halfThickness
      const xs = [a.x + nx, a.x - nx, b.x + nx, b.x - nx]
      const ys = [a.y + ny, a.y - ny, b.y + ny, b.y - ny]
      let left = Infinity
      let right = -Infinity
      let top = Infinity
      let bottom = -Infinity
      for (let j = 0; j < 4; j++) {
        const x = xs[j]!
        const y = ys[j]!
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
      rects.push({ left, right, top, bottom })
    }
  }
  return rects
}
