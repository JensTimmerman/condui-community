import { logger } from '@/lib/logger'
/**
 * Embed non-data URL <image> refs in export SVG so svg2pdf does not XHR blob:/file URLs.
 */

const DATA_IMAGE_RE = /^data:image\//i

function getImageHref(imageEl: Element): string | null {
  return (
    imageEl.getAttribute('href') ??
    imageEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
    imageEl.getAttribute('xlink:href')
  )
}

function serializeDocument(doc: Document): string {
  if (typeof XMLSerializer !== 'undefined') {
    return new XMLSerializer().serializeToString(doc)
  }
  return doc.documentElement.outerHTML
}

function loadImageAsPngDataUrl(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const width = img.naturalWidth || img.width
      const height = img.naturalHeight || img.height
      if (!width || !height) {
        reject(new Error(`Image has no dimensions: ${src}`))
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('Could not create canvas for image embed'))
        return
      }
      context.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error(`Failed to load image for export embed: ${src}`))
    img.src = src
  })
}

function setImageHref(imageEl: Element, dataUrl: string): void {
  imageEl.setAttribute('href', dataUrl)
  imageEl.removeAttributeNS('http://www.w3.org/1999/xlink', 'href')
  imageEl.removeAttribute('xlink:href')
}

/**
 * Rasterize remaining external/blob image refs to embedded PNG data URLs.
 * svg2pdf fetches non-data hrefs via XMLHttpRequest, which fails for blob URLs.
 */
export async function embedExternalImagesInExportSvg(svgString: string): Promise<string> {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString, 'image/svg+xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) return svgString

  const images = Array.from(doc.querySelectorAll('image'))
  if (images.length === 0) return svgString

  await Promise.all(
    images.map(async (imageEl) => {
      const href = getImageHref(imageEl)
      if (!href || DATA_IMAGE_RE.test(href)) return

      try {
        const dataUrl = await loadImageAsPngDataUrl(href)
        setImageHref(imageEl, dataUrl)
      } catch (error) {
        logger.warn('[Export] Dropping unloadable SVG image for PDF compose:', href, error)
        imageEl.parentNode?.removeChild(imageEl)
      }
    }),
  )

  return serializeDocument(doc)
}
