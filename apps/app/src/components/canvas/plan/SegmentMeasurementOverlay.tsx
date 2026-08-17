import { useEffect, useMemo, useRef, useState } from 'react'
import { Group, Line, Rect, Text } from 'react-konva'
import type { Wall } from '@/types/schema'
import { screenPxToCanvasUnits } from '@/constants/canvasConstants'
import { isPrimaryPlanActivationEvent } from '@/lib/canvas/planPointerEvent'
import {
  buildDistanceMeasurementGuides,
  buildSegmentMeasurementGuides,
  type DistanceMeasurementInterval,
} from '@/lib/plan/segmentMeasurements'
import {
  clearFloorPlanDrawDimensionEditor,
  setFloorPlanDrawDimensionEditor,
} from './floorPlanDrawDimensionEditorStore'

interface SegmentMeasurementOverlayProps {
  wall: Wall
  segmentIndices: number[]
  pxPerMeter: number
  zoom: number
  color?: string
  textColor?: string
  editableLabelFill?: string
  distanceIntervals?: DistanceMeasurementInterval[]
  editableSegmentIndices?: number[]
  onSegmentLengthCommit?: (segmentIndex: number, lengthCm: number) => void
  onSegmentDimensionDrag?: (
    segmentIndex: number,
    delta: { x: number; y: number },
    phase: 'start' | 'preview' | 'commit' | 'cancel',
    precise: boolean
  ) => void
}

interface DimensionDragState {
  source: 'pointer' | 'touch'
  touchIdentifier: number | null
  segmentIndex: number
  startClientX: number
  startClientY: number
  lastClientX: number
  lastClientY: number
  effectiveDeltaX: number
  effectiveDeltaY: number
  tangentX: number
  tangentY: number
  normalX: number
  normalY: number
  axisLock: 'parallel' | 'perpendicular' | null
  didDrag: boolean
}

function getClientPoint(event: MouseEvent | TouchEvent | PointerEvent): { x: number; y: number } | null {
  if ('clientX' in event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    return { x: event.clientX, y: event.clientY }
  }
  const touch = 'touches' in event ? (event.touches[0] ?? event.changedTouches[0]) : null
  return touch ? { x: touch.clientX, y: touch.clientY } : null
}

function getTrackedTouch(event: TouchEvent, identifier: number | null): Touch | null {
  const touches = [...Array.from(event.touches), ...Array.from(event.changedTouches)]
  return touches.find((touch) => identifier == null || touch.identifier === identifier) ?? null
}

