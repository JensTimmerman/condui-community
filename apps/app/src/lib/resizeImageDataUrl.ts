/** Maximum stored dimension for installer logo and signature images (px). */
export const INSTALLER_IMAGE_MAX_PX = 500

/**
 * Resize an image data URL so the longest side is at most maxPx.
 * Returns the same data URL if already within limit, otherwise a new JPEG data URL.
 */
export function resizeImageDataUrl(
  dataUrl: string,
  maxPx: number = INSTALLER_IMAGE_MAX_PX
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      if (w <= maxPx && h <= maxPx) {
        resolve(dataUrl)
        return
      }
      const scale = maxPx / Math.max(w, h)
      const cw = Math.round(w * scale)
      const ch = Math.round(h * scale)
      const canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, cw, ch)
      try {
        const resized = canvas.toDataURL('image/jpeg', 0.9)
        resolve(resized)
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}
