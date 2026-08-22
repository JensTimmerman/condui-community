import type { WireSegment } from '@/types/schema'
import { getLeftBiasedBusFeedStubX } from '@/lib/panel/panelBusFeedPreview'

export interface BusFeedMarkerPoint {
  x: number
  y: number
}

export interface BusFeedMarkerBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Shared anchor used by the renderer and layout debug bounds. */
export function getBusFeedMarkerPosition(wireSegment: WireSegment): BusFeedMarkerPoint {
  const stubX = getLeftBiasedBusFeedStubX(wireSegment.startPoint.x, wireSegment.endPoint.x)
  const distance = Math.max(0, wireSegment.endPoint.x - wireSegment.startPoint.x)
  switch (wireSegment.busFeedMarkerSide) {
    case 'left':
      return { x: wireSegment.startPoint.x - 24, y: wireSegment.startPoint.y - 10 }
    case 'right':
      return { x: wireSegment.endPoint.x + 4, y: wireSegment.startPoint.y - 10 }
    case 'below-left':
      return { x: stubX - distance, y: wireSegment.startPoint.y + 20 }
    case 'below-right':
      return { x: stubX + distance, y: wireSegment.startPoint.y + 20 }
    case 'stub-center':
      return { x: wireSegment.startPoint.x, y: wireSegment.endPoint.y + 11 }
    case 'below':
      return {
        x: (wireSegment.startPoint.x + wireSegment.endPoint.x) / 2 - 10,
        y: wireSegment.startPoint.y + 10,
      }
    default:
      return { x: wireSegment.endPoint.x, y: wireSegment.endPoint.y + 11 }
  }
}

/** Painted line + marker/label bounds for one actual generated feed stub or rail. */
export function getBusFeedMarkerPaintBounds(wireSegment: WireSegment): BusFeedMarkerBounds {
  const linePad = wireSegment.type === 'mainBus' ? 3 : 1
  let left = Math.min(wireSegment.startPoint.x, wireSegment.endPoint.x) - linePad
  let right = Math.max(wireSegment.startPoint.x, wireSegment.endPoint.x) + linePad
  let top = Math.min(wireSegment.startPoint.y, wireSegment.endPoint.y) - linePad
  let bottom = Math.max(wireSegment.startPoint.y, wireSegment.endPoint.y) + linePad

  if (wireSegment.showBusFeedMarker && wireSegment.busFeedKind) {
    const marker = getBusFeedMarkerPosition(wireSegment)
    // The symbol is 20×20 centered on the anchor. Its centered 60 px label
    // starts at y=14 and uses a 7 px font.
    left = Math.min(left, marker.x - 30)
    right = Math.max(right, marker.x + 30)
    top = Math.min(top, marker.y - 10)
    bottom = Math.max(bottom, marker.y + 23)
  }
  if (wireSegment.phaseLabelAnchor) {
    left = Math.min(left, wireSegment.phaseLabelAnchor.x)
    right = Math.max(right, wireSegment.phaseLabelAnchor.x + 48)
    top = Math.min(top, wireSegment.phaseLabelAnchor.y)
    bottom = Math.max(bottom, wireSegment.phaseLabelAnchor.y + 10)
  }

  return { x: left, y: top, width: right - left, height: bottom - top }
}
