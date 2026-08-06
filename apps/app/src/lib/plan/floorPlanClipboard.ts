import type {
  Door,
  FloorPlan,
  PlanGraphicElement,
  Placement,
  Point2,
  Stair,
  Wall,
  Window,
} from '@/types/schema'

export interface FloorPlanClipboardPlacement {
  endpointId: string
  placement: Placement
}

export interface FloorPlanClipboardPayload {
  sourceFloorId: string
  sourcePxPerMeter: number
  sourceMasterWallThickness: number
  walls: Wall[]
  doors: Door[]
  windows: Window[]
  stairs: Stair[]
  graphicElements: PlanGraphicElement[]
  placements: FloorPlanClipboardPlacement[]
}

export interface FloorPlanPasteResult {
  floorPlan: FloorPlan
  wallIds: string[]
  stairIds: string[]
  graphicElementIds: string[]
  placements: FloorPlanClipboardPlacement[]
  placementIds: string[]
}

export function selectWallsForFloorPlanClipboard(input: {
  walls: Wall[]
  selectedWallIds: readonly string[]
  selectedSegmentIndices: ReadonlyMap<string, readonly number[]>
}): Wall[] {
  const selectedIds = new Set(input.selectedWallIds)
  return input.walls.flatMap((wall) => {
    if (!selectedIds.has(wall.id)) return []
    const selectedSegments = Array.from(
      new Set(
        (input.selectedSegmentIndices.get(wall.id) ?? []).filter(
          (index) => index >= 0 && index < wall.points.length - 1
        )
      )
    ).sort((a, b) => a - b)
    if (selectedSegments.length === 0 || selectedSegments.length === wall.points.length - 1) {
      return [wall]
    }

    const runs: Array<{ start: number; end: number }> = []
    for (const segmentIndex of selectedSegments) {
      const previous = runs[runs.length - 1]
      if (previous && segmentIndex === previous.end + 1) previous.end = segmentIndex
      else runs.push({ start: segmentIndex, end: segmentIndex })
    }
    return runs.map((run) => ({
      ...wall,
      id: `${wall.id}::clipboard-segments:${run.start}-${run.end}`,
      points: wall.points.slice(run.start, run.end + 2).map(clonePoint),
      attachedPoints: undefined,
    }))
  })
}

export function createFloorPlanClipboardPayload(input: {
  sourceFloorId: string
  sourcePxPerMeter: number
  sourceMasterWallThickness: number
  walls: Wall[]
  doors: Door[]
  windows: Window[]
  stairs: Stair[]
  graphicElements: PlanGraphicElement[]
  placements?: FloorPlanClipboardPlacement[]
}): FloorPlanClipboardPayload | null {
  if (
    input.walls.length +
      input.stairs.length +
      input.graphicElements.length +
      (input.placements?.length ?? 0) ===
    0
  )
    return null

  return {
    ...input,
    walls: input.walls.map((wall) => ({ ...wall, points: wall.points.map(clonePoint) })),
    doors: input.doors.map((door) => ({ ...door })),
    windows: input.windows.map((window) => ({ ...window })),
    stairs: input.stairs.map((stair) => ({ ...stair, points: stair.points.map(clonePoint) })),
    graphicElements: input.graphicElements.map((element) => ({
      ...element,
      pos: clonePoint(element.pos),
    })),
    placements: (input.placements ?? []).map(({ endpointId, placement }) => ({
      endpointId,
      placement: { ...placement, pos: clonePoint(placement.pos) },
    })),
  }
}

