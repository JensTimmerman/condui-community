/**
 * Apply the hard-locked UI font to exported SVG so PDF export uses Figtree
 * instead of the default serif fallback.
 * Ensures bold text (Konva fontStyle: 'bold') gets font-weight: bold for svg2pdf.
 */
/**
 * Get the font family string used in export (matches @font-face names).
 */
export function getExportFontFamily(): string {
  // Hard-locked to Figtree (no font switching).
  return 'Figtree'
}

function parseStyleToMap(style: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of style.split(';')) {
    const [key, ...v] = part.split(':').map((s) => s.trim())
    if (key && v.length) map.set(key.toLowerCase(), v.join(':').trim())
  }
  return map
}

function mapToStyle(map: Map<string, string>): string {
  return Array.from(map.entries())
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ')
}

/**
 * Check if a value indicates bold (attribute or style).
 * svgcanvas sets font-weight as an attribute (e.g. "700") from canvas font string "bold 10px Figtree".
 */
function isBoldWeight(value: string): boolean {
  if (!value) return false
  const v = value.trim().toLowerCase()
  if (v === 'bold') return true
  const n = parseInt(v, 10)
  if (!isNaN(n) && n >= 600) return true
  return false
}

/**
 * Check if style string indicates bold (font-weight, font-style, or font shorthand).
 */
function isBoldStyle(style: string): boolean {
  if (!style) return false
  const lower = style.toLowerCase()
  if (lower.includes('font-weight:') && /font-weight:\s*(bold|[6-9]\d{2})/.test(lower)) return true
  if (lower.includes('font-style:') && lower.includes('bold')) return true
  if (/\bfont:\s*bold\b/.test(lower) || /\bfont:\s*italic\s+bold\b/.test(lower)) return true
  return false
}

/**
 * Inject font-family and font-weight into the SVG so PDF export uses the user's font.
 * svgcanvas outputs font as attributes (font-weight, font-family) on <text>, not only in style.
 * We set both attributes and style so module titles and kWh label match (bold + our font).
 */
export function applyExportFontToSvg(svgString: string): string {
  const fontFamily = getExportFontFamily()
  const parser = new DOMParser()
  const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
  const svgElement = svgDoc.documentElement

  if (!svgElement || svgElement.nodeName !== 'svg') {
    return svgString
  }

  // Root: set font-family
  const rootStyle = svgElement.getAttribute('style') ?? ''
  const fontRule = `font-family: ${fontFamily}, sans-serif`
  const hasFont = rootStyle.includes('font-family')
  const newRootStyle = hasFont
    ? rootStyle.replace(/font-family:\s*[^;]+;?/gi, fontRule)
    : rootStyle ? `${rootStyle}; ${fontRule}` : fontRule
  svgElement.setAttribute('style', newRootStyle)

  const textNodes = svgDoc.querySelectorAll('text')
  textNodes.forEach((textEl) => {
    const style = textEl.getAttribute('style') ?? ''
    const attrWeight = textEl.getAttribute('font-weight') ?? ''

    // Bold: from style (e.g. "font: bold 10px Figtree") or from attribute (e.g. "700" from svgcanvas)
    const isBold = isBoldStyle(style) || isBoldWeight(attrWeight)

    const map = style ? parseStyleToMap(style) : new Map<string, string>()
    const currentFontStyle = (map.get('font-style') ?? '').toLowerCase()
    const isItalic = currentFontStyle.includes('italic')

    if (isBold) map.set('font-weight', 'bold')
    map.set('font-style', isItalic ? 'italic' : 'normal')
    map.set('font-family', `${fontFamily}, sans-serif`)
    textEl.setAttribute('style', mapToStyle(map))

    // Set attributes so svg2pdf sees them (svgcanvas puts font-weight/font-family as attributes)
    textEl.setAttribute('font-family', `${fontFamily}, sans-serif`)
    textEl.setAttribute('font-weight', isBold ? 'bold' : 'normal')
    textEl.setAttribute('font-style', isItalic ? 'italic' : 'normal')
  })

  return new XMLSerializer().serializeToString(svgDoc)
}
