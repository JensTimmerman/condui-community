import {
  Children,
  Fragment,
  isValidElement,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useCanvasOverlayScale } from '@/contexts/CanvasOverlayScaleContext'
import CanvasScaledOverlay from './CanvasScaledOverlay'

const FLOATING_CONTROL_BUTTON_SIZE_PX = 48
const FLOATING_CONTROL_GAP_PX = 8

interface CanvasFloatingControlRailProps {
  children: ReactNode
  side: 'left' | 'right'
  verticalAlign?: 'center' | 'top'
  offsetPx?: number
  topOffsetPx?: number
  /** Keep the first control clear of a higher-layer overlay without shortening the rail. */
  topOverlayInsetPx?: number
  /** Let an open side menu escape the rail's scrollport. */
  menuOpen?: boolean
  className?: string
  overlayClassName?: string
  zIndex?: number
  dataCanvasOverlayAnchor?: string
  dataCanvasOverlayPosition?: string
}

function flattenRailChildren(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) => {
    if (isValidElement(child) && child.type === Fragment) {
      return flattenRailChildren((child.props as { children?: ReactNode }).children)
    }
    return [child]
  })
}

export default function CanvasFloatingControlRail({
  children,
  side,
  verticalAlign = 'center',
  offsetPx = 16,
  topOffsetPx = 12,
  topOverlayInsetPx = 0,
  menuOpen = false,
  className = '',
  overlayClassName = '',
  zIndex = 10,
  dataCanvasOverlayAnchor,
  dataCanvasOverlayPosition,
}: CanvasFloatingControlRailProps) {
  const { height, scale } = useCanvasOverlayScale()
  const items = flattenRailChildren(children).filter(Boolean)
  const availableHeight =
    verticalAlign === 'center' ? height : Math.max(0, height - topOffsetPx)
  const scaledButtonSize = FLOATING_CONTROL_BUTTON_SIZE_PX * scale
  const scaledGap = FLOATING_CONTROL_GAP_PX * scale
  const singleColumnHeight =
    items.length * scaledButtonSize + Math.max(0, items.length - 1) * scaledGap
  const railOverflows =
    availableHeight > 0 && singleColumnHeight + topOverlayInsetPx > availableHeight
  const unscaledMaxHeight = availableHeight > 0 ? availableHeight / Math.max(scale, 0.01) : 0
  const unscaledOverflowTopInset = railOverflows
    ? topOverlayInsetPx / Math.max(scale, 0.01)
    : 0
  const centeredTopPx = Math.max(0, (availableHeight - singleColumnHeight) / 2)
  const pinBelowTopOverlay =
    verticalAlign === 'center' &&
    !railOverflows &&
    topOverlayInsetPx > 0 &&
    centeredTopPx < topOverlayInsetPx

  const sideStyle: CSSProperties = side === 'left' ? { left: offsetPx } : { right: offsetPx }
  const outerStyle: CSSProperties =
    verticalAlign === 'center'
      ? sideStyle
      : {
          ...sideStyle,
          top: topOffsetPx,
        }

  return (
    <div
      data-canvas-overlay-anchor={dataCanvasOverlayAnchor}
      data-canvas-overlay-position={dataCanvasOverlayPosition}
      className={`absolute pointer-events-none ${
        verticalAlign === 'center'
          ? `inset-y-0 flex ${pinBelowTopOverlay ? 'items-start' : 'items-center'}`
          : ''
      } ${className}`.trim()}
      style={{ ...outerStyle, zIndex }}
    >
      <CanvasScaledOverlay
        className={`grid touch-pan-y grid-cols-1 gap-2 ${menuOpen || !railOverflows ? 'overflow-visible' : 'overflow-y-auto overscroll-y-contain'} pointer-events-auto [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${overlayClassName}`.trim()}
        transformOrigin={
          verticalAlign === 'center' && !pinBelowTopOverlay
            ? side === 'left'
              ? 'left center'
              : 'right center'
            : side === 'left'
              ? 'top left'
              : 'top right'
        }
        style={{
          boxSizing: 'border-box',
          marginTop: pinBelowTopOverlay ? topOverlayInsetPx : undefined,
          maxHeight: unscaledMaxHeight > 0 ? `${unscaledMaxHeight}px` : undefined,
          paddingTop: unscaledOverflowTopInset || undefined,
          alignContent: verticalAlign === 'center' && !railOverflows ? 'center' : 'start',
          justifyItems: side === 'left' ? 'start' : 'end',
        }}
      >
        {items.map((item, index) => (
          <Fragment key={`rail-item-${index}`}>{item}</Fragment>
        ))}
      </CanvasScaledOverlay>
    </div>
  )
}
