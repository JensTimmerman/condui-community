const PANEL_BODY_STROKE_TO_HEIGHT_RATIO = 2 / 48
const PANEL_BODY_CORNER_TO_STROKE_RATIO = 0.4

export function getPlanPanelBodyGeometry(symbolHeight: number): {
  strokeWidth: number
  cornerRadius: number
} {
  const strokeWidth = symbolHeight * PANEL_BODY_STROKE_TO_HEIGHT_RATIO
  return {
    strokeWidth,
    cornerRadius: strokeWidth * PANEL_BODY_CORNER_TO_STROKE_RATIO,
  }
}
