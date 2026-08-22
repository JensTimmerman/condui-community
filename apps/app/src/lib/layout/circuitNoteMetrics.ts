import { clamp } from '@/lib/geometry'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'

export const CIRCUIT_NOTES_FONT_SIZE = 10
export const CIRCUIT_NOTES_LINE_HEIGHT = 14
/** Optical nudge applied by the rotated Konva note block. */
export const CIRCUIT_NOTES_VERTICAL_X_NUDGE = CIRCUIT_NOTES_LINE_HEIGHT / 4
/**
 * Extra painted-ink allowance around the nominal Konva text rectangle.
 * Italic glyphs can overhang their advance box; rotation moves that overhang
 * from the horizontal edge to the top/bottom edge.
 */
export const CIRCUIT_NOTES_PAINT_PADDING = 8
export const CIRCUIT_NOTES_MIN_WIDTH = 60
export const CIRCUIT_NOTES_MAX_WIDTH = 200
export const CIRCUIT_NOTES_DEFAULT_FONT_FAMILY = 'Figtree'

/** Preserve authored line breaks without letting invisible indentation skew centering. */
export function normalizeCircuitNotesText(label: string | undefined | null): string {
  return (label ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join('\n')
    .trim()
}

function getExplicitLines(label: string | undefined | null): string[] {
  const lines = normalizeCircuitNotesText(label).split('\n')
  return lines.length > 0 ? lines : ['']
}

export function measureCircuitNotesLineWidth(
  text: string,
  fontFamily = CIRCUIT_NOTES_DEFAULT_FONT_FAMILY,
  fontSize = CIRCUIT_NOTES_FONT_SIZE
): number {
  return measureSymbolLabelTextWidth(text || ' ', fontFamily, fontSize, 'italic')
}

/** Width of the longest explicit line, capped to the renderer's wrapping width. */
export function estimateCircuitNotesWidth(
  label: string | undefined | null,
  fontFamily = CIRCUIT_NOTES_DEFAULT_FONT_FAMILY,
  fontSize = CIRCUIT_NOTES_FONT_SIZE
): number {
  const longestLineWidth = Math.max(
    0,
    ...getExplicitLines(label).map((line) =>
      measureCircuitNotesLineWidth(line, fontFamily, fontSize)
    )
  )
  return clamp(longestLineWidth, CIRCUIT_NOTES_MIN_WIDTH, CIRCUIT_NOTES_MAX_WIDTH)
}

function splitCircuitNoteWord(
  word: string,
  maxWidth: number,
  fontFamily: string,
  fontSize: number
): string[] {
  const chunks: string[] = []
  let current = ''
  for (const character of word) {
    const candidate = current + character
    if (
      current &&
      measureCircuitNotesLineWidth(candidate, fontFamily, fontSize) > maxWidth
    ) {
      chunks.push(current)
      current = character
    } else {
      current = candidate
    }
  }
  if (current) chunks.push(current)
  return chunks.length > 0 ? chunks : ['']
}

/** Deterministic visual lines used by both measurement and Konva rendering. */
export function getCircuitNotesVisualLines(
  label: string | undefined | null,
  fontFamily = CIRCUIT_NOTES_DEFAULT_FONT_FAMILY,
  fontSize = CIRCUIT_NOTES_FONT_SIZE,
  maxWidth = estimateCircuitNotesWidth(label, fontFamily, fontSize)
): string[] {
  const paragraphs = getExplicitLines(label)
  const visualLines: string[] = []

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      visualLines.push('')
      continue
    }

    let currentLine = ''
    for (const word of words) {
      const wordWidth = measureCircuitNotesLineWidth(word, fontFamily, fontSize)
      const candidate = currentLine ? `${currentLine} ${word}` : word
      if (measureCircuitNotesLineWidth(candidate, fontFamily, fontSize) <= maxWidth) {
        currentLine = candidate
        continue
      }

      if (currentLine) {
        visualLines.push(currentLine)
        currentLine = ''
      }

      if (wordWidth <= maxWidth) {
        currentLine = word
      } else {
        const chunks = splitCircuitNoteWord(word, maxWidth, fontFamily, fontSize)
        visualLines.push(...chunks.slice(0, -1))
        currentLine = chunks.at(-1) ?? ''
      }
    }
    visualLines.push(currentLine)
  }

  return visualLines.length > 0 ? visualLines : ['']
}

