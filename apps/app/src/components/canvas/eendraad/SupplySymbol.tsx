import { useState, useEffect, useCallback } from 'react'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { Group, Image, Rect, Text } from 'react-konva'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  useCanvasFontFamily,
  useEffectiveCanvasZoom,
  useIsTypeAndIdSelected,
  useSetSelection,
} from '@/editions/community/communityHooks'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { getSymbolById } from '@/lib/symbols'
import { loadProcessedSymbol } from '@/lib/symbolImage'
import { getVoltageSummaryLabel } from '@/utils/voltageLabel'
import { SYMBOL_SIZE, getSymbolColor, getTextColor, GROUND_OUTLINE_SIZE, getSelectionOutlineProps, getHoverOutlineProps, getTouchAwareHitAreaProps } from './canvasSymbols'
import { useTouchPrimaryDevice } from '@/editions/community/communityHooks'
import { getElectricalInstallationFromProject } from '@/lib/projectV2/electrical'

type EendraadPointerEvent = {
  cancelBubble: boolean
  evt: { button?: number; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
}
type WindowWithEendraTapSuppression = Window & { __eendraSuppressNextElementTap?: boolean }

interface SupplySymbolProps {
  x: number
  y: number
}

export function SupplySymbol({ x, y }: SupplySymbolProps) {
  const { theme } = useSettingsStore()
  const fontFamily = useCanvasFontFamily()
  type ProjectStoreState = ReturnType<typeof useProjectStore.getState>
  const installation = useProjectStore((s: ProjectStoreState) =>
    s.currentProject ? getElectricalInstallationFromProject(s.currentProject) : undefined
  )
  const setSelection = useSetSelection()
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const touchPrimary = useTouchPrimaryDevice()
  const [processedImage, setProcessedImage] = useState<HTMLImageElement | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const isDark = theme?.mode === 'dark'
  const symbolColor = getSymbolColor(isDark)
  const textColor = getTextColor(isDark)
  const isSelected = useIsTypeAndIdSelected('supply', 'supply')

  const symbol = getSymbolById('mains')
  const voltageLabel = installation?.nominalVoltage
    ? getVoltageSummaryLabel(installation.nominalVoltage)
    : ''
  
  // Phase indicator for supply/sitplan symbol: 1, 2, or 3
  const system = installation?.nominalVoltage?.system
  const phaseIndicator =
    system === '1~' || system === '1N~' ? '1' : system === '2~' ? '2' : '3'
  
  const handleClick = useCallback((event: unknown) => {
    const e = event as EendraadPointerEvent
    const eendraWindow = window as WindowWithEendraTapSuppression
    if (eendraWindow.__eendraSuppressNextElementTap) {
      eendraWindow.__eendraSuppressNextElementTap = false
      return
    }
    e.cancelBubble = true
    
    if (e.evt.button != null && e.evt.button !== 0) {
      return
    }
    
    if (e.evt.shiftKey) {
      // Shift + Click: Add to selection
      const { selection } = useUIStore.getState()
      if (selection.type === 'supply' && !selection.ids.includes('supply')) {
        setSelection({ type: 'supply', ids: [...selection.ids, 'supply'] })
      } else if (selection.type !== 'supply') {
        setSelection({ type: 'supply', ids: ['supply'] })
      }
    } else if (e.evt.altKey || e.evt.ctrlKey || e.evt.metaKey) {
      // Alt/Ctrl + Click: Remove from selection
      const { selection } = useUIStore.getState()
      if (selection.type === 'supply' && selection.ids.includes('supply')) {
        useUIStore.getState().clearSelection()
      }
    } else {
      // Normal click: Replace selection
      setSelection({ type: 'supply', ids: ['supply'] })
    }
  }, [setSelection])

  useEffect(() => {
    if (!symbol) return
    loadProcessedSymbol(symbol.svgPath, isDark).then(setProcessedImage).catch(() => setProcessedImage(null))
  }, [symbol, isDark])

  const displayImage = processedImage

  // Same placement as TrunkDeviceSymbol (vertical): offsetY = SYMBOL_SIZE/4 so symbol sits on wire
  const offsetY = SYMBOL_SIZE / 2

  return (
    <Group 
      name="supply-supply" 
      x={x} 
      y={y}
      onClick={handleClick}
      onTap={handleClick}
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
      
      {displayImage ? (
        <Image
          image={displayImage}
          width={SYMBOL_SIZE}
          height={SYMBOL_SIZE}
          offsetX={SYMBOL_SIZE / 2}
          offsetY={offsetY}
          listening={false}
        />
      ) : (
        <Rect
          x={-SYMBOL_SIZE / 2}
          y={-offsetY}
          width={SYMBOL_SIZE}
          height={SYMBOL_SIZE}
          fill="transparent"
          stroke={symbolColor}
          strokeWidth={2}
          listening={false}
        />
      )}
      
      {/* Phase indicator (1 or 3) - top left corner */}
      <Text
        x={-SYMBOL_SIZE / 2 }
        y={-offsetY -4}
        text={phaseIndicator}
        fontSize={10}
        fontFamily={fontFamily}
        fontStyle="bold"
        fill={textColor}
        listening={false}
      />
      
      {voltageLabel && (
        <Text
          x={SYMBOL_SIZE / 2 + 6}
          y={-4}
          text={voltageLabel}
          fontSize={12}
          fontFamily={fontFamily}
          fill={textColor}
          listening={false}
        />
      )}
      
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
