export interface OneWireLayoutRect {
  x: number
  y: number
  width: number
  height: number
}

export type OneWireLayoutBlockKind =
  | 'main-bus'
  | 'supply-assembly'
  | 'supply-stub'
  | 'secondary-feed'
  | 'info-block'

export interface OneWireLayoutBlock extends OneWireLayoutRect {
  id: string
  kind: OneWireLayoutBlockKind
  label: string
  /** Internal collision-only reserve; omit from the visual debug overlay. */
  debugVisible?: boolean
}

export interface BottomRightBlockArrangement {
  block: OneWireLayoutRect
  frameRight: number
  frameBottom: number
  placement: 'compact' | 'right' | 'below'
}

function right(rect: OneWireLayoutRect): number {
  return rect.x + rect.width
}

function bottom(rect: OneWireLayoutRect): number {
  return rect.y + rect.height
}

export function layoutRectsOverlap(
  left: OneWireLayoutRect,
  rightRect: OneWireLayoutRect,
  clearance = 0
): boolean {
  return !(
    right(left) + clearance <= rightRect.x ||
    right(rightRect) + clearance <= left.x ||
    bottom(left) + clearance <= rightRect.y ||
    bottom(rightRect) + clearance <= left.y
  )
}

/**
 * Place a fixed-size block at the bottom-right of a frame without intersecting
 * measured drawing blocks. The solver evaluates the two useful stacking axes:
 * grow the frame to the right, or add a row below the drawing. The smaller
 * resulting frame area wins, keeping the result deterministic and compact.
 */
export function arrangeBottomRightBlock(params: {
  frameLeft: number
  frameTop: number
  initialFrameRight: number
  initialFrameBottom: number
  frameMargin: number
  blockWidth: number
  blockHeight: number
  obstacles: OneWireLayoutRect[]
  clearance: number
  /** Keep related short feed stubs visually above the block instead of beside it. */
  preferBelow?: boolean
}): BottomRightBlockArrangement {
  const {
    frameLeft,
    frameTop,
    initialFrameRight,
    initialFrameBottom,
    frameMargin,
    blockWidth,
    blockHeight,
    obstacles,
    clearance,
    preferBelow = false,
  } = params
  const compact: OneWireLayoutRect = {
    x: initialFrameRight - frameMargin - blockWidth,
    y: initialFrameBottom - frameMargin - blockHeight,
    width: blockWidth,
    height: blockHeight,
  }
  if (!obstacles.some((obstacle) => layoutRectsOverlap(compact, obstacle, clearance))) {
    return {
      block: compact,
      frameRight: initialFrameRight,
      frameBottom: initialFrameBottom,
      placement: 'compact',
    }
  }

  const rightX = Math.max(
    compact.x,
    ...obstacles
      .filter(
        (obstacle) =>
          bottom(obstacle) + clearance > compact.y && obstacle.y < bottom(compact) + clearance
      )
      .map((obstacle) => right(obstacle) + clearance)
  )
  const rightBlock = { ...compact, x: rightX }
  const rightFrameRight = right(rightBlock) + frameMargin

  const belowY = Math.max(
    compact.y,
    ...obstacles
      .filter(
        (obstacle) =>
          right(obstacle) + clearance > compact.x && obstacle.x < right(compact) + clearance
      )
      .map((obstacle) => bottom(obstacle) + clearance)
  )
  const belowBlock = { ...compact, y: belowY }
  const belowFrameBottom = bottom(belowBlock) + frameMargin

  const rightArea =
    Math.max(1, rightFrameRight - frameLeft) * Math.max(1, initialFrameBottom - frameTop)
  const belowArea =
    Math.max(1, initialFrameRight - frameLeft) * Math.max(1, belowFrameBottom - frameTop)
  const rightGrowth = rightFrameRight - initialFrameRight

  // A modest side-step preserves the established shallow one-wire frame and
  // is easier to paginate than introducing an entire lower row. Once the
  // side-step approaches the width of the block itself, compare total area.
  if (!preferBelow && (rightGrowth <= blockWidth * 0.75 || rightArea <= belowArea)) {
    return {
      block: rightBlock,
      frameRight: rightFrameRight,
      frameBottom: initialFrameBottom,
      placement: 'right',
    }
  }
  return {
    block: belowBlock,
    frameRight: initialFrameRight,
    frameBottom: belowFrameBottom,
    placement: 'below',
  }
}
