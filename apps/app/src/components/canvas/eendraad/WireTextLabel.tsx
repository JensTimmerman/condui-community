import { Group, Text } from 'react-konva'
import type { Point2 } from '@/types/schema'
import {
  WIRE_LABEL_DISTANCE_FROM_WIRE,
  WIRE_LABEL_FONT_SIZE,
  computeVerticalWireLabelLayout,
  computeVerticalWireLabelStackLayout,
  computeHorizontalWireLabelStackLayout,
  measureTextWidth,
} from '@/lib/wireTextLabel'

export type WireLabelOrientation = 'vertical' | 'horizontal'
export type WireLabelAlignment = 'origin' | 'center' | 'bottom'

export interface WireTextLabelConfig {
  orientation?: WireLabelOrientation
  align?: WireLabelAlignment
  distanceFromWire?: number
  offsetAlongWire?: number
  /** For horizontal labels: anchor on the wire (typically above via distanceFromWire). */
  labelAnchor?: Point2
}

interface WireTextLabelProps {
  text: string
  fireClassText?: string
  wireLengthText?: string
  startPoint: Point2
  endPoint: Point2
  color: string
  fontFamily: string
  fontSize?: number
  config?: WireTextLabelConfig
  /** Extra hit target: same selection as clicking the wire segment. */
  onLabelClick?: (e: unknown) => void
  onLabelMouseEnter?: () => void
  onLabelMouseLeave?: () => void
}

function wireLabelInteractionProps(
  onLabelClick?: (e: unknown) => void,
  onLabelMouseEnter?: () => void,
  onLabelMouseLeave?: () => void,
) {
  const interactive = !!(onLabelClick || onLabelMouseEnter || onLabelMouseLeave)
  return {
    listening: interactive,
    onClick: onLabelClick,
    onTap: onLabelClick,
    onMouseEnter: onLabelMouseEnter,
    onMouseLeave: onLabelMouseLeave,
  }
}

