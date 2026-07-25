/**
 * Load and parse plan graphic catalog SVGs for export (vector, not raster).
 */

import {
  PLAN_GRAPHIC_STROKE_DARK,
  PLAN_GRAPHIC_STROKE_LIGHT,
} from '@/lib/plan/planGraphicColors'
import type { ExportTheme } from '@/lib/export/types'

const CATALOG_STROKE_PATTERN = /#(?:111827|f9fafb|e5e7eb|000000|000)\b/gi

export type PlanGraphicCatalogShape =
  | {
      kind: 'rect'
      x: number
      y: number
      width: number
      height: number
      cornerRadius?: number
      stroke: string
      strokeWidth: number
      fill?: string
    }
  | {
      kind: 'path'
      data: string
      stroke: string
      strokeWidth: number
      fill?: string
      lineCap?: 'butt' | 'round' | 'square'
      lineJoin?: 'miter' | 'round' | 'bevel'
    }
  | {
      kind: 'line'
      points: number[]
      stroke: string
      strokeWidth: number
      lineCap?: 'butt' | 'round' | 'square'
      lineJoin?: 'miter' | 'round' | 'bevel'
    }

export type ParsedPlanGraphicCatalogSvg = {
  viewBox: { x: number; y: number; width: number; height: number }
  shapes: PlanGraphicCatalogShape[]
}

export function getPlanGraphicExportStrokeColor(theme: ExportTheme): string {
  return theme === 'dark' ? PLAN_GRAPHIC_STROKE_DARK : PLAN_GRAPHIC_STROKE_LIGHT
}

export function themePlanGraphicCatalogSvg(svgText: string, strokeColor: string): string {
  let themed = svgText.replace(CATALOG_STROKE_PATTERN, strokeColor)
  themed = themed.replace(
    /stroke:\s*#(?:111827|f9fafb|e5e7eb|000000|000)(?!\d)/gi,
    `stroke: ${strokeColor}`
  )
  return themed
}

function parseStyleRules(doc: Document): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>()
  doc.querySelectorAll('style').forEach((styleEl) => {
    const text = styleEl.textContent ?? ''
    const rulePattern = /\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g
    let match: RegExpExecArray | null
    while ((match = rulePattern.exec(text)) !== null) {
      const className = match[1]!
      const body = match[2]!
      const props: Record<string, string> = {}
      body.split(';').forEach((part) => {
        const colon = part.indexOf(':')
        if (colon === -1) return
        const key = part.slice(0, colon).trim()
        const value = part.slice(colon + 1).trim()
        if (key) props[key] = value
      })
      rules.set(className, props)
    }
  })
  return rules
}

function parseViewBox(svg: SVGSVGElement): { x: number; y: number; width: number; height: number } {
  const raw = svg.getAttribute('viewBox')
  if (raw) {
    const parts = raw.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! }
    }
  }
  const w = Number(svg.getAttribute('width')) || 100
  const h = Number(svg.getAttribute('height')) || 100
  return { x: 0, y: 0, width: w, height: h }
}

function resolvePaint(
  el: Element,
  styleRules: Map<string, Record<string, string>>,
  fallbackStroke: string
): { stroke: string; strokeWidth: number; fill?: string } {
  const className = el.getAttribute('class')?.split(/\s+/)[0]
  const classStyle = className ? styleRules.get(className) : undefined

  const stroke = el.getAttribute('stroke') ?? classStyle?.stroke ?? fallbackStroke

  const strokeWidthRaw =
    el.getAttribute('stroke-width') ?? classStyle?.['stroke-width'] ?? classStyle?.strokeWidth ?? '1'
  const strokeWidth = Number.parseFloat(strokeWidthRaw) || 1

  let fill = el.getAttribute('fill') ?? classStyle?.fill
  if (fill === 'none') fill = undefined

  return { stroke, strokeWidth, fill: fill && fill !== 'none' ? fill : undefined }
}

