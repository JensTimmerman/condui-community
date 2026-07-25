/**
 * Shared logic for normalizing Konva.Image nodes before SVG/PDF export.
 * Converts image sources to embedded raster data so exported SVGs/PDFs keep
 * symbol images, floor plan images, rotation, and per-image opacity intact.
 */

import type Konva from 'konva'
import { invertRgbInPlace } from '@/lib/image/planImagePixelOps'
import { isCatalogSymbolImageNode } from '../symbolSvgInject'

function isHtmlImageElement(value: unknown): value is HTMLImageElement {
  return typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`))
    img.src = src
  })
}

async function processSymbolImage(
  image: HTMLImageElement,
  invert: boolean,
  rotationDeg: number,
  opacity: number,
  flipX: boolean,
  flipY: boolean,
): Promise<HTMLImageElement | null> {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height) return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  if (flipX || flipY) {
    context.save()
    context.translate(flipX ? width : 0, flipY ? height : 0)
    context.scale(flipX ? -1 : 1, flipY ? -1 : 1)
    context.drawImage(image, 0, 0, width, height)
    context.restore()
  } else {
    context.drawImage(image, 0, 0, width, height)
  }
  if (invert) {
    const imageData = context.getImageData(0, 0, width, height)
    invertRgbInPlace(imageData.data)
    context.putImageData(imageData, 0, 0)
  }

  if (opacity < 0.999) {
    const imageData = context.getImageData(0, 0, width, height)
    for (let i = 3; i < imageData.data.length; i += 4) {
      imageData.data[i] = Math.round((imageData.data[i] ?? 0) * opacity)
    }
    context.putImageData(imageData, 0, 0)
  }

  const normalizedRotation = ((rotationDeg % 360) + 360) % 360
  if (normalizedRotation === 0) {
    return loadHtmlImage(canvas.toDataURL('image/png'))
  }

  const rad = (normalizedRotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const rotatedWidth = Math.max(1, Math.ceil(Math.abs(width * cos) + Math.abs(height * sin)))
  const rotatedHeight = Math.max(1, Math.ceil(Math.abs(width * sin) + Math.abs(height * cos)))

  const rotatedCanvas = document.createElement('canvas')
  rotatedCanvas.width = rotatedWidth
  rotatedCanvas.height = rotatedHeight
  const rotatedContext = rotatedCanvas.getContext('2d')
  if (!rotatedContext) return loadHtmlImage(canvas.toDataURL('image/png'))

  rotatedContext.translate(rotatedWidth / 2, rotatedHeight / 2)
  rotatedContext.rotate(rad)
  rotatedContext.drawImage(canvas, -width / 2, -height / 2, width, height)

  return loadHtmlImage(rotatedCanvas.toDataURL('image/png'))
}

/**
 * Normalize all Konva.Image nodes in a cloned group for export.
 * Converts images to data URLs so SVG/PDF embed them correctly (blob URLs fail in export).
 * Optionally inverts colors when export theme differs from source.
 */
export type AdjustSymbolImagesForExportOptions = {
  /** When set, controls per-image RGB inversion (e.g. skip endpoint symbols already adjusted). */
  shouldInvertImage?: (node: Konva.Image) => boolean
}

export async function adjustSymbolImagesForExport(
  rootNode: Konva.Group,
  sourceTheme: 'light' | 'dark',
  targetTheme: 'light' | 'dark',
  options?: AdjustSymbolImagesForExportOptions
): Promise<void> {
  const defaultShouldInvert = sourceTheme !== targetTheme
  const imageNodes = rootNode.find('Image')
  const processedBySource = new Map<string, Promise<HTMLImageElement | null>>()
  const jobs: Array<Promise<void>> = []

  imageNodes.forEach((node, index) => {
    const imageNode = node as Konva.Image
    const sourceImage = imageNode.image()
    if (!isHtmlImageElement(sourceImage)) return

    const src = sourceImage.currentSrc || sourceImage.src
    if (isCatalogSymbolImageNode(imageNode)) {
      return
    }
    const rotation = imageNode.rotation() || 0
    const opacity = Math.max(0, Math.min(1, imageNode.opacity() ?? 1))
    const rawWidth = imageNode.width() || 0
    const rawHeight = imageNode.height() || 0
    const rawScaleX = imageNode.scaleX() || 1
    const rawScaleY = imageNode.scaleY() || 1
    const flipX = rawWidth < 0 ? rawScaleX > 0 : rawScaleX < 0
    const flipY = rawHeight < 0 ? rawScaleY > 0 : rawScaleY < 0
    const needsInvert = options?.shouldInvertImage
      ? options.shouldInvertImage(imageNode)
      : defaultShouldInvert
    const cacheKey = `${src || `img-${index}`}::invert=${needsInvert ? 1 : 0}::rot=${rotation}::opacity=${opacity.toFixed(4)}::flipX=${flipX ? 1 : 0}::flipY=${flipY ? 1 : 0}`
    let processedPromise = processedBySource.get(cacheKey)
    if (!processedPromise) {
      processedPromise = processSymbolImage(
        sourceImage,
        needsInvert,
        rotation,
        opacity,
        flipX,
        flipY,
      )
      processedBySource.set(cacheKey, processedPromise)
    }

    jobs.push(
      processedPromise.then((processedImage) => {
        if (processedImage) {
          imageNode.image(processedImage)
          if (rawWidth < 0) {
            imageNode.width(Math.abs(rawWidth))
            imageNode.offsetX(-(imageNode.offsetX() || 0))
          }
          if (rawHeight < 0) {
            imageNode.height(Math.abs(rawHeight))
            imageNode.offsetY(-(imageNode.offsetY() || 0))
          }
          if (rawScaleX < 0) imageNode.scaleX(Math.abs(rawScaleX))
          if (rawScaleY < 0) imageNode.scaleY(Math.abs(rawScaleY))
          if (rotation !== 0) imageNode.rotation(0)
          if (opacity < 0.999) imageNode.opacity(1)
        }
      })
    )
  })

  await Promise.all(jobs)
}