export function WireTextLabel({
  text,
  fireClassText,
  wireLengthText,
  startPoint,
  endPoint,
  color,
  fontFamily,
  fontSize = WIRE_LABEL_FONT_SIZE,
  config,
  onLabelClick,
  onLabelMouseEnter,
  onLabelMouseLeave,
}: WireTextLabelProps) {
  const labelInteraction = wireLabelInteractionProps(
    onLabelClick,
    onLabelMouseEnter,
    onLabelMouseLeave,
  )
  const orientation = config?.orientation ?? 'vertical'
  const align = config?.align ?? 'origin'
  const distanceFromWire = config?.distanceFromWire ?? WIRE_LABEL_DISTANCE_FROM_WIRE
  const offsetAlongWire = config?.offsetAlongWire ?? 0
  const labelAnchor = config?.labelAnchor

  if (orientation === 'vertical' && startPoint.x !== endPoint.x) return null
  if (orientation === 'horizontal' && startPoint.y !== endPoint.y) return null

  if (orientation === 'vertical' && align === 'center' && (fireClassText || wireLengthText)) {
    const stackLayout = computeVerticalWireLabelStackLayout({
      mainText: text,
      fireClassText,
      wireLengthText,
      startPoint,
      endPoint,
      fontFamily,
      fontSize,
      align,
      distanceFromWire,
      offsetAlongWire,
    })
    if (!stackLayout?.main.renderedText) return null

    const renderLine = (
      line: { renderedText: string; textWidth: number; y: number },
      key: string,
    ) => (
      <Text
        key={key}
        x={-line.textWidth / 2}
        y={line.y}
        text={line.renderedText}
        fontSize={fontSize}
        fontFamily={fontFamily}
        fill={color}
        align="left"
        {...labelInteraction}
      />
    )

    return (
      <Group
        x={stackLayout.anchorX}
        y={stackLayout.anchorY}
        name="export-strip-label"
        {...labelInteraction}
      >
        <Group rotation={-90}>
          {renderLine(stackLayout.main, 'main')}
          {stackLayout.fireClass ? renderLine(stackLayout.fireClass, 'fire') : null}
          {stackLayout.wireLength ? renderLine(stackLayout.wireLength, 'length') : null}
        </Group>
      </Group>
    )
  }

  const verticalLayout =
    orientation === 'vertical'
      ? computeVerticalWireLabelLayout({
          text,
          startPoint,
          endPoint,
          fontFamily,
          fontSize,
          align,
          distanceFromWire,
          offsetAlongWire,
        })
      : null
  const maxY = Math.max(startPoint.y, endPoint.y)
  const minX = Math.min(startPoint.x, endPoint.x)
  const maxX = Math.max(startPoint.x, endPoint.x)
  const centerY = (startPoint.y + endPoint.y) / 2
  const centerX = (startPoint.x + endPoint.x) / 2
  const renderedText =
    orientation === 'vertical'
      ? (verticalLayout?.renderedText ?? '')
      : text

  const anchorYBase =
    orientation === 'horizontal'
      ? (labelAnchor?.y ?? startPoint.y)
      : align === 'center'
        ? centerY
        : align === 'bottom'
          ? maxY
          : startPoint.y
  const anchorY =
    orientation === 'horizontal'
      ? anchorYBase - distanceFromWire
      : anchorYBase + offsetAlongWire
  const anchorXBase =
    orientation === 'horizontal'
      ? (labelAnchor?.x ??
        (align === 'center'
          ? centerX
          : align === 'bottom'
            ? maxX
            : minX))
      : startPoint.x
  const anchorX =
    orientation === 'horizontal'
      ? anchorXBase + offsetAlongWire
      : startPoint.x + distanceFromWire

  if (orientation === 'vertical') {
    if (!verticalLayout?.renderedText) return null
    if (align === 'center') {
      return (
        <Group
          x={verticalLayout.anchorX}
          y={verticalLayout.anchorY}
          name="export-strip-label"
          {...labelInteraction}
        >
          <Text
            x={0}
            y={0}
            offsetX={verticalLayout.textWidth / 2}
            offsetY={fontSize / 2}
            text={verticalLayout.renderedText}
            rotation={-90}
            fontSize={fontSize}
            fontFamily={fontFamily}
            fill={color}
            align="left"
            {...labelInteraction}
          />
        </Group>
      )
    }
    return (
      <Group
        x={verticalLayout.anchorX}
        y={verticalLayout.anchorY}
        name="export-strip-label"
        {...labelInteraction}
      >
        <Text
          x={0}
          y={-verticalLayout.textHeight}
          text={verticalLayout.renderedText}
          rotation={-90}
          fontSize={fontSize}
          fontFamily={fontFamily}
          fill={color}
          align="left"
          {...labelInteraction}
        />
      </Group>
    )
  }

  const horizontalTextWidth = measureTextWidth(renderedText, fontFamily, fontSize)

  if (fireClassText || wireLengthText) {
    const stackLayout = computeHorizontalWireLabelStackLayout({
      mainText: renderedText,
      fireClassText,
      wireLengthText,
      fontFamily,
      fontSize,
    })
    if (!stackLayout) return null

    const renderHorizontalLine = (
      line: { renderedText: string; textWidth: number; y: number },
      key: string,
    ) => (
      <Text
        key={key}
        x={0}
        y={line.y}
        offsetX={line.textWidth / 2}
        text={line.renderedText}
        fontSize={fontSize}
        fontFamily={fontFamily}
        fill={color}
        align="left"
        {...labelInteraction}
      />
    )

    return (
      <Group
        x={anchorX}
        y={anchorY}
        name="export-strip-label"
        {...labelInteraction}
      >
        {stackLayout.wireLength ? renderHorizontalLine(stackLayout.wireLength, 'length') : null}
        {stackLayout.fireClass ? renderHorizontalLine(stackLayout.fireClass, 'fire') : null}
        {renderHorizontalLine(stackLayout.main, 'main')}
      </Group>
    )
  }

  return (
    <Group
      x={anchorX}
      y={anchorY}
      name="export-strip-label"
      {...labelInteraction}
    >
      <Text
        x={0}
        y={-fontSize / 2}
        offsetX={horizontalTextWidth / 2}
        text={renderedText}
        fontSize={fontSize}
        fontFamily={fontFamily}
        fill={color}
        align="left"
        {...labelInteraction}
      />
    </Group>
  )
}
