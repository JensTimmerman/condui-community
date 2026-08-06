import { useRef } from 'react'
import { Circle, Group, Rect, RegularPolygon, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Door, Floor, Point2, Wall, Window } from '@/types/schema'
import type { Selection } from '@/types/ui'
import { computeOpeningGeometry, type WallOpeningGeometry } from '@/handlers/plan/wallDrawing'
import {
  DRAW_TOOL_HANDLE_RADIUS_PX,
  DRAW_TOOL_HANDLE_RADIUS_PX_MAX,
  DRAW_TOOL_HANDLE_RADIUS_PX_MIN,
  DRAW_TOOL_POINT_RADIUS_PX,
  DRAW_TOOL_POINT_RADIUS_PX_MAX,
  DRAW_TOOL_POINT_RADIUS_PX_MIN,
  DRAW_TOOL_STROKE_PX,
  DRAW_TOOL_STROKE_PX_MAX,
  DRAW_TOOL_STROKE_PX_MIN,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'
import { getThemeColor } from '@/lib/theme/colors'
import { useBlinkingCaret, withDimensionCaret } from '@/hooks/useBlinkingCaret'

type PlanCanvasInputEvent = KonvaEventObject<MouseEvent | TouchEvent | PointerEvent | DragEvent>

export type SelectedOpeningWidthEditorModel = {
  kind: 'door' | 'window'
  id: string
  width: number
  center: Point2
  tangent: Point2
  doorDirection: Door['direction'] | null
  doorSwing: Door['swing'] | null
}

export type OpeningHandleDragStart = {
  kind: 'door' | 'window'
  entityId: string
  wallId: string
  geom: WallOpeningGeometry
  width: number
  handleEnd: 'start' | 'end'
  handleOffsetFromCenter: number
}

type PlanInsertPointPreviewProps = {
  insertPointPreview: Point2 | null
  isVisible: boolean
  themeMode: 'light' | 'dark'
  zoom: number
}

export function PlanInsertPointPreview({
  insertPointPreview,
  isVisible,
  themeMode,
  zoom,
}: PlanInsertPointPreviewProps) {
  if (!isVisible || !insertPointPreview) return null

  const radiusCanvas = screenPxToCanvasUnits(
    zoom,
    DRAW_TOOL_POINT_RADIUS_PX,
    DRAW_TOOL_POINT_RADIUS_PX_MIN,
    DRAW_TOOL_POINT_RADIUS_PX_MAX
  )
  const strokeCanvas = screenPxToCanvasUnits(
    zoom,
    DRAW_TOOL_STROKE_PX,
    DRAW_TOOL_STROKE_PX_MIN,
    DRAW_TOOL_STROKE_PX_MAX
  )

  return (
    <Group listening={false}>
      <Circle
        x={insertPointPreview.x}
        y={insertPointPreview.y}
        radius={radiusCanvas}
        fill={themeMode === 'dark' ? '#f9fafb' : '#111827'}
        stroke={
          themeMode === 'dark'
            ? getThemeColor(themeMode, 'grid')
            : getThemeColor(themeMode, 'gray200')
        }
        strokeWidth={strokeCanvas}
      />
    </Group>
  )
}

type PlanOpeningResizeHandlesProps = {
  activeFloor: Floor | null | undefined
  doorsForRender: Door[]
  getCanvasPointFromEvent: (event: PlanCanvasInputEvent) => Point2 | null
  isVisible: boolean
  onDragEnd: (pointer: Point2 | null) => void
  onDragMove: (pointer: Point2) => void
  onDragStart: (drag: OpeningHandleDragStart) => void
  selection: Selection
  toolMoveHandleColor: string
  toolMoveHandleStrokeColor: string
  windowsForRender: Window[]
  zoom: number
}

export function PlanOpeningResizeHandles({
  activeFloor,
  doorsForRender,
  getCanvasPointFromEvent,
  isVisible,
  onDragEnd,
  onDragMove,
  onDragStart,
  selection,
  toolMoveHandleColor,
  toolMoveHandleStrokeColor,
  windowsForRender,
  zoom,
}: PlanOpeningResizeHandlesProps) {
  if (!isVisible || !activeFloor?.floorPlan) return null
  if ((selection.type !== 'door' && selection.type !== 'window') || selection.ids.length !== 1) {
    return null
  }

  const id = selection.ids[0]
  const isDoor = selection.type === 'door'
  const opening = isDoor
    ? doorsForRender.find((door) => door.id === id)
    : windowsForRender.find((window) => window.id === id)
  if (!opening) return null

  const wall = (activeFloor.floorPlan.walls ?? []).find(
    (candidate: Wall) => candidate.id === opening.wallId
  )
  if (!wall) return null

  const geom = computeOpeningGeometry(wall.points, opening.position)
  if (!geom) return null

  const { center, tangent } = geom
  const handleRadius = screenPxToCanvasUnits(
    zoom,
    DRAW_TOOL_HANDLE_RADIUS_PX,
    DRAW_TOOL_HANDLE_RADIUS_PX_MIN,
    DRAW_TOOL_HANDLE_RADIUS_PX_MAX
  )
  const halfWidth = opening.width / 2
  const handleOffset = screenPxToCanvasUnits(zoom, 16, 10, 28)
  const startDir = { x: -tangent.x, y: -tangent.y }
  const endDir = { x: tangent.x, y: tangent.y }
  const startPos: Point2 = {
    x: center.x + startDir.x * (halfWidth + handleOffset),
    y: center.y + startDir.y * (halfWidth + handleOffset),
  }
  const endPos: Point2 = {
    x: center.x + endDir.x * (halfWidth + handleOffset),
    y: center.y + endDir.y * (halfWidth + handleOffset),
  }
  const startAngle = (Math.atan2(startDir.y, startDir.x) * 180) / Math.PI + 90
  const endAngle = (Math.atan2(endDir.y, endDir.x) * 180) / Math.PI + 90
  const strokeWidth = screenPxToCanvasUnits(
    zoom,
    DRAW_TOOL_STROKE_PX,
    DRAW_TOOL_STROKE_PX_MIN,
    DRAW_TOOL_STROKE_PX_MAX
  )

  const createHandleProps = (pos: Point2, angle: number, handleEnd: 'start' | 'end') => ({
    x: pos.x,
    y: pos.y,
    sides: 3 as const,
    radius: handleRadius,
    rotation: angle,
    fill: toolMoveHandleColor,
    stroke: toolMoveHandleStrokeColor,
    strokeWidth,
    draggable: true,
    onDragStart: (event: PlanCanvasInputEvent) => {
      onDragStart({
        kind: isDoor ? 'door' : 'window',
        entityId: opening.id,
        wallId: wall.id,
        geom,
        width: opening.width,
        handleEnd,
        handleOffsetFromCenter: halfWidth + handleOffset,
      })
      event.target.x(pos.x)
      event.target.y(pos.y)
    },
    onDragMove: (event: PlanCanvasInputEvent) => {
      const point = getCanvasPointFromEvent(event)
      if (!point) return
      onDragMove(point)
      event.target.x(pos.x)
      event.target.y(pos.y)
    },
    onDragEnd: (event: PlanCanvasInputEvent) => {
      onDragEnd(getCanvasPointFromEvent(event))
      event.target.x(pos.x)
      event.target.y(pos.y)
    },
  })

  return (
    <Group listening>
      <RegularPolygon {...createHandleProps(startPos, startAngle, 'start')} />
      <RegularPolygon {...createHandleProps(endPos, endAngle, 'end')} />
    </Group>
  )
}

type PlanOpeningWidthEditorProps = {
  fontFamily: string
  getCanvasPointFromEvent: (event: PlanCanvasInputEvent) => Point2 | null
  isActive: boolean
  onActivate: () => void
  onDimensionDragEnd: (pointer: Point2 | null) => void
  onDimensionDragMove: (pointer: Point2) => void
  onDimensionDragStart: (pointer: Point2, outwardNormal: Point2) => void
  opening: SelectedOpeningWidthEditorModel | null
  themeMode: 'light' | 'dark'
  valueText: string
  zoom: number
}

export function PlanOpeningWidthEditor({
  fontFamily,
  getCanvasPointFromEvent,
  isActive,
  onActivate,
  onDimensionDragEnd,
  onDimensionDragMove,
  onDimensionDragStart,
  opening,
  themeMode,
  valueText,
  zoom,
}: PlanOpeningWidthEditorProps) {
  const didDragRef = useRef(false)
  const caretVisible = useBlinkingCaret(isActive)
  if (!opening) return null

  const { center, tangent } = opening
  const offsetDistance = screenPxToCanvasUnits(zoom, 24, 14, 44)
  const normal = { x: -tangent.y, y: tangent.x }
  const isDoorEditor = opening.kind === 'door'
  const anchorOffset = getOpeningWidthEditorAnchorOffset(
    opening,
    normal,
    tangent,
    offsetDistance,
    isDoorEditor
  )
  const anchor: Point2 = {
    x: center.x + anchorOffset.x,
    y: center.y + anchorOffset.y,
  }
  const anchorLength = Math.hypot(anchorOffset.x, anchorOffset.y)
  const outwardNormal =
    anchorLength > 1e-8
      ? { x: anchorOffset.x / anchorLength, y: anchorOffset.y / anchorLength }
      : normal
  const label = withDimensionCaret(valueText, ' cm', isActive, caretVisible)
  const fontSize = 13 / zoom
  const paddingX = 8 / zoom
  const paddingY = 4 / zoom
  const approxCharWidth = fontSize * 0.6
  const textWidth = Math.max(24 / zoom, label.length * approxCharWidth)
  const boxWidth = textWidth + paddingX * 2
  const boxHeight = fontSize + paddingY * 2
  const boxX = anchor.x - boxWidth / 2
  const boxY = anchor.y - boxHeight / 2
  const strokeColor = isActive ? '#0284c7' : themeMode === 'dark' ? '#e5e7eb' : '#111827'
  const textColor = isActive ? '#0284c7' : themeMode === 'dark' ? '#f9fafb' : '#111827'
  const strokeWidth = screenPxToCanvasUnits(
    zoom,
    DRAW_TOOL_STROKE_PX,
    DRAW_TOOL_STROKE_PX_MIN,
    DRAW_TOOL_STROKE_PX_MAX
  )

  return (
    <Group
      listening
      draggable
      onDragStart={(event) => {
        const pointer = getCanvasPointFromEvent(event)
        if (!pointer) return
        didDragRef.current = true
        onDimensionDragStart(pointer, outwardNormal)
        event.target.position({ x: 0, y: 0 })
      }}
      onDragMove={(event) => {
        const pointer = getCanvasPointFromEvent(event)
        if (pointer) onDimensionDragMove(pointer)
        event.target.position({ x: 0, y: 0 })
      }}
      onDragEnd={(event) => {
        onDimensionDragEnd(getCanvasPointFromEvent(event))
        event.target.position({ x: 0, y: 0 })
      }}
      onPointerDown={(event) => {
        event.cancelBubble = true
        onActivate()
      }}
      onClick={(event) => {
        event.cancelBubble = true
        if (didDragRef.current) {
          didDragRef.current = false
          return
        }
        onActivate()
      }}
      onTap={(event) => {
        event.cancelBubble = true
        onActivate()
      }}
    >
      <Rect
        x={boxX}
        y={boxY}
        width={boxWidth}
        height={boxHeight}
        fill={themeMode === 'dark' ? 'rgba(17,24,39,0.9)' : 'rgba(243,244,246,0.95)'}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        cornerRadius={screenPxToCanvasUnits(zoom, 4, 2, 8)}
      />
      <Text
        x={boxX}
        y={boxY}
        width={boxWidth}
        height={boxHeight}
        align="center"
        verticalAlign="middle"
        text={label}
        fontSize={fontSize}
        fontFamily={fontFamily}
        fill={textColor}
      />
    </Group>
  )
}

function getOpeningWidthEditorAnchorOffset(
  opening: SelectedOpeningWidthEditorModel,
  normal: Point2,
  tangent: Point2,
  offsetDistance: number,
  isDoorEditor: boolean
): Point2 {
  if (isDoorEditor) {
    const swing = opening.doorSwing ?? 'right'
    const baseDirection = opening.doorDirection ?? 'in'
    const effectiveDirection =
      swing === 'left' ? (baseDirection === 'in' ? 'out' : 'in') : baseDirection
    const sideSign = effectiveDirection === 'in' ? -1 : 1
    return {
      x: normal.x * offsetDistance * sideSign,
      y: normal.y * offsetDistance * sideSign,
    }
  }

  const isMostlyHorizontal = Math.abs(tangent.x) >= Math.abs(tangent.y)
  return isMostlyHorizontal
    ? { x: 0, y: tangent.x >= 0 ? -offsetDistance : offsetDistance }
    : { x: tangent.y >= 0 ? offsetDistance : -offsetDistance, y: 0 }
}
