import { useState } from 'react'
import { Group, Rect, Text } from 'react-konva'
import { useCanvasPanOrClickGesture } from './CanvasPanOrClickGesture'

const FONT_SIZE = 8
function getMultiplierBadgeTextWidth(text: string): number {
  return Math.max(9, Math.ceil(text.length * FONT_SIZE * 0.58))
}

interface MultiplierBadgeProps {
  count: number
  x: number
  y: number
  fill: string
  fontFamily?: string
  onActivate: () => void
}

export function MultiplierBadge({
  count,
  x,
  y,
  fill,
  fontFamily,
  onActivate,
}: MultiplierBadgeProps) {
  const [hovered, setHovered] = useState(false)
  const text = `${count}x`
  const width = getMultiplierBadgeTextWidth(text)
  const height = FONT_SIZE + 2
  const gestureHandlers = useCanvasPanOrClickGesture(() => onActivate())

  return (
    <Group
      x={x}
      y={y}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...gestureHandlers}
    >
      <Rect
        x={-1}
        y={-1}
        width={width + 2}
        height={height + 2}
        fill="rgba(0,0,0,0.001)"
        stroke={hovered ? fill : undefined}
        strokeWidth={hovered ? 0.75 : 0}
        dash={[2, 2]}
        cornerRadius={1.5}
      />
      <Text
        text={text}
        width={width}
        height={height}
        fontSize={FONT_SIZE}
        fontStyle="bold"
        fontFamily={fontFamily}
        fill={fill}
        listening={false}
      />
    </Group>
  )
}