export function pasteFloorPlanClipboardPayload(input: {
  payload: FloorPlanClipboardPayload
  targetFloorId: string
  targetPxPerMeter: number
  targetFloorPlan?: FloorPlan
  generateId: () => string
  copyOpenings?: boolean
  targetCenter?: Point2
}): FloorPlanPasteResult {
  const { payload, targetFloorId, generateId } = input
  const sourcePxPerMeter = payload.sourcePxPerMeter > 0 ? payload.sourcePxPerMeter : 100
  const targetPxPerMeter = input.targetPxPerMeter > 0 ? input.targetPxPerMeter : 100
  const scaleFactor = targetPxPerMeter / sourcePxPerMeter
  const sourceCenter = getPayloadBoundsCenter(payload)
  const translate =
    input.targetCenter && sourceCenter
      ? {
          x: input.targetCenter.x - sourceCenter.x * scaleFactor,
          y: input.targetCenter.y - sourceCenter.y * scaleFactor,
        }
      : { x: 0, y: 0 }
  const transformPoint = (point: Point2): Point2 => ({
    x: point.x * scaleFactor + translate.x,
    y: point.y * scaleFactor + translate.y,
  })
  const targetFloorPlan = input.targetFloorPlan ?? {
    walls: [],
    doors: [],
    windows: [],
    stairs: [],
    graphicElements: [],
    masterWallThickness: payload.sourceMasterWallThickness * scaleFactor,
  }

  const wallIdMap = new Map<string, string>()
  payload.walls.forEach((wall) => wallIdMap.set(wall.id, generateId()))
  const walls = payload.walls.map((wall) => {
    const id = wallIdMap.get(wall.id)!
    return {
      ...wall,
      id,
      floorId: targetFloorId,
      points: wall.points.map(transformPoint),
      thickness: (wall.thickness ?? payload.sourceMasterWallThickness) * scaleFactor,
      attachedPoints: wall.attachedPoints?.flatMap((attachment) => {
        const attachedWallId = wallIdMap.get(attachment.wallId)
        return attachedWallId ? [{ ...attachment, wallId: attachedWallId }] : []
      }),
    }
  })
  const stairs = payload.stairs.map((stair) => ({
    ...stair,
    id: generateId(),
    floorId: targetFloorId,
    points: stair.points.map(transformPoint),
    width: stair.width * scaleFactor,
    stepDepth: stair.stepDepth * scaleFactor,
    spiralPoleDiameter:
      typeof stair.spiralPoleDiameter === 'number'
        ? stair.spiralPoleDiameter * scaleFactor
        : stair.spiralPoleDiameter,
  }))
  const graphicElements = payload.graphicElements.map((element) => ({
    ...element,
    id: generateId(),
    floorId: targetFloorId,
    pos: transformPoint(element.pos),
    width: element.width * scaleFactor,
    height: element.height * scaleFactor,
  }))
  const placements = (payload.placements ?? []).map(({ endpointId, placement }) => ({
    endpointId,
    placement: {
      ...placement,
      id: generateId(),
      floorId: targetFloorId,
      pos: transformPoint(placement.pos),
    },
  }))
  const copyOpenings = input.copyOpenings !== false
  const doors = copyOpenings
    ? payload.doors.flatMap((door) => {
        const wallId = wallIdMap.get(door.wallId)
        if (!wallId) return []
        return [
          {
            ...door,
            id: generateId(),
            floorId: targetFloorId,
            wallId,
            width: door.width * scaleFactor,
            centerAlongSegment:
              typeof door.centerAlongSegment === 'number'
                ? door.centerAlongSegment * scaleFactor
                : door.centerAlongSegment,
          },
        ]
      })
    : []
  const windows = copyOpenings
    ? payload.windows.flatMap((window) => {
        const wallId = wallIdMap.get(window.wallId)
        if (!wallId) return []
        return [
          {
            ...window,
            id: generateId(),
            floorId: targetFloorId,
            wallId,
            width: window.width * scaleFactor,
            centerAlongSegment:
              typeof window.centerAlongSegment === 'number'
                ? window.centerAlongSegment * scaleFactor
                : window.centerAlongSegment,
          },
        ]
      })
    : []

  return {
    floorPlan: {
      ...targetFloorPlan,
      walls: [...(targetFloorPlan.walls ?? []), ...walls],
      doors: [...(targetFloorPlan.doors ?? []), ...doors],
      windows: [...(targetFloorPlan.windows ?? []), ...windows],
      stairs: [...(targetFloorPlan.stairs ?? []), ...stairs],
      graphicElements: [...(targetFloorPlan.graphicElements ?? []), ...graphicElements],
    },
    wallIds: walls.map((wall) => wall.id),
    stairIds: stairs.map((stair) => stair.id),
    graphicElementIds: graphicElements.map((element) => element.id),
    placements,
    placementIds: placements.map(({ placement }) => placement.id),
  }
}

function getPayloadBoundsCenter(payload: FloorPlanClipboardPayload): Point2 | null {
  const points: Point2[] = []
  payload.walls.forEach((wall) => points.push(...wall.points))
  payload.stairs.forEach((stair) => points.push(...stair.points))
  payload.graphicElements.forEach((element) => {
    points.push(
      { x: element.pos.x - element.width / 2, y: element.pos.y - element.height / 2 },
      { x: element.pos.x + element.width / 2, y: element.pos.y + element.height / 2 }
    )
  })
  const placementCopies = payload.placements ?? []
  placementCopies.forEach(({ placement }) => points.push(placement.pos))
  if (points.length === 0) return null
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  }
}

function clonePoint(point: Point2): Point2 {
  return { x: point.x, y: point.y }
}
