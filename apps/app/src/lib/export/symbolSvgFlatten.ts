/**
 * Bake catalog symbol SVG class styles into presentation attributes for PDF export.
 * svg2pdf does not reliably apply embedded <style> rules or currentColor on injected fragments.
 */

import { XMLSerializer as XmlDomSerializer, type Element as XmlDomElement } from '@xmldom/xmldom'

const SVG_PRESENTATION_KEYS = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'opacity',
  'clip-path',
] as const

const SVG_TEXT_STYLE_KEYS = ['fill', 'font-size', 'font-family'] as const

type StyleRuleMap = Map<string, Record<string, string>>
type XmlElement = Element & { parentNode: Element | null }

function getElementChildren(el: Element): Element[] {
  return Array.from(el.childNodes).filter((node) => node.nodeType === 1) as Element[]
}

function walkElements(root: Element, visit: (el: Element) => void): void {
  visit(root)
  for (const child of getElementChildren(root)) {
    walkElements(child, visit)
  }
}

function parseStyleRules(doc: Document): StyleRuleMap {
  const rules: StyleRuleMap = new Map()
  const styleElements = doc.getElementsByTagName('style')
  for (let index = 0; index < styleElements.length; index++) {
    const styleEl = styleElements[index]
    if (!styleEl) continue
    const text = styleEl.textContent ?? ''
    const rulePattern = /([^{]+)\{([^}]*)\}/g
    let match: RegExpExecArray | null
    while ((match = rulePattern.exec(text)) !== null) {
      const selectors = match[1]!.split(',').map((value) => value.trim())
      const props: Record<string, string> = {}
      match[2]!.split(';').forEach((part) => {
        const colon = part.indexOf(':')
        if (colon === -1) return
        const key = part.slice(0, colon).trim()
        const value = part.slice(colon + 1).trim()
        if (key) props[key] = value
      })
      for (const selector of selectors) {
        const classMatch = selector.match(/^\.([a-zA-Z0-9_-]+)$/)
        if (!classMatch) continue
        const className = classMatch[1]!
        const existing = rules.get(className) ?? {}
        rules.set(className, { ...existing, ...props })
      }
    }
  }
  return rules
}

function isInsideDefs(el: Element): boolean {
  let parent = (el as XmlElement).parentNode
  while (parent) {
    if (parent.nodeName.toLowerCase() === 'defs') return true
    if (parent.nodeName.toLowerCase() === 'svg') return false
    parent = (parent as XmlElement).parentNode
  }
  return false
}

function resolveColor(value: string, strokeColor: string): string {
  return value.replace(/currentColor/gi, strokeColor)
}

function normalizePresentationValue(key: string, value: string, strokeColor: string): string | null {
  if (key === 'display') return null
  const resolved = resolveColor(value, strokeColor)
  if (key === 'stroke-width') return resolved.replace(/px$/i, '')
  if (key === 'font-size') return resolved.replace(/px$/i, '')
  return resolved
}

function applyTextStyleAttributes(
  el: Element,
  computed: Record<string, string>,
  strokeColor: string,
): void {
  for (const key of SVG_TEXT_STYLE_KEYS) {
    const inline = el.getAttribute(key)
    const raw = inline ?? computed[key]
    if (!raw) continue
    const value = normalizePresentationValue(key, raw, strokeColor)
    if (value == null) continue
    el.setAttribute(key, value)
  }
  if (el.hasAttribute('class')) {
    el.removeAttribute('class')
  }
}

function getComputedClassStyle(el: Element, rules: StyleRuleMap): Record<string, string> {
  const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
  const merged: Record<string, string> = {}
  for (const className of classes) {
    const rule = rules.get(className)
    if (rule) Object.assign(merged, rule)
  }
  return merged
}

