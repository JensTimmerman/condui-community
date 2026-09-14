import { Group, Rect, Text } from 'react-konva'
import type { SymbolLabelDisplayConfig } from '@/types/schema'
import { getSymbolLabelLayout, getSymbolLabelPosition } from '@/lib/symbolLabels'
import {
  getCollisionSafeCenteredLabelLeftX,
  getCollisionSafeLabelWidth,
} from '@/lib/eendraad/endpointNoteLabelCollision'
import {
  countSymbolLabelVisualLines,
  getSymbolLabelVerticalMetrics,
} from '@/lib/symbolLabelMetrics'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'

export interface SymbolTextLabelItem {
  key: string
  text: string
  /** Draw a thin inset stroked box around this label segment on the one-wire. */
  frame?: boolean
}

interface SymbolTextLabelsProps {
  items: SymbolTextLabelItem[]
  lines?: string[]
  /** Per-line frame flags; must match `lines` length when provided. */
  lineFrames?: boolean[]
  /**
   * Vertical anchor line (0-based, fractional allowed). That line's center sits on the symbol center (y=0).
   * Used for protection labels (e.g. center on breaking-capacity line when three lines are shown).
   */
  anchorLineIndex?: number
  config?: SymbolLabelDisplayConfig
  textColor: string
  fontFamily: string
  fontSize?: number
  symbolSize?: number
  symbolWidth?: number
  symbolHeight?: number
  offsetFromSymbol?: number
  /** Collision-solver adjustment applied after the normal anchored position. */
  positionOffset?: { x: number; y: number }
  lineSpacing?: number
  sequenceJoiner?: string
  /**
   * Side labels (left/right): `auto` top-aligns tall blocks with the symbol top; `center` keeps the
   * block vertically centered on the symbol (y=0).
   */
  sideLabelBlockAlign?: 'auto' | 'center'
  /** Minimum left edge for bottom-positioned lines; wider lines shift right to respect it. */
  bottomMinimumLeftX?: number
  /** Maximum right edge for bottom-positioned lines; crowded text uses an ellipsis. */
  bottomMaximumRightX?: number
  /** When set, this label block is pointer-interactive and selects the owning symbol (same as clicking the symbol). */
  onLabelClick?: (e: unknown) => void
}

export function SymbolTextLabels({
  items,
  lines,
  lineFrames,
  anchorLineIndex,
  config,
  textColor,
  fontFamily,
  fontSize = 10,
  symbolSize = 20,
  symbolWidth,
  symbolHeight,
  offsetFromSymbol = 5,
  positionOffset,
  lineSpacing = 2,
  sequenceJoiner = ' ',
  sideLabelBlockAlign = 'auto',
  bottomMinimumLeftX,
  bottomMaximumRightX,
  onLabelClick,
}: SymbolTextLabelsProps) {
  if (items.length === 0 && (!lines || lines.length === 0)) return null

  const position = getSymbolLabelPosition(config)
  const layout = getSymbolLabelLayout(config)
  const lineHeight = fontSize + lineSpacing
  const resolvedSymbolWidth = symbolWidth ?? symbolSize
  const resolvedSymbolHeight = symbolHeight ?? symbolSize
  const halfSymbolWidth = resolvedSymbolWidth / 2
  const halfSymbolHeight = resolvedSymbolHeight / 2

  const resolvedLines =
    lines && lines.length > 0
      ? lines
      : layout === 'sequence'
        ? [items.map((item) => item.text).join(sequenceJoiner)]
        : items.map((item) => item.text)

  const resolvedLineFrames =
    lineFrames ??
    (lines && lines.length > 0
      ? undefined
      : layout === 'stack'
        ? items.map((item) => item.frame ?? false)
        : undefined)

  const verticalMetrics = getSymbolLabelVerticalMetrics(resolvedLines, lineHeight)
  const contentHeight = verticalMetrics.totalHeight
  const centeredBlockTop = -contentHeight / 2
  const topAlignedBlockTop = -halfSymbolHeight
  // Anchor to symbol center only for side labels; bottom/top stay fully below/above, top-aligned.
  const useSideAnchor = anchorLineIndex != null && (position === 'left' || position === 'right')
  const anchorBlockTop = useSideAnchor ? -anchorLineIndex * lineHeight - fontSize / 2 : null
  const blockTop =
    anchorBlockTop ??
    (position === 'left' || position === 'right'
      ? sideLabelBlockAlign === 'center' || contentHeight <= resolvedSymbolHeight
        ? centeredBlockTop
        : topAlignedBlockTop
      : centeredBlockTop)
  const lineWidths = resolvedLines.map((line) =>
    measureSymbolLabelTextWidth(line, fontFamily, fontSize)
  )
  const centeredLineLeftXs = lineWidths.map((lineWidth) =>
    getCollisionSafeCenteredLabelLeftX(
      lineWidth,
      position === 'bottom' ? bottomMinimumLeftX : undefined
    )
  )
  const renderedLineWidths = lineWidths.map((lineWidth, index) =>
    getCollisionSafeLabelWidth(
      lineWidth,
      centeredLineLeftXs[index] ?? 0,
      position === 'bottom' ? bottomMaximumRightX : undefined
    )
  )
  const maxLineWidth = Math.max(0, ...lineWidths)
  const labelLeftX = Math.min(0, ...centeredLineLeftXs)
  const labelRightX = Math.max(
    0,
    ...centeredLineLeftXs.map((leftX, index) => leftX + (renderedLineWidths[index] ?? 0))
  )
  const labelHitPad = 4

  if (position === 'right' || position === 'left') {
    const x =
      position === 'right'
        ? halfSymbolWidth + offsetFromSymbol
        : -(halfSymbolWidth + offsetFromSymbol)
    const hitX = position === 'right' ? -labelHitPad : -(maxLineWidth + labelHitPad)
    return (
      <Group
        x={x + (positionOffset?.x ?? 0)}
        y={positionOffset?.y ?? 0}
        listening={!!onLabelClick}
        onClick={onLabelClick}
        onTap={onLabelClick}
      >
        {onLabelClick && (
          <Rect
            x={hitX}
            y={blockTop - labelHitPad}
            width={maxLineWidth + labelHitPad * 2}
            height={contentHeight + labelHitPad * 2}
            fill="transparent"
          />
        )}
        {resolvedLines.map((line, index) => (
          <LabelLine
            key={`${position}-${layout}-${index}`}
            x={position === 'right' ? 0 : -(lineWidths[index] ?? 0)}
            y={blockTop + (verticalMetrics.lineOffsets[index] ?? 0)}
            text={line}
            fontSize={fontSize}
            fontFamily={fontFamily}
            textColor={textColor}
            frame={resolvedLineFrames?.[index] ?? false}
            lineSpacing={lineSpacing}
          />
        ))}
      </Group>
    )
  }

  const y =
    position === 'top'
      ? -(halfSymbolHeight + offsetFromSymbol + contentHeight)
      : halfSymbolHeight + offsetFromSymbol
  const lineBaseY = 0
  return (
    <Group
      x={positionOffset?.x ?? 0}
      y={y + (positionOffset?.y ?? 0)}
      listening={!!onLabelClick}
      onClick={onLabelClick}
      onTap={onLabelClick}
    >
      {onLabelClick && (
        <Rect
          x={labelLeftX - labelHitPad}
          y={lineBaseY - labelHitPad}
          width={labelRightX - labelLeftX + labelHitPad * 2}
          height={contentHeight + labelHitPad * 2}
          fill="transparent"
        />
      )}
      {resolvedLines.map((line, index) => (
        <LabelLine
          key={`${position}-${layout}-${index}`}
          x={centeredLineLeftXs[index] ?? 0}
          y={lineBaseY + (verticalMetrics.lineOffsets[index] ?? 0)}
          text={line}
          fontSize={fontSize}
          fontFamily={fontFamily}
          textColor={textColor}
          frame={resolvedLineFrames?.[index] ?? false}
          lineSpacing={lineSpacing}
          centerMultiline
          maximumWidth={
            (renderedLineWidths[index] ?? 0) < (lineWidths[index] ?? 0)
              ? renderedLineWidths[index]
              : undefined
          }
        />
      ))}
    </Group>
  )
}

