import React, { useEffect, useMemo, useState } from 'react'
import { Circle, Group, Line, Path } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Endpoint, PlanWireRoute, PlanWireRouteStyle, Point2, TrunkDevice } from '@/types/schema'
import { applyWireInset } from '@/lib/layout/wireInsets'
import {
  PLAN_WIRE_DASH,
  PLAN_WIRE_HIT_STROKE_WIDTH,
  PLAN_WIRE_STATIC_HOVER_OPACITY,
  PLAN_WIRE_STATIC_OPACITY,
  PLAN_WIRE_STROKE_WIDTH,
  planWireActiveStroke,
  planWireSpanSetKey,
  planWireStaticStroke,
} from '@/lib/plan/planWiring'
import type { ThemeMode } from '@/lib/theme/types'
import {
  resolveOrthogonalPolylines,
  type RoutePointContext,
} from '@/lib/plan/planWireOrthogonal'
import { distanceSq, projectPointToSegment } from '@/lib/geometry'

interface PlanWiresLayerProps {
  routes: PlanWireRoute[]
  routeStyle: PlanWireRouteStyle
  theme: ThemeMode
  getEndpointById: (id: string) => Endpoint | undefined
  getTrunkDeviceById?: (id: string) => TrunkDevice | undefined
  placementPositionOverrides?: Map<string, Point2>
  active: boolean
  /** Map viewport client coords to plan space (accounts for pan/zoom on the content layer). */
  clientToPlan: (clientX: number, clientY: number) => Point2 | null
  onInsertWaypoint?: (route: PlanWireRoute, point: Point2, waypointIndex: number) => void
  onMoveWaypoint?: (route: PlanWireRoute, waypointIndex: number, point: Point2) => void
  onRemoveWaypoint?: (route: PlanWireRoute, waypointIndex: number) => void
}

function resolveEndpointAnchor(
  routeEnd: PlanWireRoute['from'],
  floorId: string,
  getEndpointById: (id: string) => Endpoint | undefined,
  getTrunkDeviceById?: (id: string) => TrunkDevice | undefined,
  placementPositionOverrides?: Map<string, Point2>
): { point: Point2; nodeType: string; symbolId: string | undefined } | null {
  const endpoint = getEndpointById(routeEnd.endpointId)
  const trunkDevice = routeEnd.trunkDeviceId ? getTrunkDeviceById?.(routeEnd.trunkDeviceId) : undefined
  const placement =
    endpoint?.placements.find((candidate) => candidate.id === routeEnd.placementId) ??
    endpoint?.placements.find((candidate) => candidate.floorId === floorId) ??
    trunkDevice?.placements?.find((candidate) => candidate.id === routeEnd.placementId) ??
    trunkDevice?.placements?.find((candidate) => candidate.floorId === floorId)
  if (!placement) return null
  const nodeType = endpoint?.type ?? trunkDevice?.type ?? 'endpoint'
  const symbolId = endpoint?.symbol ?? trunkDevice?.symbol
  if (placement?.id) {
    const override = placementPositionOverrides?.get(placement.id)
    if (override) return { point: override, nodeType, symbolId }
  }
  return { point: placement.pos, nodeType, symbolId }
}

function routePoints(start: Point2, waypoints: Point2[] | undefined, end: Point2): Point2[] {
  return [start, ...(waypoints ?? []), end]
}

function averageContinuation(origin: Point2, continuations: Point2[]): Point2 | undefined {
  if (continuations.length === 0) return undefined
  let x = 0
  let y = 0
  let count = 0
  for (const point of continuations) {
    const unit = unitVector({ x: point.x - origin.x, y: point.y - origin.y })
    if (vectorLength(unit) <= 1e-6) continue
    x += unit.x
    y += unit.y
    count += 1
  }
  if (count === 0) return undefined
  const length = Math.max(
    48,
    Math.min(
      160,
      continuations.reduce(
        (sum, point) => sum + Math.hypot(point.x - origin.x, point.y - origin.y),
        0
      ) /
        count /
        2
    )
  )
  const direction = scaledVector({ x, y }, length)
  return { x: origin.x + direction.x, y: origin.y + direction.y }
}

