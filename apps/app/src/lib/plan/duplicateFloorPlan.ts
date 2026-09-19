import type { Floor } from '@/types/schema'
import { generateId } from '@/utils/project'

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Clone a floor's architectural plan for a new floor.
 *
 * Floor-plan elements get fresh ids and references between openings and walls
 * are remapped. Electrical/situation-plan placements are intentionally not part
 * of a Floor, so they are not copied by this operation.
 */
export function duplicateFloorPlan(source: Floor, id: string, name: string): Floor {
  const clone = cloneJson(source)
  const { hiddenSitplanPlacementIds: _hiddenSitplanPlacementIds, ...floorWithoutPlacements } = clone
  const floorPlan = clone.floorPlan

  if (!floorPlan) {
    return {
      ...floorWithoutPlacements,
      id,
      name,
    }
  }

  const wallIdMap = new Map<string, string>()
  for (const wall of floorPlan.walls) {
    wallIdMap.set(wall.id, generateId())
  }
  const walls = floorPlan.walls.map((wall) => {
    const nextId = wallIdMap.get(wall.id) ?? generateId()
    return {
      ...wall,
      id: nextId,
      floorId: id,
      attachedPoints: wall.attachedPoints?.map((attachedPoint) => ({
        ...attachedPoint,
        wallId: wallIdMap.get(attachedPoint.wallId) ?? attachedPoint.wallId,
      })),
    }
  })

  return {
    ...floorWithoutPlacements,
    id,
    name,
    floorPlan: {
      ...floorPlan,
      walls,
      doors: floorPlan.doors.map((door) => ({
        ...door,
        id: generateId(),
        floorId: id,
        wallId: wallIdMap.get(door.wallId) ?? door.wallId,
      })),
      windows: floorPlan.windows.map((window) => ({
        ...window,
        id: generateId(),
        floorId: id,
        wallId: wallIdMap.get(window.wallId) ?? window.wallId,
      })),
      stairs: floorPlan.stairs?.map((stair) => ({
        ...stair,
        id: generateId(),
        floorId: id,
      })),
      graphicElements: floorPlan.graphicElements?.map((graphic) => ({
        ...graphic,
        id: generateId(),
        floorId: id,
      })),
    },
  }
}
