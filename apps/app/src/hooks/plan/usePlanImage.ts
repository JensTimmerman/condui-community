import { useState, useEffect, useCallback, useRef } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'
import { applyDarkModeInversion, invertSvgForDarkMode } from '@/utils/planImageProcessing'
import type { Floor } from '@/types/schema'
import { logger } from '@/lib/logger'

export function resolvePlanImageDataUrls(activeFloor: Floor | null): {
  sourceDataUrl: string | undefined
  processedDataUrl: string | undefined
} {
  const canonicalAsset = activeFloor?.planImportAsset
  const processedDataUrl =
    canonicalAsset?.processedDataUrl ?? activeFloor?.planAssetProcessed

  return {
    // Persistence may omit a redundant raster source when the processed bitmap is canonical.
    sourceDataUrl: canonicalAsset?.dataUrl ?? activeFloor?.planAsset ?? processedDataUrl,
    processedDataUrl,
  }
}

/**
 * Hook to load and manage plan image with dark mode inversion
 */
export function usePlanImage(
  activeFloor: Floor | null,
  canvasRef: React.RefObject<{ fitToView: () => void } | null>
) {
  const theme = useSettingsStore((state) => state.theme)
  const activeFloorIdRef = useRef<string | null>(null)
  activeFloorIdRef.current = activeFloor?.id ?? null

  const [planImage, setPlanImage] = useState<HTMLImageElement | null>(null)
  const [planImagePosition, setPlanImagePosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  useEffect(() => {
    const id = activeFloor?.id
    if (!id) {
      setPlanImagePosition({ x: 0, y: 0 })
      return
    }
    const persistedOffset = activeFloor?.planImageOffset
    const saved = useProjectStore.getState().planCanvasPlanImageOffsetByFloorId[id]
    setPlanImagePosition(persistedOffset ?? saved ?? { x: 0, y: 0 })
  }, [activeFloor?.id, activeFloor?.planImageOffset])

  const canonicalAsset = activeFloor?.planImportAsset
  const {
    sourceDataUrl: planImageDataUrl,
    processedDataUrl: planImageProcessedDataUrl,
  } = resolvePlanImageDataUrls(activeFloor)
  const hasWhiteBackground = canonicalAsset?.hasWhiteBackground ?? activeFloor?.planAssetHasWhiteBackground ?? false
  const darkModeAware = canonicalAsset?.darkModeAware ?? hasWhiteBackground
  const svgContent = canonicalAsset?.kind === 'pdf-vector' ? canonicalAsset.svgContent : undefined

  // Load image when plan asset changes
  useEffect(() => {
    if (!planImageDataUrl && !svgContent) {
      setPlanImage(null)
      return
    }

    const loadImage = async () => {
      try {
        // Determine which image URL to use
        let imageUrlToUse = planImageDataUrl ?? ''
        if (svgContent) {
          let svgToUse = svgContent
          if (theme.mode === 'dark' && darkModeAware) {
            svgToUse = await invertSvgForDarkMode(svgContent)
          }
          imageUrlToUse = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgToUse)}`
        } else if (hasWhiteBackground && planImageProcessedDataUrl) {
          // If we have a processed version and it has white background, use that.
          imageUrlToUse = planImageProcessedDataUrl

          // If dark mode support is enabled, apply inversion to the processed image.
          if (theme.mode === 'dark' && darkModeAware) {
            imageUrlToUse = await applyDarkModeInversion(planImageProcessedDataUrl)
          }
        }

        // Load the final image
        const img = new window.Image()
        img.onload = () => {
          setPlanImage(img)
          // Check if there's already a plan image on this floor
          const hasExistingImage = activeFloor?.planAsset || activeFloor?.planImportAsset
          const floorId = activeFloor?.id
          if (!hasExistingImage) {
            // Center the image
            setPlanImagePosition({ x: 0, y: 0 })
            if (floorId) useProjectStore.getState().updateFloor(floorId, { planImageOffset: { x: 0, y: 0 } })
            if (floorId) useProjectStore.getState().setPlanCanvasPlanImageOffset(floorId, { x: 0, y: 0 })
            // Auto-fit to view when image is loaded
            setTimeout(() => {
              canvasRef.current?.fitToView()
            }, 100)
          }
        }
        img.onerror = () => {
          logger.error('Failed to load plan image')
          setPlanImage(null)
        }
        img.src = imageUrlToUse
      } catch (error) {
        logger.error('Failed to process plan image:', error)
        // Fallback to original image
        const img = new window.Image()
        img.onload = () => {
          setPlanImage(img)
          const hasExistingImage = activeFloor?.planAsset || activeFloor?.planImportAsset
          const floorId = activeFloor?.id
          if (!hasExistingImage) {
            setPlanImagePosition({ x: 0, y: 0 })
            if (floorId) useProjectStore.getState().updateFloor(floorId, { planImageOffset: { x: 0, y: 0 } })
            if (floorId) useProjectStore.getState().setPlanCanvasPlanImageOffset(floorId, { x: 0, y: 0 })
            setTimeout(() => {
              canvasRef.current?.fitToView()
            }, 100)
          }
        }
        img.src = planImageDataUrl ?? ''
      }
    }

    loadImage()
  }, [
    planImageDataUrl,
    planImageProcessedDataUrl,
    hasWhiteBackground,
    darkModeAware,
    svgContent,
    theme.mode,
    activeFloor?.planAsset,
    activeFloor?.planImportAsset,
    activeFloor?.id,
    canvasRef,
  ])

  const setPlanImagePositionPersisted = useCallback((update: React.SetStateAction<{ x: number; y: number }>) => {
    setPlanImagePosition((prev) => {
      const next = typeof update === 'function' ? update(prev) : update
      const id = activeFloorIdRef.current
      if (id) {
        const store = useProjectStore.getState()
        store.setPlanCanvasPlanImageOffset(id, next)
        store.updateFloor(id, { planImageOffset: { x: next.x, y: next.y } })
      }
      return next
    })
  }, [])

  return {
    planImage,
    planImagePosition,
    setPlanImagePosition: setPlanImagePositionPersisted,
  }
}