export function estimateCircuitNotesWrappedLineCount(
  label: string | undefined | null,
  fontFamily = CIRCUIT_NOTES_DEFAULT_FONT_FAMILY,
  fontSize = CIRCUIT_NOTES_FONT_SIZE,
  maxWidth = estimateCircuitNotesWidth(label, fontFamily, fontSize)
): number {
  return getCircuitNotesVisualLines(label, fontFamily, fontSize, maxWidth).length
}

export function estimateCircuitNotesRenderedWidth(
  label: string | undefined | null,
  fontFamily = CIRCUIT_NOTES_DEFAULT_FONT_FAMILY,
  fontSize = CIRCUIT_NOTES_FONT_SIZE
): number {
  const wrappingWidth = estimateCircuitNotesWidth(label, fontFamily, fontSize)
  return Math.max(
    0,
    ...getCircuitNotesVisualLines(label, fontFamily, fontSize, wrappingWidth).map((line) =>
      measureCircuitNotesLineWidth(line, fontFamily, fontSize)
    )
  )
}

export function estimateCircuitNotesBlockHeight(
  label: string | undefined | null,
  fontFamily = CIRCUIT_NOTES_DEFAULT_FONT_FAMILY,
  fontSize = CIRCUIT_NOTES_FONT_SIZE,
  lineHeight = CIRCUIT_NOTES_LINE_HEIGHT
): number {
  const width = estimateCircuitNotesWidth(label, fontFamily, fontSize)
  return estimateCircuitNotesWrappedLineCount(label, fontFamily, fontSize, width) * lineHeight
}

export interface CircuitNotesPaintBounds {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** Painted note rectangle relative to the note anchor used by CircuitNotesLabel. */
export function getCircuitNotesPaintBounds(
  label: string | undefined | null,
  orientation: 'horizontal' | 'vertical',
  fontFamily = CIRCUIT_NOTES_DEFAULT_FONT_FAMILY,
  fontSize = CIRCUIT_NOTES_FONT_SIZE,
  lineHeight = CIRCUIT_NOTES_LINE_HEIGHT
): CircuitNotesPaintBounds {
  const textWidth = estimateCircuitNotesRenderedWidth(label, fontFamily, fontSize)
  const blockHeight = estimateCircuitNotesBlockHeight(
    label,
    fontFamily,
    fontSize,
    lineHeight
  )

  const left =
    orientation === 'vertical'
      ? CIRCUIT_NOTES_VERTICAL_X_NUDGE - blockHeight / 2 - CIRCUIT_NOTES_PAINT_PADDING
      : -textWidth / 2 - CIRCUIT_NOTES_PAINT_PADDING
  const right =
    orientation === 'vertical'
      ? CIRCUIT_NOTES_VERTICAL_X_NUDGE + blockHeight / 2 + CIRCUIT_NOTES_PAINT_PADDING
      : textWidth / 2 + CIRCUIT_NOTES_PAINT_PADDING
  const top =
    orientation === 'vertical'
      ? -textWidth - CIRCUIT_NOTES_PAINT_PADDING
      : -blockHeight + lineHeight / 2 - CIRCUIT_NOTES_PAINT_PADDING
  const bottom =
    orientation === 'vertical'
      ? CIRCUIT_NOTES_PAINT_PADDING
      : lineHeight / 2 + CIRCUIT_NOTES_PAINT_PADDING

  return { left, top, right, bottom, width: right - left, height: bottom - top }
}
