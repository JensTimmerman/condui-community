import type { Point2 } from '@/types/schema'

export type RouteAxis = 'horizontal' | 'vertical'

export type RoutePointContext = {
  startPrevious?: Point2
  endNext?: Point2
}

type AxisSegment = {
  horizontal: boolean
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Plan-space offset when routing a shared corridor outside the endpoint span. */
const CORRIDOR_CLEARANCE_PX = 28

const CROSSING_EPS = 1.5

function appendPoint(points: Point2[], point: Point2) {
  const previous = points[points.length - 1]
  if (previous && Math.abs(previous.x - point.x) < 1e-6 && Math.abs(previous.y - point.y) < 1e-6) {
    return
  }
  points.push(point)
}

function contextualNeighbor(
  points: Point2[],
  index: number,
  direction: 'previous' | 'next',
  context?: RoutePointContext,
): Point2 | undefined {
  if (direction === 'previous') {
    return points[index - 1] ?? (index === 0 ? context?.startPrevious : undefined)
  }
  return points[index + 1] ?? (index === points.length - 1 ? context?.endNext : undefined)
}

function throughAxis(
  points: Point2[],
  index: number,
  context?: RoutePointContext,
): RouteAxis | undefined {
  const previous = contextualNeighbor(points, index, 'previous', context)
  const next = contextualNeighbor(points, index, 'next', context)
  if (!previous || !next) return undefined
  return Math.abs(next.y - previous.y) >= Math.abs(next.x - previous.x) ? 'vertical' : 'horizontal'
}

function dedupePolylines(candidates: Point2[][]): Point2[][] {
  const seen = new Set<string>()
  const out: Point2[][] = []
  for (const pts of candidates) {
    const key = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(pts)
  }
  return out
}

/**
 * All reasonable 90° routings for one leg (start → end).
 * The first candidate matches legacy {@link orthogonalSegment} when no crossings apply.
 */
export function orthogonalSegmentCandidates(
  start: Point2,
  end: Point2,
  startAxis?: RouteAxis,
  endAxis?: RouteAxis,
  startPrevious?: Point2,
  endNext?: Point2,
): Point2[][] {
  const candidates: Point2[][] = []
  const add = (points: Point2[]) => candidates.push(points)

  const dx = end.x - start.x
  const dy = end.y - start.y

  if (Math.abs(dx) < 1e-6) {
    add([start, end])
    return dedupePolylines(candidates)
  }

  if (Math.abs(dy) < 1e-6) {
    const y = start.y
    add([start, end])
    add([
      start,
      { x: start.x, y: y - CORRIDOR_CLEARANCE_PX },
      { x: end.x, y: y - CORRIDOR_CLEARANCE_PX },
      end,
    ])
    add([
      start,
      { x: start.x, y: y + CORRIDOR_CLEARANCE_PX },
      { x: end.x, y: y + CORRIDOR_CLEARANCE_PX },
      end,
    ])
    return dedupePolylines(candidates)
  }

  if (endAxis === 'vertical' && endNext && (start.y - end.y) * (endNext.y - end.y) > 0) {
    add([start, { x: end.x, y: start.y }, end])
  }
  if (endAxis === 'horizontal' && endNext && (start.x - end.x) * (endNext.x - end.x) > 0) {
    add([start, { x: start.x, y: end.y }, end])
  }
  if (
    startAxis === 'vertical' &&
    startPrevious &&
    (end.y - start.y) * (startPrevious.y - start.y) > 0
  ) {
    add([start, { x: end.x, y: start.y }, end])
  }
  if (
    startAxis === 'horizontal' &&
    startPrevious &&
    (end.x - start.x) * (startPrevious.x - start.x) > 0
  ) {
    add([start, { x: start.x, y: end.y }, end])
  }

  if (startAxis === 'vertical' && endAxis === 'vertical') {
    const midY = start.y + dy / 2
    add([start, { x: start.x, y: midY }, { x: end.x, y: midY }, end])
    const minY = Math.min(start.y, end.y)
    const maxY = Math.max(start.y, end.y)
    for (const t of [0.25, 0.75]) {
      add([start, { x: start.x, y: start.y + dy * t }, { x: end.x, y: start.y + dy * t }, end])
    }
    add([
      start,
      { x: start.x, y: minY - CORRIDOR_CLEARANCE_PX },
      { x: end.x, y: minY - CORRIDOR_CLEARANCE_PX },
      end,
    ])
    add([
      start,
      { x: start.x, y: maxY + CORRIDOR_CLEARANCE_PX },
      { x: end.x, y: maxY + CORRIDOR_CLEARANCE_PX },
      end,
    ])
  }

  if (startAxis === 'horizontal' && endAxis === 'horizontal') {
    const midX = start.x + dx / 2
    add([start, { x: midX, y: start.y }, { x: midX, y: end.y }, end])
    const minX = Math.min(start.x, end.x)
    const maxX = Math.max(start.x, end.x)
    for (const t of [0.25, 0.75]) {
      add([start, { x: start.x + dx * t, y: start.y }, { x: start.x + dx * t, y: end.y }, end])
    }
    add([
      start,
      { x: minX - CORRIDOR_CLEARANCE_PX, y: start.y },
      { x: minX - CORRIDOR_CLEARANCE_PX, y: end.y },
      end,
    ])
    add([
      start,
      { x: maxX + CORRIDOR_CLEARANCE_PX, y: start.y },
      { x: maxX + CORRIDOR_CLEARANCE_PX, y: end.y },
      end,
    ])
  }

  if (startAxis === 'vertical' || endAxis === 'horizontal') {
    add([start, { x: start.x, y: end.y }, end])
  }
  if (startAxis === 'horizontal' || endAxis === 'vertical') {
    add([start, { x: end.x, y: start.y }, end])
  }

  if (Math.abs(dy) >= Math.abs(dx)) {
    add([start, { x: start.x, y: end.y }, end])
  } else {
    add([start, { x: end.x, y: start.y }, end])
  }

  add([start, { x: start.x, y: end.y }, end])
  add([start, { x: end.x, y: start.y }, end])

  return dedupePolylines(candidates)
}

/** Legacy single-choice segment (first candidate). */
export function orthogonalSegment(
  start: Point2,
  end: Point2,
  startAxis?: RouteAxis,
  endAxis?: RouteAxis,
  startPrevious?: Point2,
  endNext?: Point2,
): Point2[] {
  return (
    orthogonalSegmentCandidates(start, end, startAxis, endAxis, startPrevious, endNext)[0] ?? [
      start,
      end,
    ]
  )
}

export function polylineToAxisSegments(points: Point2[]): AxisSegment[] {
  const segments: AxisSegment[] = []
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!
    const b = points[i + 1]!
    if (Math.abs(a.x - b.x) < 1e-6) {
      segments.push({
        horizontal: false,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
      })
    } else if (Math.abs(a.y - b.y) < 1e-6) {
      segments.push({
        horizontal: true,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
      })
    }
  }
  return segments
}

