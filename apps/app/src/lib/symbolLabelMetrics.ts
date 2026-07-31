export interface SymbolLabelVerticalMetrics {
  visualLineCounts: number[]
  lineOffsets: number[]
  totalHeight: number
}

export function countSymbolLabelVisualLines(text: string): number {
  return Math.max(1, text.split(/\r\n?|\n/).length)
}

export function getSymbolLabelVerticalMetrics(
  lines: string[],
  lineHeight: number
): SymbolLabelVerticalMetrics {
  const visualLineCounts = lines.map(countSymbolLabelVisualLines)
  const lineOffsets: number[] = []
  let totalHeight = 0

  for (const visualLineCount of visualLineCounts) {
    lineOffsets.push(totalHeight)
    totalHeight += visualLineCount * lineHeight
  }

  return { visualLineCounts, lineOffsets, totalHeight }
}
