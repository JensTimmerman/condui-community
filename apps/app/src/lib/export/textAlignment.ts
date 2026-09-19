import { logger } from '@/lib/logger'
import { RESIDUAL_CURRENT_DELTA } from '@/lib/protectionLabels'
/**
 * Fix text alignment in SVG export
 * Ensures text-anchor and dominant-baseline are set correctly
 */

/** Visual size of the canvas Figtree/fallback △, not a full-em mark. */
const RESIDUAL_TRIANGLE_WIDTH_FACTOR = 0.32
const RESIDUAL_TRIANGLE_HEIGHT_FACTOR = 0.34

/**
 * Ensure text alignment is preserved in SVG export
 * 
 * @param svgString SVG string to fix
 * @returns Fixed SVG string
 */
export function fixTextAlignment(svgString: string): string {
  const parser = new DOMParser()
  const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
  
  // Check for parsing errors
  const parserError = svgDoc.querySelector('parsererror')
  if (parserError) {
    logger.warn('[Export] Failed to parse SVG for text alignment fix:', parserError.textContent)
    return svgString
  }
  
  const textNodes = svgDoc.querySelectorAll('text')
  
  textNodes.forEach((textNode) => {
    // Ensure text-anchor is set correctly
    const align = textNode.getAttribute('text-anchor')
    if (!align) {
      // Default to 'start' for left-aligned text (Konva default)
      textNode.setAttribute('text-anchor', 'start')
    }
    
    // Ensure baseline is correct
    const baseline = textNode.getAttribute('dominant-baseline')
    if (!baseline) {
      // Default to 'auto' which works well with most fonts
      textNode.setAttribute('dominant-baseline', 'auto')
    }
    
    // Ensure alignment-baseline is set (for better compatibility)
    const alignmentBaseline = textNode.getAttribute('alignment-baseline')
    if (!alignmentBaseline) {
      textNode.setAttribute('alignment-baseline', 'baseline')
    }

    try {
      replaceResidualCurrentTriangleGlyph(textNode)
    } catch (e) {
      logger.warn('[Export] Failed to vectorize residual-current triangle:', e)
    }
  })
  
  return new XMLSerializer().serializeToString(svgDoc)
}

function replaceResidualCurrentTriangleGlyph(textNode: Element): void {
  const text = textNode.textContent ?? ''
  const triangleIndex = text.indexOf(RESIDUAL_CURRENT_DELTA)
  if (triangleIndex === -1) return

  const parent = textNode.parentNode
  const doc = textNode.ownerDocument
  if (!parent || !doc) return

  const fontSize = Number.parseFloat(textNode.getAttribute('font-size') ?? '')
  // svgcanvas/Konva put the scene position on `transform` and leave x/y as the
  // local fillText point. A path that ignores transform lands at the SVG origin.
  const transform = textNode.getAttribute('transform')
  const parsedX = Number.parseFloat(textNode.getAttribute('x') ?? '')
  const parsedY = Number.parseFloat(textNode.getAttribute('y') ?? '')
  const x = Number.isFinite(parsedX) ? parsedX : transform ? 0 : Number.NaN
  const y = Number.isFinite(parsedY) ? parsedY : transform ? 0 : Number.NaN
  if (!Number.isFinite(fontSize) || !Number.isFinite(x) || !Number.isFinite(y)) return

  const fontFamily = textNode.getAttribute('font-family') ?? 'Figtree'
  // Canvas is `Type A  △300mA`: keep the two spaces, then tuck △ against the milliamps.
  const prefix = text.slice(0, triangleIndex)
  const suffix = text.slice(triangleIndex + RESIDUAL_CURRENT_DELTA.length).trimStart()
  const triangleWidth = fontSize * RESIDUAL_TRIANGLE_WIDTH_FACTOR
  const triangleHeight = fontSize * RESIDUAL_TRIANGLE_HEIGHT_FACTOR
  const prefixWidth = prefix ? measureSvgTextWidth(prefix, fontFamily, fontSize) : 0
  const triangleLeft = x + prefixWidth
  const { top, bottom } = residualTriangleVerticalRange(
    y,
    fontSize,
    triangleHeight,
    textNode.getAttribute('dominant-baseline') ?? 'alphabetic',
  )
  const middle = triangleLeft + triangleWidth / 2

  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute(
    'd',
    [
      `M ${middle.toFixed(2)} ${top.toFixed(2)}`,
      `L ${(triangleLeft + triangleWidth).toFixed(2)} ${bottom.toFixed(2)}`,
      `L ${triangleLeft.toFixed(2)} ${bottom.toFixed(2)}`,
      'Z',
    ].join(' '),
  )
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', textNode.getAttribute('fill') ?? 'currentColor')
  path.setAttribute('stroke-width', String(Math.max(0.18, fontSize * 0.045)))
  path.setAttribute('stroke-linejoin', 'miter')
  path.setAttribute('pointer-events', 'none')
  if (transform) path.setAttribute('transform', transform)

  parent.insertBefore(path, textNode.nextSibling)

  if (suffix) {
    // Keep the canvas spaces; default SVG collapsing would eat the gap before △.
    textNode.setAttribute('xml:space', 'preserve')
    const suffixSpan = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan')
    suffixSpan.setAttribute('dx', triangleWidth.toFixed(2))
    suffixSpan.textContent = suffix
    while (textNode.firstChild) textNode.removeChild(textNode.firstChild)
    if (prefix) textNode.appendChild(doc.createTextNode(prefix))
    textNode.appendChild(suffixSpan)
  } else if (prefix) {
    textNode.textContent = prefix
  } else {
    parent.removeChild(textNode)
  }
}

function residualTriangleVerticalRange(
  y: number,
  fontSize: number,
  height: number,
  dominantBaseline: string,
): { top: number; bottom: number } {
  switch (dominantBaseline) {
    case 'text-before-edge':
    case 'hanging':
    case 'top':
      return { top: y + fontSize * 0.18, bottom: y + fontSize * 0.18 + height }
    case 'central':
    case 'middle':
      return { top: y - height / 2, bottom: y + height / 2 }
    case 'text-after-edge':
    case 'bottom':
    case 'ideographic':
      return { top: y - height, bottom: y }
    case 'alphabetic':
    case 'auto':
    case 'baseline':
    default: {
      // Match the canvas △ glyph: a small cap-height mark, not a full-em triangle on the baseline.
      const mid = y - fontSize * 0.38
      return { top: mid - height / 2, bottom: mid + height / 2 }
    }
  }
}

let svgTextMeasureCanvas: HTMLCanvasElement | null = null
function measureSvgTextWidth(text: string, fontFamily: string, fontSize: number): number {
  if (typeof document === 'undefined') return text.length * fontSize * 0.58
  if (!svgTextMeasureCanvas) svgTextMeasureCanvas = document.createElement('canvas')
  const context = svgTextMeasureCanvas.getContext('2d')
  if (!context) return text.length * fontSize * 0.58
  context.font = `${fontSize}px ${fontFamily}`
  return context.measureText(text).width
}
