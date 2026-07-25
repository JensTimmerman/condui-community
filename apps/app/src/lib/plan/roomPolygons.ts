import type { Point2, Wall } from '@/types/schema'

// Merge only nearly identical endpoints (same vertex when walls meet)
const KEY_SCALE = 100
function key(p: Point2): string {
  return `${Math.round(p.x * KEY_SCALE) / KEY_SCALE},${Math.round(p.y * KEY_SCALE) / KEY_SCALE}`
}

/**
 * Build closed room polygons from the wall segment graph.
 * Rooms can be a single closed wall (one polyline) or multiple walls that form a loop.
 * Returns polygons in canvas coordinates (same as wall.points).
 */
export function getRoomPolygonsFromWalls(walls: Wall[]): Point2[][] {
  const segments: { a: Point2; b: Point2 }[] = []
  for (const wall of walls) {
    const pts = wall.points
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!
      const b = pts[i + 1]!
      const da = (a.x - b.x) ** 2 + (a.y - b.y) ** 2
      if (da < 1e-8) continue // skip zero-length
      segments.push({ a, b })
    }
  }

  // Adjacency: from each point key -> list of { key, point } (neighbors)
  const adj = new Map<string, Array<{ key: string; point: Point2 }>>()
  const pointByKey = new Map<string, Point2>()
  for (const { a, b } of segments) {
    const ak = key(a)
    const bk = key(b)
    pointByKey.set(ak, a)
    pointByKey.set(bk, b)
    if (!adj.has(ak)) adj.set(ak, [])
    adj.get(ak)!.push({ key: bk, point: b })
    if (!adj.has(bk)) adj.set(bk, [])
    adj.get(bk)!.push({ key: ak, point: a })
  }

  const polygons: Point2[][] = []
  const usedStarts = new Set<string>()

  function normalizeCycleKeys(pts: Point2[]): string {
    const keys = pts.map((p) => key(p))
    const minIdx = keys.reduce((i, k, j) => (k < keys[i]! ? j : i), 0)
    const rotated = keys.slice(minIdx).concat(keys.slice(0, minIdx))
    return rotated.join('|')
  }

  function traceCycle(startPoint: Point2, nextPoint: Point2): Point2[] | null {
    const startKey = key(startPoint)
    const nextKey = key(nextPoint)
    const poly: Point2[] = [startPoint, nextPoint]
    const visitedKeys = new Set<string>([startKey, nextKey])
    let prevKey = startKey
    let currentKey = nextKey
    const maxSteps = segments.length + 2
    for (let steps = 0; steps < maxSteps; steps++) {
      if (currentKey === startKey && poly.length >= 4) {
        poly.pop()
        if (poly.length < 3) return null
        const deduped: Point2[] = []
        for (const p of poly) {
          const k = key(p)
          if (deduped.length === 0 || key(deduped[deduped.length - 1]!) !== k) {
            deduped.push(p)
          }
        }
        return deduped.length >= 3 ? deduped : null
      }
      const neighbors = adj.get(currentKey) ?? []
      const prevPoint = pointByKey.get(prevKey)!
      const currentPoint = pointByKey.get(currentKey)!
      const inDx = currentPoint.x - prevPoint.x
      const inDy = currentPoint.y - prevPoint.y
      let best: { key: string; point: Point2; angle: number } | null = null
      for (const n of neighbors) {
        if (n.key === prevKey) continue
        if (n.key !== startKey && visitedKeys.has(n.key)) continue
        const outDx = n.point.x - currentPoint.x
        const outDy = n.point.y - currentPoint.y
        const cross = inDx * outDy - inDy * outDx
        const dot = inDx * outDx + inDy * outDy
        let angle = Math.atan2(cross, dot)
        if (angle < 0) angle += 2 * Math.PI
        if (best === null || angle > best.angle) best = { key: n.key, point: n.point, angle }
      }
      if (!best) return null
      poly.push(best.point)
      visitedKeys.add(best.key)
      prevKey = currentKey
      currentKey = best.key
    }
    return null
  }

  for (const { a, b } of segments) {
    for (const [start, next] of [
      [a, b] as const,
      [b, a] as const,
    ]) {
      const sk = key(start)
      const nk = key(next)
      const startDir = `${sk}->${nk}`
      if (usedStarts.has(startDir)) continue
      const cycle = traceCycle(start, next)
      if (!cycle) continue
      const cycleKey = normalizeCycleKeys(cycle)
      if (polygons.some((p) => normalizeCycleKeys(p) === cycleKey)) continue
      polygons.push(cycle)
      for (let i = 0; i < cycle.length; i++) {
        const p = cycle[i]!
        const q = cycle[(i + 1) % cycle.length]!
        usedStarts.add(`${key(p)}->${key(q)}`)
      }
    }
  }

  // Open paths: segments not part of any cycle (e.g. U-/C-shaped “room”).
  // Chain them and treat each path as a closed polygon (implicit last→first edge).
  const unusedSegments = segments.filter(({ a, b }) => {
    const ak = key(a)
    const bk = key(b)
    return !usedStarts.has(`${ak}->${bk}`) && !usedStarts.has(`${bk}->${ak}`)
  })
  if (unusedSegments.length > 0) {
    const adjUnused = new Map<string, Array<{ key: string; point: Point2 }>>()
    for (const { a, b } of unusedSegments) {
      const ak = key(a)
      const bk = key(b)
      if (!adjUnused.has(ak)) adjUnused.set(ak, [])
      adjUnused.get(ak)!.push({ key: bk, point: b })
      if (!adjUnused.has(bk)) adjUnused.set(bk, [])
      adjUnused.get(bk)!.push({ key: ak, point: a })
    }
    const degree = new Map<string, number>()
    for (const [k, neighbors] of adjUnused) {
      degree.set(k, neighbors.length)
    }
    const endpoints = [...degree.entries()].filter(([, d]) => d === 1).map(([k]) => k)
    const seenPathKeys = new Set<string>()
    for (const startKey of endpoints) {
      const path: Point2[] = [pointByKey.get(startKey)!]
      let prevKey = startKey
      let currentKey = startKey
      const visited = new Set<string>([startKey])
      for (let steps = 0; steps < unusedSegments.length + 2; steps++) {
        const neighbors = adjUnused.get(currentKey) ?? []
        const next = neighbors.find((n) => n.key !== prevKey)
        if (!next) break
        if (visited.has(next.key) && next.key !== startKey) break
        path.push(next.point)
        visited.add(next.key)
        prevKey = currentKey
        currentKey = next.key
      }
      if (path.length < 3) continue
      const pathKey = path.map((p) => key(p)).join('|')
      const pathKeyReversed = [...path].reverse().map((p) => key(p)).join('|')
      const canonical = pathKey < pathKeyReversed ? pathKey : pathKeyReversed
      if (seenPathKeys.has(canonical)) continue
      seenPathKeys.add(canonical)
      const deduped: Point2[] = []
      for (const p of path) {
        const k = key(p)
        if (deduped.length === 0 || key(deduped[deduped.length - 1]!) !== k) {
          deduped.push(p)
        }
      }
      if (deduped.length >= 3) {
        polygons.push(deduped)
      }
    }
  }

  return polygons
}
