export interface PointLike {
  x: number
  y: number
}

export interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

export interface ProjectedPoint<TPoint extends PointLike = PointLike> {
  point: PointLike
  t: number
  distanceSq: number
  segmentStart: TPoint
  segmentEnd: TPoint
}

export function clamp(value: number, min: number, max: number): number {
  const lower = Math.min(min, max)
  const upper = Math.max(min, max)
  return Math.min(Math.max(value, lower), upper)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function distanceSq(a: PointLike, b: PointLike): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

export function distance(a: PointLike, b: PointLike): number {
  return Math.sqrt(distanceSq(a, b))
}

export function pointInRect(point: PointLike, rect: RectLike): boolean {
  const left = Math.min(rect.x, rect.x + rect.width)
  const right = Math.max(rect.x, rect.x + rect.width)
  const top = Math.min(rect.y, rect.y + rect.height)
  const bottom = Math.max(rect.y, rect.y + rect.height)
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
}

/** Inclusive containment, normalizing either rectangle when width/height is negative. */
export function rectContainsRect(container: RectLike, candidate: RectLike): boolean {
  const containerLeft = Math.min(container.x, container.x + container.width)
  const containerRight = Math.max(container.x, container.x + container.width)
  const containerTop = Math.min(container.y, container.y + container.height)
  const containerBottom = Math.max(container.y, container.y + container.height)
  const candidateLeft = Math.min(candidate.x, candidate.x + candidate.width)
  const candidateRight = Math.max(candidate.x, candidate.x + candidate.width)
  const candidateTop = Math.min(candidate.y, candidate.y + candidate.height)
  const candidateBottom = Math.max(candidate.y, candidate.y + candidate.height)

  return (
    candidateLeft >= containerLeft &&
    candidateRight <= containerRight &&
    candidateTop >= containerTop &&
    candidateBottom <= containerBottom
  )
}

function orientation(a: PointLike, b: PointLike, c: PointLike): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
}

function onSegment(a: PointLike, b: PointLike, c: PointLike): boolean {
  return (
    b.x >= Math.min(a.x, c.x) &&
    b.x <= Math.max(a.x, c.x) &&
    b.y >= Math.min(a.y, c.y) &&
    b.y <= Math.max(a.y, c.y)
  )
}

function segmentsIntersect(a: PointLike, b: PointLike, c: PointLike, d: PointLike): boolean {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)
  const eps = 1e-10

  if (Math.abs(o1) <= eps && onSegment(a, c, b)) return true
  if (Math.abs(o2) <= eps && onSegment(a, d, b)) return true
  if (Math.abs(o3) <= eps && onSegment(c, a, d)) return true
  if (Math.abs(o4) <= eps && onSegment(c, b, d)) return true

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)
}

export function segmentIntersectsRect(a: PointLike, b: PointLike, rect: RectLike): boolean {
  const left = Math.min(rect.x, rect.x + rect.width)
  const right = Math.max(rect.x, rect.x + rect.width)
  const top = Math.min(rect.y, rect.y + rect.height)
  const bottom = Math.max(rect.y, rect.y + rect.height)

  if (Math.max(a.x, b.x) < left || Math.min(a.x, b.x) > right) return false
  if (Math.max(a.y, b.y) < top || Math.min(a.y, b.y) > bottom) return false
  if (pointInRect(a, rect) || pointInRect(b, rect)) return true

  const topLeft = { x: left, y: top }
  const topRight = { x: right, y: top }
  const bottomRight = { x: right, y: bottom }
  const bottomLeft = { x: left, y: bottom }

  return (
    segmentsIntersect(a, b, topLeft, topRight) ||
    segmentsIntersect(a, b, topRight, bottomRight) ||
    segmentsIntersect(a, b, bottomRight, bottomLeft) ||
    segmentsIntersect(a, b, bottomLeft, topLeft)
  )
}

export function projectPointToSegment<TPoint extends PointLike>(
  point: PointLike,
  a: TPoint,
  b: TPoint
): ProjectedPoint<TPoint> {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq <= 1e-10) {
    return {
      point: { x: a.x, y: a.y },
      t: 0,
      distanceSq: distanceSq(point, a),
      segmentStart: a,
      segmentEnd: b,
    }
  }
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq, 0, 1)
  const projected = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
  return {
    point: projected,
    t,
    distanceSq: distanceSq(point, projected),
    segmentStart: a,
    segmentEnd: b,
  }
}

function pointOnPolygonEdge(point: PointLike, a: PointLike, b: PointLike): boolean {
  const cross = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y)
  if (Math.abs(cross) > 1e-10) return false
  return onSegment(a, point, b)
}

export function pointInPolygon(point: PointLike, polygon: PointLike[]): boolean {
  if (polygon.length < 3) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!
    const pj = polygon[j]!
    if (pointOnPolygonEdge(point, pj, pi)) return true
    const intersects =
      (pi.y > point.y) !== (pj.y > point.y) &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x
    if (intersects) inside = !inside
  }
  return inside
}
