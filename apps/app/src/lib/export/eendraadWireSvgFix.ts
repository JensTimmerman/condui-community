/**
 * Match eendraad wire line caps in exported SVG to the live canvas (butt, not round).
 */

import { XMLSerializer as XmlDomSerializer, type Element as XmlDomElement } from '@xmldom/xmldom'

const EENDRAAD_WIRE_STROKE_WIDTHS = new Set([2, 6])

function serializeDocument(doc: Document): string {
  if (typeof globalThis.XMLSerializer !== 'undefined') {
    return new globalThis.XMLSerializer().serializeToString(doc)
  }
  return new XmlDomSerializer().serializeToString(doc as unknown as XmlDomElement)
}

function parseStrokeWidth(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value.replace(/px$/i, ''))
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * svgcanvas/Konva export can default wire paths to round caps; the editor uses butt caps.
 */
export function fixEendraadWireLineCapsInExportSvg(svgString: string): string {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) return svgString

  const shapes = doc.querySelectorAll('path, line, polyline')
  shapes.forEach((shape) => {
    const strokeWidth = parseStrokeWidth(shape.getAttribute('stroke-width'))
    if (strokeWidth == null || !EENDRAAD_WIRE_STROKE_WIDTHS.has(strokeWidth)) return
    if (!shape.getAttribute('stroke')) return
    shape.setAttribute('stroke-linecap', 'butt')
  })

  return serializeDocument(doc)
}