function segmentInteriorCrosses(a: AxisSegment, b: AxisSegment): boolean {
  if (a.horizontal === b.horizontal) return false
  const h = a.horizontal ? a : b
  const v = a.horizontal ? b : a
  const x = v.x1
  const y = h.y1
  const hMinX = Math.min(h.x1, h.x2)
  const hMaxX = Math.max(h.x1, h.x2)
  const vMinY = Math.min(v.y1, v.y2)
  const vMaxY = Math.max(v.y1, v.y2)
  return (
    x > hMinX + CROSSING_EPS &&
    x < hMaxX - CROSSING_EPS &&
    y > vMinY + CROSSING_EPS &&
    y < vMaxY - CROSSING_EPS
  )
}

export function countInteriorCrossings(
  candidateSegments: AxisSegment[],
  existingSegments: AxisSegment[],
): number {
  let count = 0
  for (const candidate of candidateSegments) {
    for (const existing of existingSegments) {
      if (segmentInteriorCrosses(candidate, existing)) count += 1
    }
  }
  return count
}

/**
 * Extra H/V/H or V/H/V options that route outside blocking segments already on the floor.
 */
function obstacleAwareDetours(
  start: Point2,
  end: Point2,
  existingSegments: AxisSegment[],
): Point2[][] {
  const extras: Point2[][] = []
  const dx = end.x - start.x
  const dy = end.y - start.y

  if (Math.abs(dy) < 1e-6 && Math.abs(dx) >= 1e-6) {
    const y0 = start.y
    const minX = Math.min(start.x, end.x)
    const maxX = Math.max(start.x, end.x)
    let minBlockTop = Infinity
    let maxBlockBottom = -Infinity

    for (const seg of existingSegments) {
      if (seg.horizontal) continue
      const x = seg.x1
      if (x <= minX + CROSSING_EPS || x >= maxX - CROSSING_EPS) continue
      const vMin = Math.min(seg.y1, seg.y2)
      const vMax = Math.max(seg.y1, seg.y2)
      if (y0 > vMin + CROSSING_EPS && y0 < vMax - CROSSING_EPS) {
        minBlockTop = Math.min(minBlockTop, vMin)
        maxBlockBottom = Math.max(maxBlockBottom, vMax)
      }
    }

    if (minBlockTop !== Infinity) {
      const yAbove = minBlockTop - CORRIDOR_CLEARANCE_PX
      extras.push([
        start,
        { x: start.x, y: yAbove },
        { x: end.x, y: yAbove },
        end,
      ])
    }
    if (maxBlockBottom !== -Infinity) {
      const yBelow = maxBlockBottom + CORRIDOR_CLEARANCE_PX
      extras.push([
        start,
        { x: start.x, y: yBelow },
        { x: end.x, y: yBelow },
        end,
      ])
    }
  }

  if (Math.abs(dx) < 1e-6 && Math.abs(dy) >= 1e-6) {
    const x0 = start.x
    const minY = Math.min(start.y, end.y)
    const maxY = Math.max(start.y, end.y)
    let minBlockLeft = Infinity
    let maxBlockRight = -Infinity

    for (const seg of existingSegments) {
      if (!seg.horizontal) continue
      const y = seg.y1
      if (y <= minY + CROSSING_EPS || y >= maxY - CROSSING_EPS) continue
      const hMin = Math.min(seg.x1, seg.x2)
      const hMax = Math.max(seg.x1, seg.x2)
      if (x0 > hMin + CROSSING_EPS && x0 < hMax - CROSSING_EPS) {
        minBlockLeft = Math.min(minBlockLeft, hMin)
        maxBlockRight = Math.max(maxBlockRight, hMax)
      }
    }

    if (minBlockLeft !== Infinity) {
      const xLeft = minBlockLeft - CORRIDOR_CLEARANCE_PX
      extras.push([
        start,
        { x: xLeft, y: start.y },
        { x: xLeft, y: end.y },
        end,
      ])
    }
    if (maxBlockRight !== -Infinity) {
      const xRight = maxBlockRight + CORRIDOR_CLEARANCE_PX
      extras.push([
        start,
        { x: xRight, y: start.y },
        { x: xRight, y: end.y },
        end,
      ])
    }
  }

  // Diagonal legs (corner routes): detour above/below horizontal blockers or left/right of verticals.
  if (Math.abs(dx) >= 1e-6 && Math.abs(dy) >= 1e-6) {
    const minX = Math.min(start.x, end.x)
    const maxX = Math.max(start.x, end.x)
    const minY = Math.min(start.y, end.y)
    const maxY = Math.max(start.y, end.y)
    let blockHMin = Infinity
    let blockHMax = -Infinity
    let blockHMinY = Infinity
    let blockHMaxY = -Infinity
    const blockingVertX: number[] = []

    for (const seg of existingSegments) {
      if (seg.horizontal) {
        const y = seg.y1
        const hMin = Math.min(seg.x1, seg.x2)
        const hMax = Math.max(seg.x1, seg.x2)
        if (y <= minY + CROSSING_EPS || y >= maxY - CROSSING_EPS) continue
        if (hMax <= minX + CROSSING_EPS || hMin >= maxX - CROSSING_EPS) continue
        blockHMinY = Math.min(blockHMinY, y)
        blockHMaxY = Math.max(blockHMaxY, y)
        blockHMin = Math.min(blockHMin, hMin)
        blockHMax = Math.max(blockHMax, hMax)
      } else {
        const x = seg.x1
        const vMin = Math.min(seg.y1, seg.y2)
        const vMax = Math.max(seg.y1, seg.y2)
        if (x <= minX + CROSSING_EPS || x >= maxX - CROSSING_EPS) continue
        if (vMax <= minY + CROSSING_EPS || vMin >= maxY - CROSSING_EPS) continue
        blockingVertX.push(x)
      }
    }

    if (blockHMinY !== Infinity) {
      const yAbove = blockHMinY - CORRIDOR_CLEARANCE_PX
      const yBelow = blockHMaxY + CORRIDOR_CLEARANCE_PX
      extras.push([
        start,
        { x: start.x, y: yAbove },
        { x: end.x, y: yAbove },
        end,
      ])
      extras.push([
        start,
        { x: start.x, y: yBelow },
        { x: end.x, y: yBelow },
        end,
      ])
      const xPastRight = blockHMax + CORRIDOR_CLEARANCE_PX
      const xPastLeft = blockHMin - CORRIDOR_CLEARANCE_PX
      extras.push([
        start,
        { x: xPastRight, y: start.y },
        { x: xPastRight, y: end.y },
        end,
      ])
      extras.push([
        start,
        { x: xPastLeft, y: start.y },
        { x: xPastLeft, y: end.y },
        end,
      ])
    }

    if (blockingVertX.length > 0) {
      let blockVMin = Infinity
      let blockVMax = -Infinity
      let blockVMinX = Infinity
      let blockVMaxX = -Infinity
      for (const seg of existingSegments) {
        if (seg.horizontal) continue
        const x = seg.x1
        const vMin = Math.min(seg.y1, seg.y2)
        const vMax = Math.max(seg.y1, seg.y2)
        if (x <= minX + CROSSING_EPS || x >= maxX - CROSSING_EPS) continue
        if (vMax <= minY + CROSSING_EPS || vMin >= maxY - CROSSING_EPS) continue
        blockVMinX = Math.min(blockVMinX, x)
        blockVMaxX = Math.max(blockVMaxX, x)
        blockVMin = Math.min(blockVMin, vMin)
        blockVMax = Math.max(blockVMax, vMax)
      }
      const xLeft = blockVMinX - CORRIDOR_CLEARANCE_PX
      const xRight = blockVMaxX + CORRIDOR_CLEARANCE_PX
      extras.push([
        start,
        { x: xLeft, y: start.y },
        { x: xLeft, y: end.y },
        end,
      ])
      extras.push([
        start,
        { x: xRight, y: start.y },
        { x: xRight, y: end.y },
        end,
      ])
      const yPastTop = blockVMin - CORRIDOR_CLEARANCE_PX
      const yPastBottom = blockVMax + CORRIDOR_CLEARANCE_PX
      extras.push([
        start,
        { x: start.x, y: yPastTop },
        { x: end.x, y: yPastTop },
        end,
      ])
      extras.push([
        start,
        { x: start.x, y: yPastBottom },
        { x: end.x, y: yPastBottom },
        end,
      ])
    }
  }

  return extras
}

