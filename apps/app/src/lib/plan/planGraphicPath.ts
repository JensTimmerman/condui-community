import { SVGPathData, SVGPathDataTransformer } from 'svg-pathdata'

/**
 * Fit SVG path coordinates to a graphic element without applying a Konva
 * scale transform. Keeping the path in element space lets Konva paint its
 * stroke at the same width in both axes, even when the element is squashed.
 */
export function scalePlanGraphicPath(
  data: string,
  viewBoxWidth: number,
  viewBoxHeight: number,
  width: number,
  height: number
): string {
  if (viewBoxWidth <= 0 || viewBoxHeight <= 0 || width <= 0 || height <= 0) return data

  return new SVGPathData(data)
    .transform(
      SVGPathDataTransformer.SCALE(width / viewBoxWidth, height / viewBoxHeight)
    )
    .encode()
}

/** Fit a path inside the element using one scale factor for both axes. */
export function scalePlanGraphicPathUniformly(
  data: string,
  viewBoxWidth: number,
  viewBoxHeight: number,
  width: number,
  height: number
): string {
  const size = Math.min(width, height)
  return scalePlanGraphicPath(data, viewBoxWidth, viewBoxHeight, size, size)
}
