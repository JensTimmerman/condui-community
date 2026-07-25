/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  useLayoutEffect,
  type RefObject,
} from 'react'
import {
  CANVAS_OVERLAY_COMPACT_SCALE,
  CANVAS_OVERLAY_FULL_SCALE,
  CANVAS_OVERLAY_COMPACT_THRESHOLD,
} from '@/constants/canvasConstants'

export interface CanvasOverlayScaleContextValue {
  /** Scale factor for floating canvas UI (1 = full size, <1 = compact). */
  scale: number
  /** True when scale < 1 (compartment too small for full-size overlays). */
  isCompact: boolean
  /** Measured overlay container width in CSS px. */
  width: number
  /** Measured overlay container height in CSS px. */
  height: number
  /** Smaller measured dimension, useful for responsive overlay layouts. */
  minDimension: number
}

const defaultValue: CanvasOverlayScaleContextValue = {
  scale: CANVAS_OVERLAY_FULL_SCALE,
  isCompact: false,
  width: 0,
  height: 0,
  minDimension: 0,
}

const CanvasOverlayScaleContext = createContext<CanvasOverlayScaleContextValue>(defaultValue)

export function useCanvasOverlayScale(): CanvasOverlayScaleContextValue {
  return useContext(CanvasOverlayScaleContext)
}

interface CanvasOverlayScaleProviderProps {
  containerRef: RefObject<HTMLDivElement | null>
  children: React.ReactNode
}

/**
 * Provides overlay scale based on the measured size of the canvas compartment.
 * When the compartment's smaller dimension drops below CANVAS_OVERLAY_COMPACT_THRESHOLD,
 * overlays shrink to CANVAS_OVERLAY_COMPACT_SCALE.
 */
export function CanvasOverlayScaleProvider({
  containerRef,
  children,
}: CanvasOverlayScaleProviderProps) {
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    const update = () => {
      setSize({ width: el.offsetWidth, height: el.offsetHeight })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  const value = useMemo((): CanvasOverlayScaleContextValue => {
    const minDim = Math.min(size.width, size.height)
    // Before first real measurement (0×0), default to full scale
    if (minDim === 0) return defaultValue
    const isCompact = minDim < CANVAS_OVERLAY_COMPACT_THRESHOLD
    return {
      scale: isCompact ? CANVAS_OVERLAY_COMPACT_SCALE : CANVAS_OVERLAY_FULL_SCALE,
      isCompact,
      width: size.width,
      height: size.height,
      minDimension: minDim,
    }
  }, [size.width, size.height])

  return (
    <CanvasOverlayScaleContext.Provider value={value}>
      {children}
    </CanvasOverlayScaleContext.Provider>
  )
}
