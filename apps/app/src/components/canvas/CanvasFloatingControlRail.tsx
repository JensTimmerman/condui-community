import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { CANVAS_OVERLAY_COMPACT_THRESHOLD } from '@/constants/canvasConstants'
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
  topSafeZonePx?: number
  bottomSafeZonePx?: number
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
  topSafeZonePx = 0,
  bottomSafeZonePx = 0,
  className = '',
  overlayClassName = '',
  zIndex = 10,
  dataCanvasOverlayAnchor,
  dataCanvasOverlayPosition,
}: CanvasFloatingControlRailProps) {
  const { height, width, scale, isCompact, minDimension } = useCanvasOverlayScale()
  const items = flattenRailChildren(children).filter(Boolean)
  const [wrappedInCompactMode, setWrappedInCompactMode] = useState(false)
  const availableHeight =
    verticalAlign === 'center'
      ? Math.max(0, height - topSafeZonePx - bottomSafeZonePx)
      : Math.max(0, height - topOffsetPx - bottomSafeZonePx)
  const scaledButtonSize = FLOATING_CONTROL_BUTTON_SIZE_PX * scale
  const scaledGap = FLOATING_CONTROL_GAP_PX * scale
  const singleColumnHeight =
    items.length * scaledButtonSize + Math.max(0, items.length - 1) * scaledGap
  const twoColumnMinWidth = scaledButtonSize * 1.35
  const wrapStageThreshold = CANVAS_OVERLAY_COMPACT_THRESHOLD * 0.78
  const compactWrapHeight = availableHeight * 0.82
  const shouldEnterTwoColumns =
    isCompact &&
    minDimension <= wrapStageThreshold &&
    items.length > 1 &&
    width >= twoColumnMinWidth &&
    availableHeight > 0 &&
    singleColumnHeight > compactWrapHeight

  useEffect(() => {
    if (!isCompact) {
      setWrappedInCompactMode(false)
      return
    }
    if (shouldEnterTwoColumns) {
      setWrappedInCompactMode(true)
      return
    }
    setWrappedInCompactMode(false)
  }, [isCompact, shouldEnterTwoColumns])

  const shouldUseTwoColumns = shouldEnterTwoColumns || wrappedInCompactMode

  const sideStyle: CSSProperties = side === 'left' ? { left: offsetPx } : { right: offsetPx }
  const outerStyle: CSSProperties =
    verticalAlign === 'center'
      ? {
          ...sideStyle,
          paddingTop: topSafeZonePx,
          paddingBottom: bottomSafeZonePx,
        }
      : {
          ...sideStyle,
          top: topOffsetPx,
        }

  return (
    <div
      data-canvas-overlay-anchor={dataCanvasOverlayAnchor}
      data-canvas-overlay-position={dataCanvasOverlayPosition}
      className={`absolute pointer-events-none ${
        verticalAlign === 'center' ? 'inset-y-0 flex items-center' : ''
      } ${className}`.trim()}
      style={{ ...outerStyle, zIndex }}
    >
      <CanvasScaledOverlay
        className={`grid gap-2 pointer-events-auto transition-all duration-200 ease-out ${overlayClassName}`.trim()}
        transformOrigin={
          verticalAlign === 'center'
            ? side === 'left'
              ? 'left center'
              : 'right center'
            : side === 'left'
              ? 'top left'
              : 'top right'
        }
        style={{
          gridTemplateColumns: `repeat(${shouldUseTwoColumns ? 2 : 1}, minmax(0, max-content))`,
          maxHeight: availableHeight > 0 ? `${availableHeight}px` : undefined,
          alignContent: verticalAlign === 'center' ? 'center' : 'start',
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
