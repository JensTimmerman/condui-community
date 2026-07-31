const scopedSvgMarkupCache = new Map<string, string>()

function svgMarkupHash(markup: string): string {
  let hash = 2166136261
  for (let index = 0; index < markup.length; index += 1) {
    hash ^= markup.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/**
 * Raw SVG assets often reuse generic embedded CSS selectors such as `.cls-1`.
 * Inline SVG style blocks affect the whole document, so scope those selectors
 * per asset before injecting the markup.
 */
export function scopeSvgMarkupClasses(markup: string): string {
  const cached = scopedSvgMarkupCache.get(markup)
  if (cached) return cached

  const classNames = new Set<string>()
  for (const match of markup.matchAll(/\bclass=(["'])(.*?)\1/g)) {
    for (const className of match[2]?.split(/\s+/) ?? []) {
      if (className) classNames.add(className)
    }
  }

  if (classNames.size === 0) {
    scopedSvgMarkupCache.set(markup, markup)
    return markup
  }

  const prefix = `ui-svg-${svgMarkupHash(markup)}`
  const scopedNames = new Map(
    Array.from(classNames, (className) => [className, `${prefix}-${className}`])
  )
  const scoped = markup
    .replace(/\.([_a-zA-Z][\w-]*)/g, (selector, className: string) => {
      const replacement = scopedNames.get(className)
      return replacement ? `.${replacement}` : selector
    })
    .replace(/\bclass=(["'])(.*?)\1/g, (_attribute, quote: string, value: string) => {
      const classes = value
        .split(/\s+/)
        .map((className) => scopedNames.get(className) ?? className)
        .join(' ')
      return `class=${quote}${classes}${quote}`
    })

  scopedSvgMarkupCache.set(markup, scoped)
  return scoped
}
