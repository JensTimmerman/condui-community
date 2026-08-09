export interface SpdPanelModuleLayoutInput {
  moduleWidth: number
  topBandHeight: number
  centerBandHeight: number
  bottomBandTop: number
  padding: number
  hasLabel: boolean
}

export function getSpdPanelModuleLayout(input: SpdPanelModuleLayoutInput) {
  const {
    moduleWidth,
    topBandHeight,
    centerBandHeight,
    bottomBandTop,
    padding,
    hasLabel,
  } = input
  const symbolSize = hasLabel
    ? Math.min(moduleWidth * 0.7, centerBandHeight * 0.9)
    : Math.min(moduleWidth * 0.7, topBandHeight * 1.35)
  const symbolY = hasLabel
    ? topBandHeight - symbolSize * 0.25
    : (topBandHeight - symbolSize) / 2
  const specsY = hasLabel
    ? topBandHeight + centerBandHeight * 0.48
    : topBandHeight + padding

  return {
    symbolSize,
    symbolX: moduleWidth / 2,
    symbolY,
    specsY,
    specsHeight: Math.max(1, bottomBandTop - padding - specsY),
  }
}
