import { Rect } from 'react-konva'
import { useSettingsStore } from '@/stores/settingsStore'
import { getBusColor } from './canvasSymbols'

interface MainBusProps {
  x: number
  y: number
  width: number
  height?: number // Optional height, defaults to 4 for main bus
}

export function MainBus({ x, y, width, height }: MainBusProps) {
  const theme = useSettingsStore((state) => state.theme)
  const isDark = theme.mode === 'dark'
  const busColor = getBusColor(isDark)
  
  // Default height is 4 for main bus, or use provided height
  const busHeight = height ?? 4
  
  // Minimum width is enforced at the layout level (LAYOUT_CONSTANTS.MIN_MAIN_BUS_WIDTH)
  return (
    <Rect
      x={x}
      y={y} // Center the bus bar vertically
      width={width}
      height={busHeight}
      fill={busColor}
      listening={false}
    />
  )
}
