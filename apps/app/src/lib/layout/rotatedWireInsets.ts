import { getWireInsets, type WireInsets, type WireInsetSymbolProps } from './wireInsets'

/** Rotate upright symbol insets into the same canvas orientation as its artwork. */
export function rotateWireInsets(insets: WireInsets, rotationDeg = 0): WireInsets {
  const quarterTurns = ((Math.round(rotationDeg / 90) % 4) + 4) % 4

  switch (quarterTurns) {
    case 1:
      return {
        top: insets.left,
        right: insets.top,
        bottom: insets.right,
        left: insets.bottom,
      }
    case 2:
      return {
        top: insets.bottom,
        right: insets.left,
        bottom: insets.top,
        left: insets.right,
      }
    case 3:
      return {
        top: insets.right,
        right: insets.bottom,
        bottom: insets.left,
        left: insets.top,
      }
    default:
      return insets
  }
}

/** Apply the inset table after accounting for rendered symbol rotation. */
export function applyRotatedWireInset(
  point: { x: number; y: number },
  otherEnd: { x: number; y: number },
  nodeType: string,
  symbolId?: string,
  rotationDeg = 0,
  options?: WireInsetSymbolProps
): { x: number; y: number } {
  if (symbolId === 'domotica') return point

  const insets = rotateWireInsets(getWireInsets(nodeType, symbolId, options), rotationDeg)
  const dx = otherEnd.x - point.x
  const dy = otherEnd.y - point.y
  let { x, y } = point

  if (Math.abs(dy) >= Math.abs(dx)) {
    if (dy > 0) y += insets.bottom
    else if (dy < 0) y -= insets.top
  } else {
    if (dx > 0) x += insets.right
    else if (dx < 0) x -= insets.left
  }

  return { x, y }
}