function applyPresentationAttributes(
  el: Element,
  computed: Record<string, string>,
  strokeColor: string,
): boolean {
  for (const key of SVG_PRESENTATION_KEYS) {
    const inline = el.getAttribute(key)
    const raw = inline ?? computed[key]
    if (!raw) continue
    const value = normalizePresentationValue(key, raw, strokeColor)
    if (value == null) continue
    el.setAttribute(key, value)
  }

  const tag = el.tagName.toLowerCase()
  if (
    (tag === 'path' ||
      tag === 'circle' ||
      tag === 'rect' ||
      tag === 'ellipse' ||
      tag === 'polygon') &&
    !el.hasAttribute('fill') &&
    el.hasAttribute('stroke') &&
    el.getAttribute('stroke') !== 'none'
  ) {
    // SVG defaults missing fill to black; when rasterized as an image that reads as a
    // dark hole in dark mode unless we match the themed stroke color explicitly.
    el.setAttribute('fill', strokeColor)
  }

  if (el.hasAttribute('class')) {
    el.removeAttribute('class')
  }
  return computed.display !== 'none'
}

function prefixSvgIds(root: Element, prefix: string): void {
  const idMap = new Map<string, string>()
  walkElements(root, (el) => {
    const oldId = el.getAttribute('id')
    if (!oldId) return
    const newId = `${prefix}${oldId}`
    idMap.set(oldId, newId)
    el.setAttribute('id', newId)
  })

  const urlPattern = /url\(#([^)]+)\)/g
  walkElements(root, (el) => {
    for (let index = 0; index < el.attributes.length; index++) {
      const attr = el.attributes.item(index)
      if (!attr || !urlPattern.test(attr.value)) continue
      urlPattern.lastIndex = 0
      const next = attr.value.replace(urlPattern, (_, id: string) => {
        const mapped = idMap.get(id) ?? `${prefix}${id}`
        return `url(#${mapped})`
      })
      el.setAttribute(attr.name, next)
    }
  })
}

function pruneHiddenElements(root: Element): void {
  const elements: Element[] = []
  walkElements(root, (el) => {
    if (el !== root) elements.push(el)
  })
  for (let index = elements.length - 1; index >= 0; index--) {
    const el = elements[index]!
    if (isInsideDefs(el)) continue
    if (el.getAttribute('data-export-prune') === '1') {
      el.parentNode?.removeChild(el)
    }
  }
}

function serializeElement(root: Element): string {
  if (typeof globalThis.XMLSerializer !== 'undefined') {
    return new globalThis.XMLSerializer().serializeToString(root)
  }
  return new XmlDomSerializer().serializeToString(root as unknown as XmlDomElement)
}

/**
 * Inline class-based styles, resolve theme stroke color, drop display:none layers,
 * and prefix ids so repeated symbols do not collide in the export SVG.
 */
export function flattenSymbolSvgForExport(
  svgText: string,
  strokeColor: string,
  idPrefix: string,
): string {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const root = doc.documentElement
  if (root.tagName.toLowerCase() !== 'svg') return svgText

  const rules = parseStyleRules(doc)

  walkElements(root, (el) => {
    if (el.tagName.toLowerCase() === 'style') return
    const computed = getComputedClassStyle(el, rules)
    const tag = el.tagName.toLowerCase()
    if (tag === 'text' || tag === 'tspan') {
      applyTextStyleAttributes(el, computed, strokeColor)
      if (!isInsideDefs(el) && computed.display === 'none') {
        el.setAttribute('data-export-prune', '1')
      }
      return
    }
    const visible = applyPresentationAttributes(el, computed, strokeColor)
    if (!isInsideDefs(el) && (!visible || computed.display === 'none')) {
      el.setAttribute('data-export-prune', '1')
    }
  })

  // Prefix only after class styles have been baked into attributes. References such
  // as `clip-path: url(#clippath)` may originate in CSS; prefixing earlier would see
  // the clipPath id but not the still-unmaterialized reference on the target element.
  prefixSvgIds(root, idPrefix)

  const styleElements = doc.getElementsByTagName('style')
  for (let index = styleElements.length - 1; index >= 0; index--) {
    const styleEl = styleElements[index]
    styleEl?.parentNode?.removeChild(styleEl)
  }
  pruneHiddenElements(root)

  walkElements(root, (el) => {
    if (el.hasAttribute('data-export-prune')) {
      el.removeAttribute('data-export-prune')
    }
  })

  return serializeElement(root)
}
