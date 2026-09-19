import { Circle, Group, Rect } from 'react-konva'

interface ModularSocketModuleGraphicProps {
  width: number
  topBandHeight: number
  centerBandHeight: number
  socketCount: 1 | 2
  stroke: string
  faceFill: string
  holeFill: string
}

function SchukoFace({
  cx,
  cy,
  radius,
  stroke,
  faceFill,
  holeFill,
}: {
  cx: number
  cy: number
  radius: number
  stroke: string
  faceFill: string
  holeFill: string
}) {
  const pinOffset = radius * 0.42
  const pinRadius = Math.max(1.2, radius * 0.12)
  const earthRadius = Math.max(1.1, radius * 0.1)
  const clipWidth = radius * 0.42
  const clipHeight = Math.max(1.6, radius * 0.16)
  const clipGap = radius * 0.78 + clipHeight * 0.8

  return (
    <Group listening={false}>
      <Circle
        x={cx}
        y={cy}
        radius={radius}
        stroke={stroke}
        strokeWidth={Math.max(1.2, radius * 0.08)}
        fill={faceFill}
        perfectDrawEnabled={false}
        listening={false}
      />
      <Rect
        x={cx - clipWidth / 2}
        y={cy - clipGap - clipHeight / 2}
        width={clipWidth}
        height={clipHeight}
        cornerRadius={clipHeight / 2}
        fill={stroke}
        perfectDrawEnabled={false}
        listening={false}
      />
      <Rect
        x={cx - clipWidth / 2}
        y={cy + clipGap - clipHeight / 2}
        width={clipWidth}
        height={clipHeight}
        cornerRadius={clipHeight / 2}
        fill={stroke}
        perfectDrawEnabled={false}
        listening={false}
      />
      <Circle
        x={cx - pinOffset}
        y={cy}
        radius={pinRadius}
        fill={holeFill}
        perfectDrawEnabled={false}
        listening={false}
      />
      <Circle
        x={cx + pinOffset}
        y={cy}
        radius={pinRadius}
        fill={holeFill}
        perfectDrawEnabled={false}
        listening={false}
      />
      <Circle
        x={cx}
        y={cy + pinOffset * 0.95}
        radius={earthRadius}
        fill={holeFill}
        perfectDrawEnabled={false}
        listening={false}
      />
    </Group>
  )
}

/** DIN-module Euro/Schuko face used by panel-mounted modular sockets. */
export function ModularSocketModuleGraphic({
  width,
  topBandHeight,
  centerBandHeight,
  socketCount,
  stroke,
  faceFill,
  holeFill,
}: ModularSocketModuleGraphicProps) {
  const faces = socketCount === 2 ? 2 : 1
  const cellWidth = width / faces
  const radius = Math.max(6, Math.min(cellWidth * 0.36, centerBandHeight * 0.38))
  const cy = topBandHeight + centerBandHeight / 2

  return (
    <Group name="panel-modular-socket-graphic" listening={false}>
      {Array.from({ length: faces }, (_, index) => (
        <SchukoFace
          key={index}
          cx={cellWidth * index + cellWidth / 2}
          cy={cy}
          radius={radius}
          stroke={stroke}
          faceFill={faceFill}
          holeFill={holeFill}
        />
      ))}
    </Group>
  )
}
