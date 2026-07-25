import { useState, useEffect, useCallback } from 'react'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { Group, Image, Rect, Text, Line } from 'react-konva'
import { useUIStore } from '@/stores/uiStore'
import { useClearHover, useSetHover, useSetSelection } from '@/editions/community/communityHooks'
import { useSettingsStore } from '@/stores/settingsStore'
import { useCanvasFontFamily, useEffectiveCanvasZoom } from '@/editions/community/communityHooks'
import { getSymbolById } from '@/lib/symbols'
import { loadProcessedSymbol } from '@/lib/symbolImage'
import { logger } from '@/lib/logger'
import {
  PANEL_SYMBOL_WIDTH,
  PANEL_SYMBOL_HEIGHT,
  PANEL_OUTLINE_WIDTH,
  PANEL_OUTLINE_HEIGHT,
  PANEL_MAX_CIRCUIT_LINES,
  getEendraadPanelCircuitLineMetrics,
  getRectSelectionOutlineProps,
  getRectHoverOutlineProps,
  getRectHitAreaProps,
  getSymbolColor,
} from './canvasSymbols'
import type { Point } from '@/types/ui'
import type { SymbolLabelDisplayConfig } from '@/types/schema'

type EendraadPointerEvent = {
  cancelBubble: boolean
  evt: { button?: number; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
}
type WindowWithEendraTapSuppression = Window & { __eendraSuppressNextElementTap?: boolean }

interface PanelSymbolProps {
  position: Point
  panelName: string
  subPanelId?: string  // If set, symbol is selectable and links to this sub-panel
  circuitCount?: number  // Number of circuits in this sub-panel
  symbolLabelDisplay?: SymbolLabelDisplayConfig
  maxLabelWidth?: number
}

export function PanelSymbol({ position, panelName, subPanelId, circuitCount = 0, maxLabelWidth }: PanelSymbolProps) {
  const { theme } = useSettingsStore()
  const fontFamily = useCanvasFontFamily()
  const setSelection = useSetSelection()
  const setHover = useSetHover()
  const clearHover = useClearHover()
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const [processedImage, setProcessedImage] = useState<HTMLImageElement | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const isDark = theme?.mode === 'dark'
  const symbolColor = getSymbolColor(isDark)
  
  const symbol = getSymbolById('panel_distribution')
  
  // Configuration for circuit indicator lines (from canvasSymbols.ts)
  const lineCount = Math.min(circuitCount, PANEL_MAX_CIRCUIT_LINES)
  const circuitLineMetrics = getEendraadPanelCircuitLineMetrics()
  
  // Selection / hover state (global hover drives frame highlight on eendraad and sitplan)
  const isSelected = useUIStore(
    (s) => !!subPanelId && s.selection.type === 'panel' && s.selection.ids.includes(subPanelId),
  )
  const isHoveredFromBreadcrumb = useUIStore(
    (s) => !!subPanelId && s.hover.type === 'panel' && s.hover.ids.includes(subPanelId),
  )
  const isHoveredAny = isHovered || isHoveredFromBreadcrumb
  const isPanelNameVisible = true

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true)
    if (subPanelId) setHover({ type: 'panel', ids: [subPanelId] })
  }, [subPanelId, setHover])

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false)
    if (subPanelId) clearHover()
  }, [subPanelId, clearHover])
  
  useEffect(() => {
    if (!symbol) return
    const isDarkMode = theme?.mode === 'dark'
    loadProcessedSymbol(symbol.svgPath, isDarkMode).then(setProcessedImage).catch(() => {
      logger.error('Failed to load symbol:', symbol.svgPath)
      setProcessedImage(null)
    })
  }, [symbol, theme?.mode])
  
  const handleClick = useCallback((event: unknown) => {
    if (!subPanelId) return
    const e = event as EendraadPointerEvent
    const eendraWindow = window as WindowWithEendraTapSuppression
    if (eendraWindow.__eendraSuppressNextElementTap) {
      eendraWindow.__eendraSuppressNextElementTap = false
      return
    }
    e.cancelBubble = true
    
    if (e.evt.button != null && e.evt.button !== 0) return
    
    if (e.evt.shiftKey) {
      // Shift + Click: Add to selection
      const { selection } = useUIStore.getState()
      if (selection.type === 'panel' && !selection.ids.includes(subPanelId)) {
        setSelection({ type: 'panel', ids: [...selection.ids, subPanelId] })
      } else if (selection.type !== 'panel') {
        setSelection({ type: 'panel', ids: [subPanelId] })
      }
    } else if (e.evt.altKey || e.evt.ctrlKey || e.evt.metaKey) {
      // Alt/Ctrl + Click: Remove from selection
      const { selection } = useUIStore.getState()
      if (selection.type === 'panel' && selection.ids.includes(subPanelId)) {
        const newIds = selection.ids.filter((id) => id !== subPanelId)
        if (newIds.length === 0) {
          useUIStore.getState().clearSelection()
        } else {
          setSelection({ type: 'panel', ids: newIds })
        }
      }
    } else {
      // Normal click: Select this panel
      setSelection({ type: 'panel', ids: [subPanelId] })
    }
  }, [subPanelId, setSelection])
  
  const isInteractive = !!subPanelId
  
  // Position panel so it sits on the wire (offsetY positions the center)
  const offsetY = PANEL_SYMBOL_HEIGHT / 4
  
  return (
    <Group
      x={position.x}
      y={position.y}
      onClick={isInteractive ? handleClick : undefined}
      onTap={isInteractive ? handleClick : undefined}
      onMouseEnter={isInteractive ? handleMouseEnter : undefined}
      onMouseLeave={isInteractive ? handleMouseLeave : undefined}
    >
      {/* Invisible hit area for hover/click detection */}
      {isInteractive && (
        <Rect {...getRectHitAreaProps(PANEL_OUTLINE_WIDTH, PANEL_OUTLINE_HEIGHT, offsetY)} />
      )}
      
      {processedImage ? (
        <Image
          image={processedImage}
          width={PANEL_SYMBOL_WIDTH}
          height={PANEL_SYMBOL_HEIGHT}
          offsetX={PANEL_SYMBOL_WIDTH / 2}
          offsetY={offsetY}
          listening={false}
        />
      ) : (
        <Rect
          x={-PANEL_SYMBOL_WIDTH / 2}
          y={-offsetY}
          width={PANEL_SYMBOL_WIDTH}
          height={PANEL_SYMBOL_HEIGHT}
          fill="transparent"
          stroke={symbolColor}
          strokeWidth={2}
          listening={false}
        />
      )}
      
      {/* Hover highlight */}
      {isHoveredAny && !isSelected && (
        <Rect {...getRectHoverOutlineProps(canvasZoom, PANEL_OUTLINE_WIDTH, PANEL_OUTLINE_HEIGHT, offsetY)} />
      )}
      {/* Selection outline */}
      {isSelected && (
        <Rect {...getRectSelectionOutlineProps(canvasZoom, PANEL_OUTLINE_WIDTH, PANEL_OUTLINE_HEIGHT, offsetY)} />
      )}
      
      {/* Circuit indicator lines */}
      {lineCount > 0 && Array.from({ length: lineCount }).map((_, i) => {
        // Calculate X position for each line, spread equally across lineSpacing
        const xOffset = lineCount === 1 
          ? 0 
          : (i / (lineCount - 1) - 0.5) * circuitLineMetrics.lineSpacing
        
        return (
          <Line
            key={`circuit-line-${i}`}
            points={[
              xOffset,
              circuitLineMetrics.lineStartY,
              xOffset,
              circuitLineMetrics.lineEndY,
            ]}
            stroke={symbolColor}
            strokeWidth={circuitLineMetrics.strokeWidth}
            listening={false}
          />
        )
      })}
      
      {panelName && isPanelNameVisible && (
        <Text
          x={PANEL_SYMBOL_WIDTH / 2 + 5}
          y={-3}
          width={maxLabelWidth}
          text={panelName}
          fontSize={11}
          lineHeight={1.1}
          wrap={maxLabelWidth != null ? 'char' : 'none'}
          fontFamily={fontFamily}
          fill={symbolColor}
          listening={false}
        />
      )}
    </Group>
  )
}