function routeBeforePoint(route: { basePoints: Point2[] }): Point2 | undefined {
  return route.basePoints[route.basePoints.length - 2] ?? route.basePoints[0]
}

function routeAfterPoint(route: { basePoints: Point2[] }): Point2 | undefined {
  return route.basePoints[1] ?? route.basePoints[0]
}

function contextualNeighbor(
  points: Point2[],
  index: number,
  direction: 'previous' | 'next',
  context?: RoutePointContext
): Point2 | undefined {
  if (direction === 'previous')
    return points[index - 1] ?? (index === 0 ? context?.startPrevious : undefined)
  return points[index + 1] ?? (index === points.length - 1 ? context?.endNext : undefined)
}

function cubicPoint(
  start: Point2,
  controlA: Point2,
  controlB: Point2,
  end: Point2,
  t: number
): Point2 {
  const mt = 1 - t
  return {
    x:
      mt * mt * mt * start.x +
      3 * mt * mt * t * controlA.x +
      3 * mt * t * t * controlB.x +
      t * t * t * end.x,
    y:
      mt * mt * mt * start.y +
      3 * mt * mt * t * controlA.y +
      3 * mt * t * t * controlB.y +
      t * t * t * end.y,
  }
}

function vectorLength(vector: Point2): number {
  return Math.hypot(vector.x, vector.y)
}

function scaledVector(vector: Point2, length: number): Point2 {
  const currentLength = vectorLength(vector)
  if (currentLength <= 1e-6) return { x: 0, y: 0 }
  return { x: (vector.x / currentLength) * length, y: (vector.y / currentLength) * length }
}

function unitVector(vector: Point2): Point2 {
  const length = vectorLength(vector)
  if (length <= 1e-6) return { x: 0, y: 0 }
  return { x: vector.x / length, y: vector.y / length }
}

function tangentAt(points: Point2[], index: number, context?: RoutePointContext): Point2 {
  const point = points[index]!
  const previous = contextualNeighbor(points, index, 'previous', context)
  const next = contextualNeighbor(points, index, 'next', context)
  if (previous && next) {
    const previousDistance = Math.hypot(point.x - previous.x, point.y - previous.y)
    const nextDistance = Math.hypot(next.x - point.x, next.y - point.y)
    const incoming = unitVector({ x: point.x - previous.x, y: point.y - previous.y })
    const outgoing = unitVector({ x: next.x - point.x, y: next.y - point.y })
    const tangent = { x: incoming.x + outgoing.x, y: incoming.y + outgoing.y }
    const fallback = { x: next.x - previous.x, y: next.y - previous.y }
    return scaledVector(
      vectorLength(tangent) > 1e-4 ? tangent : fallback,
      Math.min(previousDistance, nextDistance) * 0.58
    )
  }
  const neighbor = next ?? previous
  if (!neighbor) return { x: 0, y: 0 }
  const towardNeighbor = next
    ? { x: neighbor.x - point.x, y: neighbor.y - point.y }
    : { x: point.x - neighbor.x, y: point.y - neighbor.y }
  const direction =
    Math.abs(towardNeighbor.x) >= Math.abs(towardNeighbor.y)
      ? { x: Math.sign(towardNeighbor.x) || 1, y: 0 }
      : { x: 0, y: Math.sign(towardNeighbor.y) || 1 }
  return scaledVector(direction, Math.min(vectorLength(towardNeighbor) * 0.32, 90))
}

function limitHandleLength(vector: Point2, maxLength: number): Point2 {
  const length = vectorLength(vector)
  if (length <= maxLength) return vector
  return scaledVector(vector, maxLength)
}

function splineControls(
  points: Point2[],
  index: number,
  context?: RoutePointContext
): { controlA: Point2; controlB: Point2 } {
  const start = points[index]!
  const end = points[index + 1]!
  const segmentLength = Math.hypot(end.x - start.x, end.y - start.y)
  const maxHandle = Math.max(12, segmentLength * 0.46)
  const startTangent = limitHandleLength(tangentAt(points, index, context), maxHandle)
  const endTangent = limitHandleLength(tangentAt(points, index + 1, context), maxHandle)
  return {
    controlA: { x: start.x + startTangent.x, y: start.y + startTangent.y },
    controlB: { x: end.x - endTangent.x, y: end.y - endTangent.y },
  }
}

