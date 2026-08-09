import { Text } from 'react-konva'
import { useSettingsStore } from '@/stores/settingsStore'
import { useCanvasFontFamily } from '@/editions/community/communityHooks'
import { getTextColor } from './canvasSymbols'
import {
  PROTECTION_LABEL_DEFAULT_BOX_WIDTH,
  estimateProtectionNameLabelWidth,
} from '@/lib/layout/bottomUpLayout'

interface CircuitLabelProps {
  x: number
  y: number
  label: string
  /**
   * Alignment semantics:
   * - 'left': x is left edge of box
   * - 'center': x is box center
   * - 'right': x is right edge of box
   */
  align?: 'left' | 'center' | 'right'
}

export function CircuitLabel({ x, y, label, align = 'center' }: CircuitLabelProps) {
  const theme = useSettingsStore((state) => state.theme)
  const fontFamily = useCanvasFontFamily()
  const isDark = theme.mode === 'dark'
  const textColor = getTextColor(isDark)

  const isLeft = align === 'left'
  const isRight = align === 'right'

  const measuredWidth = estimateProtectionNameLabelWidth(label)
  const boxWidth = Math.max(
    isLeft || isRight ? PROTECTION_LABEL_DEFAULT_BOX_WIDTH : 24,
    measuredWidth
  )
  const boxX = isLeft ? x : isRight ? x - boxWidth : x - boxWidth / 2
  return (
    <Text
      x={boxX}
      y={y - 7}
      width={boxWidth}
      text={label}
      fontSize={11}
      fontFamily={fontFamily}
      fill={textColor}
      align={isLeft ? 'left' : isRight ? 'right' : 'center'}
      listening={false}
    />
  )
}