function pointBeforeEnd(points: Point2[]): Point2 | undefined {
  if (points.length < 2) return points[0]
  return points[points.length - 2]
}

function pointAfterStart(points: Point2[]): Point2 | undefined {
  if (points.length < 2) return points[0]
  return points[1]
}

function polylineLength(points: Point2[]): number {
  let length = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    length += Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y)
  }
  return length
}

/**
 * Build a 90° polyline through basePoints, picking per-leg variants that avoid
 * crossing wires already routed on this floor.
 */
export function orthogonalPoints(
  points: Point2[],
  context?: RoutePointContext,
  existingSegments: AxisSegment[] = [],
): Point2[] {
  if (points.length <= 1) return points
  const out: Point2[] = []
  const occupied = [...existingSegments]

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!
    const end = points[index + 1]!
    const candidates = dedupePolylines([
      ...orthogonalSegmentCandidates(
        start,
        end,
        throughAxis(points, index, context),
        throughAxis(points, index + 1, context),
        contextualNeighbor(points, index, 'previous', context),
        contextualNeighbor(points, index + 1, 'next', context),
      ),
      ...obstacleAwareDetours(start, end, occupied),
    ])

    let best = candidates[0]!
    let bestCrossings = Infinity
    let bestLength = Infinity

    for (const candidate of candidates) {
      const segs = polylineToAxisSegments(candidate)
      const crossings = countInteriorCrossings(segs, occupied)
      const length = polylineLength(candidate)
      if (
        crossings < bestCrossings ||
        (crossings === bestCrossings && length < bestLength)
      ) {
        best = candidate
        bestCrossings = crossings
        bestLength = length
      }
    }

    for (const point of best) {
      appendPoint(out, point)
    }
    occupied.push(...polylineToAxisSegments(best))
  }

  return out
}