export function SegmentMeasurementOverlay({
  wall,
  segmentIndices,
  pxPerMeter,
  zoom,
  color = '#0284c7',
  textColor = '#ffffff',
  editableLabelFill = 'rgba(255,255,255,0.95)',
  distanceIntervals = [],
  editableSegmentIndices = [],
  onSegmentLengthCommit,
  onSegmentDimensionDrag,
}: SegmentMeasurementOverlayProps) {
  const [editingSegmentIndex, setEditingSegmentIndex] = useState<number | null>(null)
  const [draftText, setDraftText] = useState('')
  const dimensionDragRef = useRef<DimensionDragState | null>(null)
  const suppressDimensionEditUntilRef = useRef(0)
  const editableSegmentSet = useMemo(
    () => new Set(editableSegmentIndices),
    [editableSegmentIndices]
  )

  useEffect(() => {
    if (editingSegmentIndex != null && !editableSegmentSet.has(editingSegmentIndex)) {
      setEditingSegmentIndex(null)
      setDraftText('')
    }
  }, [editableSegmentSet, editingSegmentIndex])

  useEffect(() => {
    if (editingSegmentIndex == null || !editableSegmentSet.has(editingSegmentIndex)) return
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        setDraftText((current) => `${current}${event.key}`)
        return
      }
      if ((event.key === '.' || event.key === ',') && !draftText.includes('.')) {
        event.preventDefault()
        event.stopImmediatePropagation()
        setDraftText((current) => `${current}.`)
        return
      }
      if (event.key === 'Backspace') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setDraftText((current) => current.slice(0, -1))
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setEditingSegmentIndex(null)
        setDraftText('')
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopImmediatePropagation()
        const valueCm = Number.parseFloat(draftText.replace(',', '.'))
        if (Number.isFinite(valueCm) && valueCm > 0) {
          onSegmentLengthCommit?.(editingSegmentIndex, valueCm)
        }
        setEditingSegmentIndex(null)
        setDraftText('')
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [draftText, editableSegmentSet, editingSegmentIndex, onSegmentLengthCommit])

  useEffect(() => {
    const updateDelta = (clientX: number, clientY: number, precise: boolean) => {
      const drag = dimensionDragRef.current
      if (!drag) return null
      const totalRawX = clientX - drag.startClientX
      const totalRawY = clientY - drag.startClientY
      if (!drag.didDrag && Math.hypot(totalRawX, totalRawY) < 3) return null
      const sensitivity = precise ? 0.1 : 1
      drag.effectiveDeltaX +=
        ((clientX - drag.lastClientX) / Math.max(zoom, 1e-6)) * sensitivity
      drag.effectiveDeltaY +=
        ((clientY - drag.lastClientY) / Math.max(zoom, 1e-6)) * sensitivity
      drag.lastClientX = clientX
      drag.lastClientY = clientY
      drag.didDrag = true
      if (drag.axisLock == null) {
        const parallel =
          drag.effectiveDeltaX * drag.tangentX + drag.effectiveDeltaY * drag.tangentY
        const perpendicular =
          drag.effectiveDeltaX * drag.normalX + drag.effectiveDeltaY * drag.normalY
        drag.axisLock = Math.abs(parallel) >= Math.abs(perpendicular) ? 'parallel' : 'perpendicular'
      }
      if (drag.axisLock === 'parallel') {
        const parallel =
          drag.effectiveDeltaX * drag.tangentX + drag.effectiveDeltaY * drag.tangentY
        return {
          x: drag.tangentX * parallel,
          y: drag.tangentY * parallel,
        }
      }
      if (drag.axisLock === 'perpendicular') {
        const perpendicular =
          drag.effectiveDeltaX * drag.normalX + drag.effectiveDeltaY * drag.normalY
        return {
          x: drag.normalX * perpendicular,
          y: drag.normalY * perpendicular,
        }
      }
      return {
        x: drag.effectiveDeltaX,
        y: drag.effectiveDeltaY,
      }
    }
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dimensionDragRef.current
      if (!drag || drag.source !== 'pointer') return
      const delta = updateDelta(event.clientX, event.clientY, event.shiftKey)
      if (!delta) return
      event.preventDefault()
      onSegmentDimensionDrag?.(drag.segmentIndex, delta, 'preview', event.shiftKey)
    }
    const finishDrag = (
      clientX: number,
      clientY: number,
      precise: boolean,
      cancelled: boolean
    ) => {
      const drag = dimensionDragRef.current
      if (!drag) return
      const delta = drag.didDrag
        ? (updateDelta(clientX, clientY, precise) ?? {
            x: drag.effectiveDeltaX,
            y: drag.effectiveDeltaY,
          })
        : { x: 0, y: 0 }
      dimensionDragRef.current = null
      if (drag.didDrag) {
        suppressDimensionEditUntilRef.current = Date.now() + 350
      }
      if (cancelled || !drag.didDrag) {
        onSegmentDimensionDrag?.(drag.segmentIndex, delta, 'cancel', precise)
      } else {
        onSegmentDimensionDrag?.(drag.segmentIndex, delta, 'commit', precise)
      }
    }
    const handlePointerUp = (event: PointerEvent) => {
      const drag = dimensionDragRef.current
      if (!drag || drag.source !== 'pointer') return
      if (drag.didDrag) event.preventDefault()
      finishDrag(event.clientX, event.clientY, event.shiftKey, false)
    }
    const handlePointerCancel = (event: PointerEvent) => {
      const drag = dimensionDragRef.current
      if (!drag || drag.source !== 'pointer') return
      finishDrag(event.clientX, event.clientY, event.shiftKey, true)
    }
    const handleTouchMove = (event: TouchEvent) => {
      const drag = dimensionDragRef.current
      if (!drag || drag.source !== 'touch') return
      const touch = getTrackedTouch(event, drag.touchIdentifier)
      if (!touch) return
      const delta = updateDelta(touch.clientX, touch.clientY, false)
      if (!delta) return
      event.preventDefault()
      onSegmentDimensionDrag?.(drag.segmentIndex, delta, 'preview', false)
    }
    const finishTouch = (event: TouchEvent, cancelled: boolean) => {
      const drag = dimensionDragRef.current
      if (!drag || drag.source !== 'touch') return
      const touch = getTrackedTouch(event, drag.touchIdentifier)
      const clientX = touch?.clientX ?? drag.lastClientX
      const clientY = touch?.clientY ?? drag.lastClientY
      if (drag.didDrag) event.preventDefault()
      finishDrag(clientX, clientY, false, cancelled)
    }
    const handleTouchEnd = (event: TouchEvent) => finishTouch(event, false)
    const handleTouchCancel = (event: TouchEvent) => finishTouch(event, true)
    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerUp, { passive: false })
    window.addEventListener('pointercancel', handlePointerCancel, { passive: false })
    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    window.addEventListener('touchend', handleTouchEnd, { passive: false })
    window.addEventListener('touchcancel', handleTouchCancel, { passive: false })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('touchcancel', handleTouchCancel)
    }
  }, [onSegmentDimensionDrag, zoom])

  const extensionOffset = screenPxToCanvasUnits(zoom, 60, 40, 84)
  const extensionStartOffset = screenPxToCanvasUnits(zoom, 2, 1, 4)
  const dashUnit = screenPxToCanvasUnits(zoom, 6, 2, 12)
  const lineStroke = screenPxToCanvasUnits(zoom, 1.2, 0.7, 2)
  const labelGapPadding = screenPxToCanvasUnits(zoom, 8, 4, 16)
  const fontSize = screenPxToCanvasUnits(zoom, 12, 8, 18)
  const minDashedLength = screenPxToCanvasUnits(zoom, 36, 18, 72)

  const guides = useMemo(
    () => [
      ...buildSegmentMeasurementGuides({
        points: wall.points,
        segmentIndices,
        pxPerMeter,
        extensionOffset,
      }),
      ...buildDistanceMeasurementGuides({
        points: wall.points,
        intervals: distanceIntervals,
        pxPerMeter,
        extensionOffset,
      }),
    ],
    [distanceIntervals, extensionOffset, pxPerMeter, segmentIndices, wall.points]
  )
  const dimensionEditorOwnerId = `wall-segment:${wall.id}`

  useEffect(() => {
    if (editingSegmentIndex == null) {
      clearFloorPlanDrawDimensionEditor(dimensionEditorOwnerId)
      return
    }
    const guide = guides.find((candidate) => candidate.segmentIndex === editingSegmentIndex)
    if (!guide) {
      clearFloorPlanDrawDimensionEditor(dimensionEditorOwnerId)
      return
    }
    let rotationDeg = (guide.angleRad * 180) / Math.PI
    if (rotationDeg > 90 || rotationDeg < -90) rotationDeg += 180
    const roundedCm = Math.round(guide.lengthCm * 10) / 10
    const displayValue = Number.isInteger(roundedCm) ? `${roundedCm}` : roundedCm.toFixed(1)

    setFloorPlanDrawDimensionEditor({
      ownerId: dimensionEditorOwnerId,
      fields: [
        {
          id: `segment-${editingSegmentIndex}`,
          anchor: guide.midpoint,
          placement: 'center',
          value: draftText || displayValue,
          active: true,
          rotationDeg,
        },
      ],
      onActivate: () => undefined,
      onChange: (_id, value) => setDraftText(value),
      onEnter: () => {
        const valueCm = Number.parseFloat(draftText.replace(',', '.'))
        if (Number.isFinite(valueCm) && valueCm > 0) {
          onSegmentLengthCommit?.(editingSegmentIndex, valueCm)
        }
        setEditingSegmentIndex(null)
        setDraftText('')
      },
      onTab: () => undefined,
      onEscape: () => {
        setEditingSegmentIndex(null)
        setDraftText('')
      },
    })

  }, [
    dimensionEditorOwnerId,
    draftText,
    editingSegmentIndex,
    guides,
    onSegmentLengthCommit,
  ])

  useEffect(
    () => () => clearFloorPlanDrawDimensionEditor(dimensionEditorOwnerId),
    [dimensionEditorOwnerId]
  )

  return (
    <Group listening>
      {guides.map((guide, guideIndex) => {
        const extStartA = {
          x: guide.start.x + (guide.offsetStart.x - guide.start.x) * (extensionStartOffset / extensionOffset),
          y: guide.start.y + (guide.offsetStart.y - guide.start.y) * (extensionStartOffset / extensionOffset),
        }
        const extEndA = {
          x: guide.end.x + (guide.offsetEnd.x - guide.end.x) * (extensionStartOffset / extensionOffset),
          y: guide.end.y + (guide.offsetEnd.y - guide.end.y) * (extensionStartOffset / extensionOffset),
        }

        let labelRotationDeg = (guide.angleRad * 180) / Math.PI
        if (labelRotationDeg > 90 || labelRotationDeg < -90) {
          labelRotationDeg += 180
        }

        const editable = guide.segmentIndex >= 0 && editableSegmentSet.has(guide.segmentIndex)
        const isEditing = editingSegmentIndex === guide.segmentIndex
        const displayLabel = isEditing && draftText ? `${draftText} cm` : guide.label
        const approxLabelWidth = Math.max(
          screenPxToCanvasUnits(zoom, 20, 12, 36),
          displayLabel.length * fontSize * 0.58,
        )
        const visualBoxWidth = approxLabelWidth + labelGapPadding
        const visualBoxHeight = fontSize + labelGapPadding
        const touchTargetSize = screenPxToCanvasUnits(zoom, 44, 44, 44)
        const hitBoxWidth = Math.max(visualBoxWidth, touchTargetSize)
        const hitBoxHeight = Math.max(visualBoxHeight, touchTargetSize)
        const labelGap = approxLabelWidth + labelGapPadding * 2
        const dimensionLength = Math.sqrt(
          (guide.offsetEnd.x - guide.offsetStart.x) ** 2 + (guide.offsetEnd.y - guide.offsetStart.y) ** 2,
        )
        const canSplitDashedLine = dimensionLength > Math.max(minDashedLength, labelGap + dashUnit * 2)

        const segmentDir = {
          x: (guide.offsetEnd.x - guide.offsetStart.x) / Math.max(1e-6, dimensionLength),
          y: (guide.offsetEnd.y - guide.offsetStart.y) / Math.max(1e-6, dimensionLength),
        }
        const sideMidpoint = {
          x: (guide.start.x + guide.end.x) / 2,
          y: (guide.start.y + guide.end.y) / 2,
        }
        const normalVector = {
          x: guide.midpoint.x - sideMidpoint.x,
          y: guide.midpoint.y - sideMidpoint.y,
        }
        const normalLength = Math.max(1e-6, Math.hypot(normalVector.x, normalVector.y))
        const outwardNormal = {
          x: normalVector.x / normalLength,
          y: normalVector.y / normalLength,
        }
        const gapHalf = Math.min(labelGap / 2, dimensionLength / 2)
        const leftGapEdge = {
          x: guide.midpoint.x - segmentDir.x * gapHalf,
          y: guide.midpoint.y - segmentDir.y * gapHalf,
        }
        const rightGapEdge = {
          x: guide.midpoint.x + segmentDir.x * gapHalf,
          y: guide.midpoint.y + segmentDir.y * gapHalf,
        }

        return (
          <Group key={`segment-measure-${wall.id}-${guide.segmentIndex}-${guideIndex}`} listening={editable}>
            <Line
              points={[extStartA.x, extStartA.y, guide.offsetStart.x, guide.offsetStart.y]}
              stroke={color}
              strokeWidth={lineStroke}
              listening={false}
            />
            <Line
              points={[extEndA.x, extEndA.y, guide.offsetEnd.x, guide.offsetEnd.y]}
              stroke={color}
              strokeWidth={lineStroke}
              listening={false}
            />

            {canSplitDashedLine ? (
              <>
                <Line
                  points={[guide.offsetStart.x, guide.offsetStart.y, leftGapEdge.x, leftGapEdge.y]}
                  stroke={color}
                  strokeWidth={lineStroke}
                  dash={[dashUnit, dashUnit]}
                  listening={false}
                />
                <Line
                  points={[rightGapEdge.x, rightGapEdge.y, guide.offsetEnd.x, guide.offsetEnd.y]}
                  stroke={color}
                  strokeWidth={lineStroke}
                  dash={[dashUnit, dashUnit]}
                  listening={false}
                />
              </>
            ) : (
              <Line
                points={[guide.offsetStart.x, guide.offsetStart.y, guide.offsetEnd.x, guide.offsetEnd.y]}
                stroke={color}
                strokeWidth={lineStroke}
                dash={[dashUnit, dashUnit]}
                listening={false}
              />
            )}

            <Group
              name={`planDimension-${wall.id}-${guide.segmentIndex}`}
              x={guide.midpoint.x}
              y={guide.midpoint.y}
              rotation={labelRotationDeg}
              listening={editable}
              onPointerDown={(event) => {
                if (!editable || !isPrimaryPlanActivationEvent(event.evt)) return
                event.cancelBubble = true
                if ('pointerType' in event.evt && event.evt.pointerType === 'touch') {
                  event.evt.preventDefault()
                }
                const clientPoint = getClientPoint(event.evt)
                if (clientPoint && onSegmentDimensionDrag) {
                  dimensionDragRef.current = {
                    source: 'pointer',
                    touchIdentifier: null,
                    segmentIndex: guide.segmentIndex,
                    startClientX: clientPoint.x,
                    startClientY: clientPoint.y,
                    lastClientX: clientPoint.x,
                    lastClientY: clientPoint.y,
                    effectiveDeltaX: 0,
                    effectiveDeltaY: 0,
                    tangentX: segmentDir.x,
                    tangentY: segmentDir.y,
                    normalX: outwardNormal.x,
                    normalY: outwardNormal.y,
                    axisLock: null,
                    didDrag: false,
                  }
                  onSegmentDimensionDrag(
                    guide.segmentIndex,
                    { x: 0, y: 0 },
                    'start',
                    !!event.evt.shiftKey
                  )
                }
              }}
              onTouchStart={(event) => {
                if (!editable || dimensionDragRef.current) return
                const touch = event.evt.touches[0]
                if (!touch || !onSegmentDimensionDrag) return
                event.cancelBubble = true
                event.evt.preventDefault()
                dimensionDragRef.current = {
                  source: 'touch',
                  touchIdentifier: touch.identifier,
                  segmentIndex: guide.segmentIndex,
                  startClientX: touch.clientX,
                  startClientY: touch.clientY,
                  lastClientX: touch.clientX,
                  lastClientY: touch.clientY,
                  effectiveDeltaX: 0,
                  effectiveDeltaY: 0,
                  tangentX: segmentDir.x,
                  tangentY: segmentDir.y,
                  normalX: outwardNormal.x,
                  normalY: outwardNormal.y,
                  axisLock: null,
                  didDrag: false,
                }
                onSegmentDimensionDrag(
                  guide.segmentIndex,
                  { x: 0, y: 0 },
                  'start',
                  false
                )
              }}
              onClick={(event) => {
                if (!editable || !isPrimaryPlanActivationEvent(event.evt)) return
                event.cancelBubble = true
                if (Date.now() < suppressDimensionEditUntilRef.current) return
                setEditingSegmentIndex(guide.segmentIndex)
                setDraftText('')
              }}
              onTap={(event) => {
                if (!editable) return
                event.cancelBubble = true
                if (Date.now() < suppressDimensionEditUntilRef.current) return
                setEditingSegmentIndex(guide.segmentIndex)
                setDraftText('')
              }}
            >
              {editable && !isEditing && (
                <Rect
                  x={-hitBoxWidth / 2}
                  y={-hitBoxHeight / 2}
                  width={hitBoxWidth}
                  height={hitBoxHeight}
                  fill="rgba(0,0,0,0.001)"
                />
              )}
              {editable && (
                <Rect
                  x={-visualBoxWidth / 2}
                  y={-visualBoxHeight / 2}
                  width={visualBoxWidth}
                  height={visualBoxHeight}
                  fill={editableLabelFill}
                  stroke={color}
                  strokeWidth={isEditing ? lineStroke * 1.75 : lineStroke}
                  cornerRadius={screenPxToCanvasUnits(zoom, 4, 2, 8)}
                />
              )}
              {!isEditing && (
                <Text
                  text={displayLabel}
                  fontSize={fontSize}
                  fill={textColor}
                  fontStyle="bold"
                  offsetX={approxLabelWidth / 2}
                  offsetY={fontSize / 2}
                  listening={editable}
                />
              )}
            </Group>
          </Group>
        )
      })}
    </Group>
  )
}
