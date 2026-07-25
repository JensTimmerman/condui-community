import { logger } from '@/lib/logger'
/**
 * Fix text alignment in SVG export
 * Ensures text-anchor and dominant-baseline are set correctly
 */

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
  const triangleIndex = text.indexOf('△')
  if (triangleIndex === -1) return

  const fontSize = Number.parseFloat(textNode.getAttribute('font-size') ?? '')
  const x = Number.parseFloat(textNode.getAttribute('x') ?? '')
  const y = Number.parseFloat(textNode.getAttribute('y') ?? '')
  if (!Number.isFinite(fontSize) || !Number.isFinite(x) || !Number.isFinite(y)) return

  const fontFamily = textNode.getAttribute('font-family') ?? 'Figtree'
  const prefix = text.slice(0, triangleIndex)
  const prefixWidth = measureSvgTextWidth(prefix, fontFamily, fontSize)
  const triangleWidth = fontSize * 0.72
  const triangleHeight = fontSize * 0.68
  const left = x + prefixWidth
  const top = y - triangleHeight * 0.78
  const bottom = top + triangleHeight
  const middle = left + triangleWidth / 2

  const doc = textNode.ownerDocument
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute(
    'd',
    [
      `M ${middle.toFixed(2)} ${top.toFixed(2)}`,
      `L ${(left + triangleWidth).toFixed(2)} ${bottom.toFixed(2)}`,
      `L ${left.toFixed(2)} ${bottom.toFixed(2)}`,
      'Z',
    ].join(' '),
  )
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', textNode.getAttribute('fill') ?? 'currentColor')
  path.setAttribute('stroke-width', String(Math.max(0.45, fontSize * 0.08)))
  path.setAttribute('stroke-linejoin', 'miter')
  path.setAttribute('pointer-events', 'none')

  textNode.parentNode?.insertBefore(path, textNode)
  textNode.textContent = text.replace('△', ' ')
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
