import { useState, useEffect, useCallback } from 'react'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { Group, Image, Rect } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { getSymbolById } from '@/lib/symbols'
import { loadProcessedSymbol } from '@/lib/symbolImage'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { GROUND_OUTLINE_SIZE, SYMBOL_SIZE, getSelectionOutlineProps, getHoverOutlineProps, getTouchAwareHitAreaProps } from './canvasSymbols'
import { logger } from '@/lib/logger'
import {
  useEffectiveCanvasZoom,
  useIsTypeAndIdSelected,
  useSetSelection,
  useTouchPrimaryDevice,
} from '@/editions/community/communityHooks'

type GroundPointerEvent = KonvaEventObject<MouseEvent | TouchEvent>
type GroundDragEvent = KonvaEventObject<DragEvent>
type WindowWithEendraTapSuppression = Window & {
  __eendraSuppressNextElementTap?: boolean
}

interface GroundSymbolProps {
  x: number
  y: number
  onDragEnd?: (newPos: { x: number; y: number }) => void
  onDragMove?: (newPos: { x: number; y: number }) => void
}

export function GroundSymbol({ x, y, onDragEnd, onDragMove }: GroundSymbolProps) {
  const { theme } = useSettingsStore()
  const setSelection = useSetSelection()
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const touchPrimary = useTouchPrimaryDevice()
  const [processedImage, setProcessedImage] = useState<HTMLImageElement | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  
  const symbol = getSymbolById('earthing')
  const isDark = theme.mode === 'dark'
  const isSelected = useIsTypeAndIdSelected('ground', 'ground')
  
  // Load and process the SVG image
  useEffect(() => {
    if (!symbol) return
    loadProcessedSymbol(symbol.svgPath, isDark).then(setProcessedImage).catch(() => setProcessedImage(null))
  }, [symbol, symbol?.svgPath, isDark])
  
  const handleClick = useCallback((e: GroundPointerEvent) => {
    const appWindow = window as WindowWithEendraTapSuppression
    if (appWindow.__eendraSuppressNextElementTap) {
      appWindow.__eendraSuppressNextElementTap = false
      return
    }
    e.cancelBubble = true
    
    if ('button' in e.evt && e.evt.button != null && e.evt.button !== 0) {
      return
    }
    
    if ('shiftKey' in e.evt && e.evt.shiftKey) {
      // Shift + Click: Add to selection
      const { selection } = useUIStore.getState()
      if (selection.type === 'ground' && !selection.ids.includes('ground')) {
        setSelection({ type: 'ground', ids: [...selection.ids, 'ground'] })
      } else if (selection.type !== 'ground') {
        setSelection({ type: 'ground', ids: ['ground'] })
      }
    } else if (
      ('altKey' in e.evt && e.evt.altKey) ||
      ('ctrlKey' in e.evt && e.evt.ctrlKey) ||
      ('metaKey' in e.evt && e.evt.metaKey)
    ) {
      // Alt/Ctrl + Click: Remove from selection
      const { selection } = useUIStore.getState()
      if (selection.type === 'ground' && selection.ids.includes('ground')) {
        useUIStore.getState().clearSelection()
      }
    } else {
      // Normal click: Replace selection
      setSelection({ type: 'ground', ids: ['ground'] })
    }
  }, [setSelection])
  
  const handleDragMove = useCallback((e: GroundDragEvent) => {
    if (onDragMove) {
      // Get absolute position in canvas coordinates
      const absPos = e.target.getAbsolutePosition()
      onDragMove({ x: absPos.x, y: absPos.y })
    }
  }, [onDragMove])
  
  const handleDragEnd = useCallback((e: GroundDragEvent) => {
    logger.info('[GroundSymbol] handleDragEnd called in component')
    if (onDragEnd) {
      // Get absolute position in canvas coordinates
      const absPos = e.target.getAbsolutePosition()
      logger.info('[GroundSymbol] Calling onDragEnd with position:', absPos)
      onDragEnd({ x: absPos.x, y: absPos.y })
    } else {
      logger.warn('[GroundSymbol] onDragEnd callback not provided')
    }
  }, [onDragEnd])
  
  if (!processedImage) return null
  
  return (
    <Group 
      name="ground-ground" 
      x={x} 
      y={y} 
      draggable={Boolean(onDragMove || onDragEnd)}
      onClick={handleClick} 
      onTap={handleClick}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      listening={true}
    >
      {/* Invisible hit area - matches outline size for hover detection */}
      <Rect
        {...getTouchAwareHitAreaProps(
          GROUND_OUTLINE_SIZE,
          canvasZoom,
          isSelected,
          touchPrimary,
        )}
      />
      
      {/* Symbol image */}
      <Image
        image={processedImage}
        width={SYMBOL_SIZE}
        height={SYMBOL_SIZE}
        offsetX={SYMBOL_SIZE / 2}
        offsetY={SYMBOL_SIZE / 2}
        listening={false}
      />
      
      {/* Hover highlight (dashed outline on mouse hover) */}
      {isHovered && !isSelected && (
        <Rect {...getHoverOutlineProps(canvasZoom, GROUND_OUTLINE_SIZE)} />
      )}
      {/* Selection highlight */}
      {isSelected && (
        <Rect {...getSelectionOutlineProps(canvasZoom, GROUND_OUTLINE_SIZE)} />
      )}
    </Group>
  )
}