export type OrthogonalRouteInput = {
  id: string
  /** Wires only avoid crossings with others in the same span set (circuit branch sequence). */
  spanSetKey: string
  basePoints: Point2[]
  context?: RoutePointContext
}

function resolveOrthogonalPolylinesOnce(
  routes: OrthogonalRouteInput[],
): Map<string, Point2[]> {
  const result = new Map<string, Point2[]>()
  const bySpanSet = new Map<string, OrthogonalRouteInput[]>()

  for (const route of routes) {
    const list = bySpanSet.get(route.spanSetKey) ?? []
    list.push(route)
    bySpanSet.set(route.spanSetKey, list)
  }

  for (const spanRoutes of bySpanSet.values()) {
    const sorted = [...spanRoutes].sort((a, b) => a.id.localeCompare(b.id))
    const occupied: AxisSegment[] = []
    for (const route of sorted) {
      const points = orthogonalPoints(route.basePoints, route.context, occupied)
      result.set(route.id, points)
      occupied.push(...polylineToAxisSegments(points))
    }
  }

  return result
}

/** Re-route any wire that still crosses another using full knowledge of other paths. */
function uncrossOrthogonalPolylines(
  routes: OrthogonalRouteInput[],
  polylines: Map<string, Point2[]>,
  maxPasses = 3,
): Map<string, Point2[]> {
  const sorted = [...routes].sort((a, b) => a.id.localeCompare(b.id))
  const result = new Map(polylines)

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false
    for (const route of sorted) {
      const current = result.get(route.id)
      if (!current) continue
      const others = sorted
        .filter(
          (other) => other.id !== route.id && other.spanSetKey === route.spanSetKey,
        )
        .flatMap((other) => polylineToAxisSegments(result.get(other.id) ?? []))
      const currentCrossings = countInteriorCrossings(polylineToAxisSegments(current), others)
      if (currentCrossings === 0) continue

      const rerouted = orthogonalPoints(route.basePoints, route.context, others)
      const newCrossings = countInteriorCrossings(polylineToAxisSegments(rerouted), others)
      if (newCrossings < currentCrossings) {
        result.set(route.id, rerouted)
        changed = true
      }
    }
    if (!changed) break
  }

  return result
}

