const DRAG_IMAGE_SIZE = 36

export type LibraryDragImageStrategy = 'element' | 'canvas-from-blob' | 'empty-canvas'

function createEmptyDragCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = DRAG_IMAGE_SIZE
  canvas.height = DRAG_IMAGE_SIZE
  return canvas
}

/**
 * Browsers such as Brave on Linux may abort HTML5 drag-and-drop when
 * setDragImage references DOM that contains blob-URL <img> nodes.
 * Draw loaded symbol previews onto a canvas drag image instead.
 */
export function setLibrarySymbolDragImage(
  event: DragEvent,
  iconEl: HTMLElement
): LibraryDragImageStrategy {
  const blobImg = iconEl.querySelector('img[src^="blob:"]')
  if (blobImg instanceof HTMLImageElement) {
    const canvas = createEmptyDragCanvas()
    const ctx = canvas.getContext('2d')
    if (ctx && blobImg.complete && blobImg.naturalWidth > 0) {
      ctx.drawImage(blobImg, 0, 0, DRAG_IMAGE_SIZE, DRAG_IMAGE_SIZE)
    }
    event.dataTransfer?.setDragImage(canvas, DRAG_IMAGE_SIZE / 2, DRAG_IMAGE_SIZE / 2)
    return blobImg.complete && blobImg.naturalWidth > 0 ? 'canvas-from-blob' : 'empty-canvas'
  }

  const rect = iconEl.getBoundingClientRect()
  event.dataTransfer?.setDragImage(iconEl, rect.width / 2, rect.height / 2)
  return 'element'
}
