/** 2D affine transform matching SVG matrix(a,b,c,d,e,f) semantics. */
export interface Affine2D {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY_AFFINE: Affine2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

function finiteNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

export function isFiniteAffine(matrix: Affine2D): boolean {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite)
}

export function multiplyAffine(left: Affine2D, right: Affine2D): Affine2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  }
}

export function applyAffine(matrix: Affine2D, point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  }
}

export function invertAffine(matrix: Affine2D): Affine2D | null {
  const det = matrix.a * matrix.d - matrix.b * matrix.c
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    return null
  }
  const invDet = 1 / det
  return {
    a: matrix.d * invDet,
    b: -matrix.b * invDet,
    c: -matrix.c * invDet,
    d: matrix.a * invDet,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) * invDet,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) * invDet,
  }
}

function parseNumberList(raw: string): number[] {
  return raw
    .trim()
    .split(/[\s,]+/)
    .map((part) => finiteNumber(part))
    .filter((value): value is number => value != null)
}

function affineFromTransformFunction(fn: string): Affine2D | null {
  const trimmed = fn.trim()
  const kindMatch = trimmed.match(/^([a-zA-Z]+)\((.*)\)$/)
  if (!kindMatch) return null
  const [, kind, argsRaw] = kindMatch
  if (!argsRaw) return null
  const args = parseNumberList(argsRaw)

  switch (kind) {
    case 'matrix': {
      if (args.length < 6) return null
      const [a, b, c, d, e, f] = args
      return { a: a!, b: b!, c: c!, d: d!, e: e!, f: f! }
    }
    case 'translate': {
      const tx = args[0] ?? 0
      const ty = args[1] ?? 0
      return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }
    }
    case 'scale': {
      const sx = args[0] ?? 1
      const sy = args.length > 1 ? args[1]! : sx
      return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }
    }
    case 'rotate': {
      const angleDeg = args[0] ?? 0
      const cx = args[1] ?? 0
      const cy = args[2] ?? 0
      const rad = (angleDeg * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const rotate = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
      const toOrigin = { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy }
      const fromOrigin = { a: 1, b: 0, c: 0, d: 1, e: cx, f: cy }
      return multiplyAffine(fromOrigin, multiplyAffine(rotate, toOrigin))
    }
    default:
      return null
  }
}

export function parseSvgTransformAttribute(transform: string): Affine2D {
  const functions = transform.match(/[a-zA-Z]+\([^)]*\)/g) ?? []
  let result = IDENTITY_AFFINE
  for (const fn of functions) {
    const next = affineFromTransformFunction(fn)
    if (!next) continue
    // SVG transform lists are composed in source order. With column-vector
    // matrices, that means appending each transform on the right.
    result = multiplyAffine(result, next)
  }
  return result
}

/** Parse the outer LibreDWG CAD→SVG group transform from imported SVG content. */
export function parseOuterCadToSvgMatrix(svgContent: string): Affine2D {
  const matrixMatch = svgContent.match(/<g[^>]*transform=["']matrix\(([^"']+)\)["']/i)
  if (matrixMatch) {
    const matrixArgs = matrixMatch[1]
    if (!matrixArgs) return IDENTITY_AFFINE
    const parsed = affineFromTransformFunction(`matrix(${matrixArgs})`)
    if (parsed) return parsed
  }

  const transformMatch = svgContent.match(/<g[^>]*transform=["']([^"']+)["']/i)
  if (transformMatch?.[1]) {
    return parseSvgTransformAttribute(transformMatch[1])
  }

  return IDENTITY_AFFINE
}

export interface LegacyLibreDwgToSvg {
  translateX: number
  translateY: number
  scale: number
  flipY: boolean
}

export function legacyLibreDwgToAffine(transform: LegacyLibreDwgToSvg): Affine2D {
  if (transform.flipY) {
    return {
      a: transform.scale,
      b: 0,
      c: 0,
      d: -transform.scale,
      e: transform.translateX,
      f: transform.translateY,
    }
  }
  return {
    a: transform.scale,
    b: 0,
    c: 0,
    d: transform.scale,
    e: transform.translateX,
    f: transform.translateY,
  }
}