function splinePath(points: Point2[], context?: RoutePointContext): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`
  const parts = [`M ${points[0]!.x} ${points[0]!.y}`]
  for (let index = 0; index < points.length - 1; index += 1) {
    const { controlA, controlB } = splineControls(points, index, context)
    const end = points[index + 1]!
    parts.push(`C ${controlA.x} ${controlA.y} ${controlB.x} ${controlB.y} ${end.x} ${end.y}`)
  }
  return parts.join(' ')
}

function sampleSpline(points: Point2[], context?: RoutePointContext): Point2[] {
  if (points.length <= 1) return points
  const samples: Point2[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!
    const end = points[index + 1]!
    const { controlA, controlB } = splineControls(points, index, context)
    if (samples.length === 0) samples.push(start)
    const segmentDistance = Math.hypot(end.x - start.x, end.y - start.y)
    const steps = Math.max(8, Math.min(28, Math.ceil(segmentDistance / 16)))
    for (let step = 1; step <= steps; step += 1) {
      samples.push(cubicPoint(start, controlA, controlB, end, step / steps))
    }
  }
  return samples
}

function flatten(points: Point2[]): number[] {
  return points.flatMap((point) => [point.x, point.y])
}

function applyEndpointInsets(
  start: { point: Point2; nodeType: string; symbolId: string | undefined },
  waypoints: Point2[],
  end: { point: Point2; nodeType: string; symbolId: string | undefined }
): { start: Point2; end: Point2 } {
  const startOther = waypoints[0] ?? end.point
  const endOther = waypoints[waypoints.length - 1] ?? start.point
  return {
    start: applyWireInset(start.point, startOther, start.nodeType, start.symbolId),
    end: applyWireInset(end.point, endOther, end.nodeType, end.symbolId),
  }
}

function nearestWaypointInsertion(
  point: Point2,
  points: Point2[]
): { point: Point2; waypointIndex: number } | null {
  if (points.length < 2) return null
  let best: { point: Point2; waypointIndex: number; distance: number } | null = null
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!
    const b = points[index + 1]!
    const projected = projectPointToSegment(point, a, b)
    const projectedDistanceSq = distanceSq(point, projected.point)
    if (!best || projectedDistanceSq < best.distance) {
      best = { point: projected.point, waypointIndex: index, distance: projectedDistanceSq }
    }
  }
  return best
}

function nearestVisualInsertion(
  point: Point2,
  visualPoints: Point2[],
  waypointPoints: Point2[]
): { point: Point2; waypointIndex: number } | null {
  const visual = nearestWaypointInsertion(point, visualPoints)
  const waypoint = nearestWaypointInsertion(point, waypointPoints)
  if (!visual || !waypoint) return null
  return { point: visual.point, waypointIndex: waypoint.waypointIndex }
}

/** Left click / touch primary — middle and right are reserved for pan / context menu. */
function isPrimaryMouseEvent(evt: MouseEvent | TouchEvent | PointerEvent): boolean {
  if (evt instanceof MouseEvent || evt instanceof PointerEvent) {
    return evt.button === 0
  }
  return true
}

/** True for desktop right-click / ctrl+click context menu — not touch double-tap synthetic menu. */
function isExplicitWaypointDeleteContextMenu(
  evt: MouseEvent | TouchEvent | PointerEvent,
): boolean {
  if (evt instanceof PointerEvent) {
    if (evt.pointerType === 'touch') return false
    return evt.button === 2
  }
  if (evt instanceof MouseEvent) {
    if (evt.button === 2) return true
    return evt.button === 0 && evt.ctrlKey
  }
  return false
}

function eventCanvasPoint(event: KonvaEventObject<MouseEvent | TouchEvent>): Point2 | null {
  const stage = event.target.getStage()
  const pointer = stage?.getPointerPosition()
  if (!stage || !pointer) return null
  const transform = event.target.getAbsoluteTransform().copy().invert()
  return transform.point(pointer)
}

type PlacingWaypointSession = {
  route: PlanWireRoute
  waypointIndex: number
}

export function PlanWiresLayer({
  routes,
  routeStyle,
  theme,
  getEndpointById,
  getTrunkDeviceById,
  placementPositionOverrides,
  active,
  clientToPlan,
  onInsertWaypoint,
  onMoveWaypoint,
  onRemoveWaypoint,
}: PlanWiresLayerProps) {
  const [hoveredRouteId, setHoveredRouteId] = useState<string | null>(null)
  const [hoverInsertPreview, setHoverInsertPreview] = useState<{
    routeId: string
    point: Point2
  } | null>(null)
  const [dragWaypointPreview, setDragWaypointPreview] = useState<{
    routeId: string
    waypointIndex: number
    point: Point2
  } | null>(null)
  const [placingWaypoint, setPlacingWaypoint] = useState<PlacingWaypointSession | null>(null)

  useEffect(() => {
    if (!placingWaypoint) return

    const { route, waypointIndex } = placingWaypoint

    const onPointerMove = (event: PointerEvent) => {
      const point = clientToPlan(event.clientX, event.clientY)
      if (!point) return
      setDragWaypointPreview({
        routeId: route.id,
        waypointIndex,
        point,
      })
    }

    const finishPlacement = (event: PointerEvent) => {
      if (!isPrimaryMouseEvent(event)) return
      const point = clientToPlan(event.clientX, event.clientY)
      if (point) {
        onMoveWaypoint?.(route, waypointIndex, point)
      }
      setPlacingWaypoint(null)
      setDragWaypointPreview(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finishPlacement)
    window.addEventListener('pointercancel', finishPlacement)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finishPlacement)
      window.removeEventListener('pointercancel', finishPlacement)
    }
  }, [clientToPlan, placingWaypoint, onMoveWaypoint])

  const staticStroke = planWireStaticStroke(theme)
  const activeStroke = planWireActiveStroke(theme)
  const waypointRadius = 4
  const previewRadius = 3.5

  const drawableRoutes = useMemo(() => {
    const drafts = routes
      .map((route) => {
        const startAnchor = resolveEndpointAnchor(
          route.from,
          route.floorId,
          getEndpointById,
          getTrunkDeviceById,
          placementPositionOverrides
        )
        const endAnchor = resolveEndpointAnchor(
          route.to,
          route.floorId,
          getEndpointById,
          getTrunkDeviceById,
          placementPositionOverrides
        )
        if (!startAnchor || !endAnchor) return null
        const style = routeStyle
        const waypoints = [...(route.waypoints ?? [])]
        if (dragWaypointPreview?.routeId === route.id) {
          waypoints[dragWaypointPreview.waypointIndex] = dragWaypointPreview.point
        }
        const { start, end } = applyEndpointInsets(startAnchor, waypoints, endAnchor)
        const basePoints = routePoints(start, waypoints, end)
        return { route, basePoints, style }
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

    const incomingByPlacement = new Map<string, typeof drafts>()
    const outgoingByPlacement = new Map<string, typeof drafts>()
    for (const draft of drafts) {
      const toPlacementId = draft.route.to.placementId
      const fromPlacementId = draft.route.from.placementId
      if (toPlacementId) {
        incomingByPlacement.set(toPlacementId, [
          ...(incomingByPlacement.get(toPlacementId) ?? []),
          draft,
        ])
      }
      if (fromPlacementId) {
        outgoingByPlacement.set(fromPlacementId, [
          ...(outgoingByPlacement.get(fromPlacementId) ?? []),
          draft,
        ])
      }
    }

    const incomingRouteIdByRouteId = new Map<string, string>()
    const outgoingRouteIdByRouteId = new Map<string, string>()

    const draftContexts = drafts.map((draft) => {
      const incoming = draft.route.from.placementId
        ? (incomingByPlacement.get(draft.route.from.placementId) ?? [])
        : []
      const outgoing = draft.route.to.placementId
        ? (outgoingByPlacement.get(draft.route.to.placementId) ?? [])
        : []
      const incomingRoute = incoming.find((route) => route.route.id !== draft.route.id)
      const outgoingRoute =
        outgoing.length === 1
          ? outgoing.find((route) => route.route.id !== draft.route.id)
          : undefined
      if (incomingRoute) incomingRouteIdByRouteId.set(draft.route.id, incomingRoute.route.id)
      if (outgoingRoute) outgoingRouteIdByRouteId.set(draft.route.id, outgoingRoute.route.id)
      const context: RoutePointContext = {}
      if (incomingRoute) {
        context.startPrevious = routeBeforePoint(incomingRoute)
      }
      if (outgoingRoute) {
        context.endNext = routeAfterPoint(outgoingRoute)
      } else if (outgoing.length > 1) {
        const forkPoint = draft.basePoints[draft.basePoints.length - 1]
        if (forkPoint) {
          context.endNext = averageContinuation(
            forkPoint,
            outgoing
              .filter((route) => route.route.id !== draft.route.id)
              .map(routeAfterPoint)
              .filter((point): point is Point2 => Boolean(point))
          )
        }
      }
      return { draft, context }
    })

    const orthogonalInputs = draftContexts
      .filter(({ draft }) => draft.style !== 'spline')
      .map(({ draft, context }) => ({
        id: draft.route.id,
        spanSetKey: planWireSpanSetKey(draft.route),
        basePoints: draft.basePoints,
        context: context.startPrevious || context.endNext ? context : undefined,
      }))

    const orthogonalPolylines = resolveOrthogonalPolylines(orthogonalInputs, {
      getIncomingRouteId: (routeId) => incomingRouteIdByRouteId.get(routeId),
      getOutgoingRouteId: (routeId) => outgoingRouteIdByRouteId.get(routeId),
    })

    return draftContexts.map(({ draft, context }) => {
      const hasContext = Boolean(context.startPrevious || context.endNext)
      const points =
        draft.style === 'spline'
          ? draft.basePoints
          : (orthogonalPolylines.get(draft.route.id) ?? draft.basePoints)
      const hitPoints =
        draft.style === 'spline'
          ? sampleSpline(draft.basePoints, hasContext ? context : undefined)
          : points
      const pathData =
        draft.style === 'spline' ? splinePath(draft.basePoints, hasContext ? context : undefined) : ''
      return {
        route: draft.route,
        points,
        basePoints: draft.basePoints,
        style: draft.style,
        hitPoints,
        pathData,
      }
    })
  }, [dragWaypointPreview, getEndpointById, placementPositionOverrides, routeStyle, routes])

  return (
    <Group name="plan-wires-layer" listening={active}>
      {drawableRoutes.map(({ route, points, basePoints, style, hitPoints, pathData }) => {
        const hovered = hoveredRouteId === route.id
        return (
          <React.Fragment key={route.id}>
            {style === 'spline' ? (
              <Path
                data={pathData}
                stroke={staticStroke}
                strokeWidth={PLAN_WIRE_STROKE_WIDTH}
                opacity={hovered ? PLAN_WIRE_STATIC_HOVER_OPACITY : PLAN_WIRE_STATIC_OPACITY}
                dash={PLAN_WIRE_DASH}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            ) : (
              <Line
                points={flatten(points)}
                stroke={staticStroke}
                strokeWidth={PLAN_WIRE_STROKE_WIDTH}
                opacity={hovered ? PLAN_WIRE_STATIC_HOVER_OPACITY : PLAN_WIRE_STATIC_OPACITY}
                dash={PLAN_WIRE_DASH}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            )}
            <Line
              points={flatten(hitPoints)}
              stroke="rgba(0,0,0,0.001)"
              strokeWidth={1}
              hitStrokeWidth={PLAN_WIRE_HIT_STROKE_WIDTH}
              lineCap="round"
              lineJoin="round"
              onMouseEnter={(event) => {
                setHoveredRouteId(route.id)
                if (!active) return
                const point = eventCanvasPoint(event)
                const insertion = point
                  ? nearestVisualInsertion(point, hitPoints, basePoints)
                  : null
                setHoverInsertPreview(
                  insertion ? { routeId: route.id, point: insertion.point } : null
                )
              }}
              onMouseMove={(event) => {
                if (!active) return
                const point = eventCanvasPoint(event)
                const insertion = point
                  ? nearestVisualInsertion(point, hitPoints, basePoints)
                  : null
                setHoverInsertPreview(
                  insertion ? { routeId: route.id, point: insertion.point } : null
                )
              }}
              onMouseLeave={() => {
                setHoveredRouteId(null)
                setHoverInsertPreview(null)
              }}
              onMouseDown={(event) => {
                if (placingWaypoint || !active || !onInsertWaypoint || !onMoveWaypoint) return
                if (!isPrimaryMouseEvent(event.evt)) return
                event.cancelBubble = true
                event.evt.preventDefault()
                const point = eventCanvasPoint(event)
                if (!point) return
                const insertion = nearestVisualInsertion(point, hitPoints, basePoints)
                if (!insertion) return
                const placePoint =
                  clientToPlan(event.evt.clientX, event.evt.clientY) ?? insertion.point
                onInsertWaypoint(route, placePoint, insertion.waypointIndex)
                setDragWaypointPreview({
                  routeId: route.id,
                  waypointIndex: insertion.waypointIndex,
                  point: placePoint,
                })
                setPlacingWaypoint({
                  route,
                  waypointIndex: insertion.waypointIndex,
                })
              }}
            />
            {active &&
              hoverInsertPreview?.routeId === route.id &&
              (!route.waypoints || route.waypoints.length === 0 || hovered) && (
                <Circle
                  x={hoverInsertPreview.point.x}
                  y={hoverInsertPreview.point.y}
                  radius={previewRadius}
                  fill={activeStroke}
                  opacity={0.35}
                  stroke="#ffffff"
                  strokeWidth={PLAN_WIRE_STROKE_WIDTH}
                  listening={false}
                />
              )}
            {active &&
              basePoints.map((point, index) => {
                const waypointIndex = index - 1
                const isWaypoint =
                  waypointIndex >= 0 && waypointIndex < (route.waypoints?.length ?? 0)
                if (!isWaypoint) return null
                const isPlacing =
                  placingWaypoint?.route.id === route.id &&
                  placingWaypoint.waypointIndex === waypointIndex
                return (
                  <Circle
                    key={`${route.id}-${index}`}
                    x={point.x}
                    y={point.y}
                    radius={waypointRadius}
                    fill={activeStroke}
                    stroke="#ffffff"
                    strokeWidth={PLAN_WIRE_STROKE_WIDTH}
                    draggable={!isPlacing}
                    listening={!isPlacing}
                    onMouseDown={(event) => {
                      if (!isPrimaryMouseEvent(event.evt)) {
                        event.target.stopDrag()
                      }
                    }}
                    onDragStart={(event) => {
                      if (!isPrimaryMouseEvent(event.evt)) {
                        event.target.stopDrag()
                      }
                    }}
                    onClick={(event) => {
                      event.cancelBubble = true
                      if (event.evt.altKey && onRemoveWaypoint) {
                        onRemoveWaypoint(route, waypointIndex)
                      }
                    }}
                    onContextMenu={(event) => {
                      event.evt.preventDefault()
                      event.cancelBubble = true
                      if (!isExplicitWaypointDeleteContextMenu(event.evt)) return
                      onRemoveWaypoint?.(route, waypointIndex)
                    }}
                    onDragMove={(event) => {
                      setDragWaypointPreview({
                        routeId: route.id,
                        waypointIndex,
                        point: { x: event.target.x(), y: event.target.y() },
                      })
                    }}
                    onDragEnd={(event) => {
                      setDragWaypointPreview(null)
                      if (!isPrimaryMouseEvent(event.evt) || !onMoveWaypoint) return
                      onMoveWaypoint(route, waypointIndex, {
                        x: event.target.x(),
                        y: event.target.y(),
                      })
                    }}
                  />
                )
              })}
          </React.Fragment>
        )
      })}
    </Group>
  )
}