function ellipseToPathData(cx: number, cy: number, rx: number, ry: number): string {
  if (rx <= 0 || ry <= 0) return ''
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`
}

function parseLength(value: string | null, fallback = 0): number {
  if (!value) return fallback
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : fallback
}

export function parsePlanGraphicCatalogSvg(
  svgText: string,
  fallbackStroke: string
): ParsedPlanGraphicCatalogSvg {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const svg = doc.documentElement
  if (svg.tagName.toLowerCase() !== 'svg') {
    throw new Error('Invalid plan graphic catalog SVG')
  }

  const viewBox = parseViewBox(svg as unknown as SVGSVGElement)
  const styleRules = parseStyleRules(doc)
  const shapes: PlanGraphicCatalogShape[] = []

  const visit = (parent: Element) => {
    Array.from(parent.children).forEach((el) => {
      const tag = el.tagName.toLowerCase()
      if (tag === 'defs' || tag === 'style' || tag === 'metadata') return

      const paint = resolvePaint(el, styleRules, fallbackStroke)

      if (tag === 'rect') {
        shapes.push({
          kind: 'rect',
          x: parseLength(el.getAttribute('x')),
          y: parseLength(el.getAttribute('y')),
          width: parseLength(el.getAttribute('width')),
          height: parseLength(el.getAttribute('height')),
          cornerRadius: parseLength(el.getAttribute('rx')) || parseLength(el.getAttribute('ry')) || undefined,
          ...paint,
        })
        return
      }

      if (tag === 'circle') {
        const cx = parseLength(el.getAttribute('cx'))
        const cy = parseLength(el.getAttribute('cy'))
        const r = parseLength(el.getAttribute('r'))
        const data = ellipseToPathData(cx, cy, r, r)
        if (data) {
          shapes.push({
            kind: 'path',
            data,
            lineCap: 'round',
            lineJoin: 'round',
            ...paint,
          })
        }
        return
      }

      if (tag === 'ellipse') {
        const cx = parseLength(el.getAttribute('cx'))
        const cy = parseLength(el.getAttribute('cy'))
        const rx = parseLength(el.getAttribute('rx'))
        const ry = parseLength(el.getAttribute('ry'))
        const data = ellipseToPathData(cx, cy, rx, ry)
        if (data) {
          shapes.push({
            kind: 'path',
            data,
            lineCap: 'round',
            lineJoin: 'round',
            ...paint,
          })
        }
        return
      }

      if (tag === 'path') {
        const data = el.getAttribute('d')
        if (data) {
          shapes.push({
            kind: 'path',
            data,
            lineCap: (el.getAttribute('stroke-linecap') as 'round') ?? 'round',
            lineJoin: (el.getAttribute('stroke-linejoin') as 'round') ?? 'round',
            ...paint,
          })
        }
        return
      }

      if (tag === 'line') {
        shapes.push({
          kind: 'line',
          points: [
            parseLength(el.getAttribute('x1')),
            parseLength(el.getAttribute('y1')),
            parseLength(el.getAttribute('x2')),
            parseLength(el.getAttribute('y2')),
          ],
          lineCap: (el.getAttribute('stroke-linecap') as 'round') ?? 'round',
          lineJoin: (el.getAttribute('stroke-linejoin') as 'round') ?? 'round',
          ...paint,
        })
        return
      }

      if (tag === 'g' || tag === 'svg') {
        visit(el)
      }
    })
  }

  visit(svg)
  return { viewBox, shapes }
}

const svgTextCache = new Map<string, Promise<string>>()

export async function fetchPlanGraphicCatalogSvgText(svgPath: string): Promise<string> {
  let cached = svgTextCache.get(svgPath)
  if (!cached) {
    cached = fetch(svgPath).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch plan graphic SVG: ${svgPath}`)
      }
      return response.text()
    })
    svgTextCache.set(svgPath, cached)
  }
  return cached
}
