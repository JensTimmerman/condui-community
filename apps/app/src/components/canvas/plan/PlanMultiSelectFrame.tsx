import { useRef, useState } from 'react'
import { Group, Line, Rect } from 'react-konva'
import { useUIStore } from '@/stores/uiStore'
import { usePlanDragPositionsMap } from '@/stores/planDragVisualStore'
import type { Point } from '@/types/ui'
import {
  SELECTION_OUTLINE_CORNER_RADIUS_PX,
  SELECTION_OUTLINE_CORNER_RADIUS_PX_MAX,
  SELECTION_OUTLINE_CORNER_RADIUS_PX_MIN,
  SELECTION_OUTLINE_STROKE_PX,
  SELECTION_OUTLINE_STROKE_PX_MAX,
  SELECTION_OUTLINE_STROKE_PX_MIN,
  canvasSizeWithScreenMinimum,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'

type SelectionBounds = { x: number; y: number; width: number; height: number }

type FrameDragHandlers = {
  onSelectionFrameDragStart?: () => void
  onSelectionFrameDragMove?: (delta: Point) => void
  onSelectionFrameDragEnd?: (expectedDeltaInPlanSpace: Point) => void
}

export function PlanMultiSelectFrame({
  canDrag,
  effectivePlanZoom,
  getSelectionBounds,
  frameDragHandlers,
}: {
  canDrag: boolean
  effectivePlanZoom: number
  getSelectionBounds: () => SelectionBounds | null
  frameDragHandlers: FrameDragHandlers
}) {
  const selection = useUIStore((s) => s.selection)
  usePlanDragPositionsMap()
  const [groupPos, setGroupPos] = useState<Point | null>(null)
  const dragStartRef = useRef<Point>({ x: 0, y: 0 })
  const dragLockPosRef = useRef<Point | null>(null)

  if (selection.ids.length <= 1 || selection.type === 'trunkDevice') {
    return null
  }

  const bounds = getSelectionBounds()
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return null
  }

  const canDragFrame =
    canDrag &&
    !!(
      frameDragHandlers.onSelectionFrameDragStart &&
      frameDragHandlers.onSelectionFrameDragMove &&
      frameDragHandlers.onSelectionFrameDragEnd
    )

  const groupPosition = groupPos ?? { x: bounds.x, y: bounds.y }
  const strokeWidthCanvas = screenPxToCanvasUnits(
    effectivePlanZoom,
    SELECTION_OUTLINE_STROKE_PX,
    SELECTION_OUTLINE_STROKE_PX_MIN,
    SELECTION_OUTLINE_STROKE_PX_MAX,
  )
  const crossHalfCanvas = screenPxToCanvasUnits(effectivePlanZoom, 8, 4, 16)
  const centerBoxCanvas = screenPxToCanvasUnits(effectivePlanZoom, 8, 4, 16)
  const centerBoxHalfCanvas = centerBoxCanvas / 2
  const frameCornerRadiusCanvas = screenPxToCanvasUnits(
    effectivePlanZoom,
    SELECTION_OUTLINE_CORNER_RADIUS_PX,
    SELECTION_OUTLINE_CORNER_RADIUS_PX_MIN,
    SELECTION_OUTLINE_CORNER_RADIUS_PX_MAX,
  )
  const frameW = canvasSizeWithScreenMinimum(effectivePlanZoom, bounds.width)
  const frameH = canvasSizeWithScreenMinimum(effectivePlanZoom, bounds.height)
  const frameInsetX = (frameW - bounds.width) / 2
  const frameInsetY = (frameH - bounds.height) / 2
  const centerX = bounds.width / 2
  const centerY = bounds.height / 2

  return (
    <Group
      key="multi-select-frame"
      x={groupPosition.x}
      y={groupPosition.y}
      listening={canDragFrame}
      draggable={canDragFrame}
      dragBoundFunc={
        canDragFrame
          ? (pos: Point) => {
              const lock = dragLockPosRef.current
              if (lock) return lock
              return pos
            }
          : undefined
      }
      onMouseDown={
        canDragFrame
          ? (e: { evt: MouseEvent; target: { x: () => number; y: () => number; stopDrag: () => void } }) => {
              if (e.evt.button != null && e.evt.button !== 0) {
                dragLockPosRef.current = { x: e.target.x(), y: e.target.y() }
                e.target.stopDrag()
              } else {
                dragLockPosRef.current = null
              }
            }
          : undefined
      }
      onDragStart={
        canDragFrame
          ? (_e: {
              target: { getStage: () => { getPointerPosition: () => Point | null } | null }
            }) => {
              if (dragLockPosRef.current) return
              dragStartRef.current = { x: bounds.x, y: bounds.y }
              setGroupPos({ x: bounds.x, y: bounds.y })
              frameDragHandlers.onSelectionFrameDragStart!()
            }
          : undefined
      }
      onDragMove={
        canDragFrame
          ? (e: { target: { x: () => number; y: () => number } }) => {
              if (dragLockPosRef.current) return
              const x = e.target.x()
              const y = e.target.y()
              setGroupPos({ x, y })
              const start = dragStartRef.current
              frameDragHandlers.onSelectionFrameDragMove!({
                x: x - start.x,
                y: y - start.y,
              })
            }
          : undefined
      }
      onDragEnd={
        canDragFrame
          ? (e: { target: { x: () => number; y: () => number } }) => {
              if (dragLockPosRef.current) {
                dragLockPosRef.current = null
                setGroupPos(null)
                return
              }
              const node = e.target
              const start = dragStartRef.current
              const expectedDeltaInPlanSpace: Point = {
                x: node.x() - start.x,
                y: node.y() - start.y,
              }
              setGroupPos(null)
              frameDragHandlers.onSelectionFrameDragEnd!(expectedDeltaInPlanSpace)
            }
          : undefined
      }
    >
      <Rect
        x={-frameInsetX}
        y={-frameInsetY}
        width={frameW}
        height={frameH}
        fill="rgba(251, 191, 36, 0.15)"
        stroke="#eab308"
        strokeWidth={strokeWidthCanvas}
        cornerRadius={frameCornerRadiusCanvas}
        listening={true}
      />
      <Line
        points={[
          centerX - crossHalfCanvas,
          centerY,
          centerX + crossHalfCanvas,
          centerY,
          centerX,
          centerY - crossHalfCanvas,
          centerX,
          centerY + crossHalfCanvas,
        ]}
        stroke="#eab308"
        strokeWidth={strokeWidthCanvas}
        listening={false}
      />
      <Rect
        x={centerX - centerBoxHalfCanvas}
        y={centerY - centerBoxHalfCanvas}
        width={centerBoxCanvas}
        height={centerBoxCanvas}
        fill="#eab308"
        cornerRadius={frameCornerRadiusCanvas}
        listening={false}
      />
    </Group>
  )
}
