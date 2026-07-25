/** Fit plan-import preview image to the available viewport (matches crop + scale steps). */
export function computePlanImportFitScale(
  imageSize: { width: number; height: number },
  containerWidth: number,
  containerHeight: number,
  padding = 32,
): number | null {
  const availableWidth = containerWidth - padding
  const availableHeight = containerHeight - padding
  if (availableWidth <= 0 || availableHeight <= 0) return null

  const imgAspect = imageSize.width / imageSize.height
  const containerAspect = availableWidth / availableHeight

  let displayWidth: number
  if (imgAspect > containerAspect) {
    displayWidth = availableWidth
  } else {
    displayWidth = availableHeight * imgAspect
  }

  const scale = displayWidth / imageSize.width
  return scale > 0 && Number.isFinite(scale) ? scale : null
}