/** Gap between label text and frame (horizontal vs vertical). */
const LABEL_FRAME_PAD_X = 1.5
const LABEL_FRAME_PAD_Y = 1
const LABEL_FRAME_STROKE = 0.5
/** Rect sits on the Konva Text top anchor; PDF-specific alignment is handled during SVG export. */
const LABEL_FRAME_Y_NUDGE = 0

function LabelLine({
  x,
  y,
  text,
  fontSize,
  fontFamily,
  textColor,
  frame,
  lineSpacing,
  centerMultiline = false,
  maximumWidth,
}: {
  x: number
  y: number
  text: string
  fontSize: number
  fontFamily: string
  textColor: string
  frame: boolean
  lineSpacing: number
  centerMultiline?: boolean
  maximumWidth?: number
}) {
  const textWidth = measureSymbolLabelTextWidth(text, fontFamily, fontSize)
  const renderedTextWidth = maximumWidth ?? textWidth
  const isMultiline = text.includes('\n')
  const visualLineCount = countSymbolLabelVisualLines(text)
  const textHeight = visualLineCount * (fontSize + lineSpacing) - lineSpacing
  const strokeInset = LABEL_FRAME_STROKE / 2
  return (
    <>
      {frame && (
        <Rect
          x={x - LABEL_FRAME_PAD_X + strokeInset}
          y={y - LABEL_FRAME_PAD_Y + strokeInset + LABEL_FRAME_Y_NUDGE}
          width={renderedTextWidth + LABEL_FRAME_PAD_X * 2 - LABEL_FRAME_STROKE}
          height={textHeight + LABEL_FRAME_PAD_Y * 2 - LABEL_FRAME_STROKE}
          stroke={textColor}
          strokeWidth={LABEL_FRAME_STROKE}
          listening={false}
        />
      )}
      <Text
        x={x}
        y={y}
        text={text}
        width={maximumWidth ?? (centerMultiline && isMultiline ? textWidth : undefined)}
        wrap={maximumWidth == null ? undefined : 'none'}
        ellipsis={maximumWidth != null}
        lineHeight={isMultiline ? (fontSize + lineSpacing) / fontSize : undefined}
        fontSize={fontSize}
        fontFamily={fontFamily}
        fill={textColor}
        align={centerMultiline && isMultiline ? 'center' : 'left'}
        listening={false}
      />
    </>
  )
}