export type OrthogonalBatchNeighborLookup = {
  getIncomingRouteId: (routeId: string) => string | undefined
  getOutgoingRouteId: (routeId: string) => string | undefined
}

/**
 * Route all orthogonal wires in stable order; optional second pass uses resolved neighbor
 * geometry, then uncrosses any remaining interior intersections.
 */
export function resolveOrthogonalPolylines(
  routes: OrthogonalRouteInput[],
  neighbors?: OrthogonalBatchNeighborLookup,
): Map<string, Point2[]> {
  if (routes.length === 0) return new Map()

  const pass1 = resolveOrthogonalPolylinesOnce(routes)
  if (!neighbors) return uncrossOrthogonalPolylines(routes, pass1)

  const neighborContexts = buildResolvedNeighborContexts(
    routes,
    pass1,
    neighbors.getIncomingRouteId,
    neighbors.getOutgoingRouteId,
  )

  const pass2Routes = routes.map((route) => ({
    ...route,
    context: neighborContexts.get(route.id) ?? route.context,
  }))
  const pass2 = resolveOrthogonalPolylinesOnce(pass2Routes)
  return uncrossOrthogonalPolylines(routes, pass2)
}

/** Build neighbor context from already-resolved polylines (for a second routing pass). */
export function buildResolvedNeighborContexts(
  routes: OrthogonalRouteInput[],
  resolved: Map<string, Point2[]>,
  getIncomingRouteId: (routeId: string) => string | undefined,
  getOutgoingRouteId: (routeId: string) => string | undefined,
): Map<string, RoutePointContext | undefined> {
  const contexts = new Map<string, RoutePointContext | undefined>()
  for (const route of routes) {
    const context: RoutePointContext = {}
    const incomingId = getIncomingRouteId(route.id)
    const outgoingId = getOutgoingRouteId(route.id)
    if (incomingId) {
      const incoming = resolved.get(incomingId)
      const prev = incoming ? pointBeforeEnd(incoming) : undefined
      if (prev) context.startPrevious = prev
    }
    if (outgoingId) {
      const outgoing = resolved.get(outgoingId)
      const next = outgoing ? pointAfterStart(outgoing) : undefined
      if (next) context.endNext = next
    }
    contexts.set(
      route.id,
      context.startPrevious || context.endNext ? context : undefined,
    )
  }
  return contexts
}
