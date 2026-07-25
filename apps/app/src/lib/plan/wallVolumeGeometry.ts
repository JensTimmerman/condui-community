import type { Door, Point2, Wall, Window } from '@/types/schema'
import { computeOpeningGeometry } from '@/handlers/plan/wallDrawing'
import {
  loadClipperModule,
  type ClipperModule,
  type ClipperPathsD,
  type ClipperVariant,
} from './clipper2Runtime'

const CLIPPER_PRECISION = 3
const WALL_CUTOUT_PAD = 1
const AREA_EPSILON = 1e-3

export interface WallVolumeComponent {
  id: string
  wallIds: string[]
  fillPaths: Point2[][]
}

const isClosedWall = (points: Point2[]): boolean => {
  if (points.length < 3) return false
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return false
  const dx = first.x - last.x
  const dy = first.y - last.y
  return dx * dx + dy * dy < 1e-4
}

export function resolveWallThicknessPx(
  wall: Wall,
  masterWallThickness: number,
  pxPerMeter: number | null | undefined,
): number {
  const thicknessCm = wall.thickness ?? masterWallThickness
  if (pxPerMeter != null) {
    return (thicknessCm / 100) * pxPerMeter
  }
  return thicknessCm
}

function createPathsD(module: ClipperModule, paths: Point2[][]): ClipperPathsD {
  const clipperPaths = new module.PathsD()
  for (const path of paths) {
    if (path.length < 2) continue
    const flat: number[] = []
    for (const point of path) {
      flat.push(point.x, point.y)
    }
    const clipperPath = module.MakePathD(flat)
    clipperPaths.push_back(clipperPath)
    clipperPath.delete?.()
  }
  return clipperPaths
}

function getExpansionSourcePoints(points: Point2[]): Point2[] {
  if (!isClosedWall(points)) return points
  return points.slice(0, -1)
}

function makeVertexKey(point: Point2): string {
  return `${point.x.toFixed(6)},${point.y.toFixed(6)}`
}

type VisualWallEdge = {
  a: Point2
  b: Point2
  aKey: string
  bKey: string
}

function edgeKey(edge: VisualWallEdge): string {
  return edge.aKey < edge.bKey ? `${edge.aKey}|${edge.bKey}` : `${edge.bKey}|${edge.aKey}`
}

function appendEdgePoint(path: Point2[], edge: VisualWallEdge, fromKey: string): string {
  if (fromKey === edge.aKey) {
    path.push(edge.b)
    return edge.bKey
  }
  path.push(edge.a)
  return edge.aKey
}

function traceVisualWallChain(
  startEdge: VisualWallEdge,
  startKey: string,
  edgesByNode: Map<string, VisualWallEdge[]>,
  visitedEdges: Set<string>,
): Point2[] {
  const path: Point2[] = [startKey === startEdge.aKey ? startEdge.a : startEdge.b]
  let currentEdge = startEdge
  let currentKey = startKey

  for (let guard = 0; guard < visitedEdges.size + edgesByNode.size + 1000; guard += 1) {
    const currentEdgeKey = edgeKey(currentEdge)
    if (visitedEdges.has(currentEdgeKey)) break
    visitedEdges.add(currentEdgeKey)
    currentKey = appendEdgePoint(path, currentEdge, currentKey)

    const candidates = edgesByNode.get(currentKey) ?? []
    if (candidates.length !== 2) break
    const nextEdge = candidates.find((edge) => !visitedEdges.has(edgeKey(edge)))
    if (!nextEdge) break
    currentEdge = nextEdge
  }

  return path
}

export function buildVisualWallExpansionSources(
  walls: Wall[],
): Point2[][] {
  const edgesByNode = new Map<string, VisualWallEdge[]>()
  const allEdges: VisualWallEdge[] = []

  const addEdge = (a: Point2, b: Point2) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (dx * dx + dy * dy < 1e-8) return
    const edge: VisualWallEdge = {
      a,
      b,
      aKey: makeVertexKey(a),
      bKey: makeVertexKey(b),
    }
    allEdges.push(edge)
    edgesByNode.set(edge.aKey, [...(edgesByNode.get(edge.aKey) ?? []), edge])
    edgesByNode.set(edge.bKey, [...(edgesByNode.get(edge.bKey) ?? []), edge])
  }

  for (const wall of walls) {
    const sourcePoints = getExpansionSourcePoints(wall.points)
    for (let index = 0; index < sourcePoints.length - 1; index += 1) {
      addEdge(sourcePoints[index]!, sourcePoints[index + 1]!)
    }
    if (isClosedWall(wall.points) && sourcePoints.length >= 3) {
      addEdge(sourcePoints[sourcePoints.length - 1]!, sourcePoints[0]!)
    }
  }

  const visitedEdges = new Set<string>()
  const paths: Point2[][] = []

  for (const edge of allEdges) {
    const key = edgeKey(edge)
    if (visitedEdges.has(key)) continue
    const aDegree = edgesByNode.get(edge.aKey)?.length ?? 0
    const bDegree = edgesByNode.get(edge.bKey)?.length ?? 0
    if (aDegree === 2 && bDegree === 2) continue
    const startKey = aDegree === 2 && bDegree !== 2 ? edge.bKey : edge.aKey
    const path = traceVisualWallChain(edge, startKey, edgesByNode, visitedEdges)
    if (path.length >= 2) paths.push(path)
  }

  for (const edge of allEdges) {
    if (visitedEdges.has(edgeKey(edge))) continue
    const path = traceVisualWallChain(edge, edge.aKey, edgesByNode, visitedEdges)
    if (path.length >= 2) paths.push(path)
  }

  return paths
}

function readPathsD(module: ClipperModule, paths: ClipperPathsD): Array<{ points: Point2[]; area: number }> {
  const result: Array<{ points: Point2[]; area: number }> = []
  for (let pathIndex = 0; pathIndex < paths.size(); pathIndex += 1) {
    const path = paths.get(pathIndex)
    try {
      const points: Point2[] = []
      for (let pointIndex = 0; pointIndex < path.size(); pointIndex += 1) {
        const point = path.get(pointIndex)
        try {
          points.push({ x: point.x, y: point.y })
        } finally {
          point.delete?.()
        }
      }
      if (points.length >= 3) {
        result.push({ points, area: module.AreaPathD(path) })
      }
    } finally {
      path.delete?.()
    }
  }
  return result
}

function computeWallBounds(points: Point2[], padding: number) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  }
}

function boundsOverlap(
  a: ReturnType<typeof computeWallBounds>,
  b: ReturnType<typeof computeWallBounds>,
): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)
}

function rectangleFromOpening(
  wall: Wall,
  width: number,
  position: number,
  wallThickness: number,
): Point2[] | null {
  const geom = computeOpeningGeometry(wall.points, position)
  if (!geom) return null
  const halfWidth = Math.max(0.5, width / 2)
  const halfThickness = Math.max(0.5, wallThickness / 2 + WALL_CUTOUT_PAD)
  const tangent = geom.tangent
  const normal = { x: -tangent.y, y: tangent.x }
  const center = geom.center

  return [
    {
      x: center.x - tangent.x * halfWidth - normal.x * halfThickness,
      y: center.y - tangent.y * halfWidth - normal.y * halfThickness,
    },
    {
      x: center.x + tangent.x * halfWidth - normal.x * halfThickness,
      y: center.y + tangent.y * halfWidth - normal.y * halfThickness,
    },
    {
      x: center.x + tangent.x * halfWidth + normal.x * halfThickness,
      y: center.y + tangent.y * halfWidth + normal.y * halfThickness,
    },
    {
      x: center.x - tangent.x * halfWidth + normal.x * halfThickness,
      y: center.y - tangent.y * halfWidth + normal.y * halfThickness,
    },
  ]
}

export async function buildWallVolumeComponents(
  walls: Wall[],
  doors: Door[],
  windows: Window[],
  masterWallThickness: number,
  pxPerMeter: number | null | undefined,
): Promise<WallVolumeComponent[]> {
  return buildWallVolumeComponentsForVariant(undefined, walls, doors, windows, masterWallThickness, pxPerMeter)
}

export async function buildWallVolumeComponentsForVariant(
  variant: ClipperVariant | undefined,
  walls: Wall[],
  doors: Door[],
  windows: Window[],
  masterWallThickness: number,
  pxPerMeter: number | null | undefined,
): Promise<WallVolumeComponent[]> {
  if (walls.length === 0) return []

  const module = await loadClipperModule(variant)
  const doorsByWall = new Map<string, Door[]>()
  const windowsByWall = new Map<string, Window[]>()

  for (const door of doors) {
    const list = doorsByWall.get(door.wallId) ?? []
    list.push(door)
    doorsByWall.set(door.wallId, list)
  }
  for (const window of windows) {
    const list = windowsByWall.get(window.wallId) ?? []
    list.push(window)
    windowsByWall.set(window.wallId, list)
  }

  const wallInfos = walls.map((wall) => {
    const thickness = resolveWallThicknessPx(wall, masterWallThickness, pxPerMeter)
    return {
      wall,
      thickness,
      bounds: computeWallBounds(wall.points, thickness / 2 + WALL_CUTOUT_PAD),
    }
  })

  const visited = new Set<number>()
  const components: WallVolumeComponent[] = []

  for (let startIndex = 0; startIndex < wallInfos.length; startIndex += 1) {
    if (visited.has(startIndex)) continue

    const queue = [startIndex]
    const componentIndexes: number[] = []
    visited.add(startIndex)

    while (queue.length > 0) {
      const index = queue.shift()!
      componentIndexes.push(index)
      const current = wallInfos[index]!
      for (let otherIndex = 0; otherIndex < wallInfos.length; otherIndex += 1) {
        if (visited.has(otherIndex)) continue
        const other = wallInfos[otherIndex]!
        if (!boundsOverlap(current.bounds, other.bounds)) continue
        visited.add(otherIndex)
        queue.push(otherIndex)
      }
    }

    const componentWalls = componentIndexes.map((index) => wallInfos[index]!)
    const expandedWallPolygons: Point2[][] = []
    const openingCutouts: Point2[][] = []

    const wallsByThickness = new Map<number, Wall[]>()
    for (const info of componentWalls) {
      wallsByThickness.set(info.thickness, [...(wallsByThickness.get(info.thickness) ?? []), info.wall])
    }

    const expandSourcePaths = (
      sourcePaths: Point2[][],
      thickness: number,
      endType: ClipperModule['EndType']['Butt'],
    ) => {
      if (sourcePaths.length === 0) return
      const wallPaths = createPathsD(module, sourcePaths)
      const expanded = module.InflatePathsD(
        wallPaths,
        thickness / 2,
        module.JoinType.Miter,
        endType,
        2,
        0,
        CLIPPER_PRECISION,
      )

      try {
        for (const path of readPathsD(module, expanded)) {
          if (Math.abs(path.area) > AREA_EPSILON) {
            expandedWallPolygons.push(path.points)
          }
        }
      } finally {
        expanded.delete?.()
        wallPaths.delete?.()
      }
    }

    for (const [thickness, sameThicknessWalls] of wallsByThickness) {
      const visualSourcePaths = buildVisualWallExpansionSources(sameThicknessWalls)
      expandSourcePaths(
        visualSourcePaths.filter((path) => !isClosedWall(path)),
        thickness,
        module.EndType.Butt,
      )
      expandSourcePaths(
        visualSourcePaths.filter((path) => isClosedWall(path)),
        thickness,
        module.EndType.Joined,
      )
    }

    for (const info of componentWalls) {
      for (const door of doorsByWall.get(info.wall.id) ?? []) {
        const rect = rectangleFromOpening(info.wall, door.width, door.position, info.thickness)
        if (rect) openingCutouts.push(rect)
      }
      for (const window of windowsByWall.get(info.wall.id) ?? []) {
        const rect = rectangleFromOpening(info.wall, window.width, window.position, info.thickness)
        if (rect) openingCutouts.push(rect)
      }
    }

    if (expandedWallPolygons.length === 0) continue

    const subjectPaths = createPathsD(module, expandedWallPolygons)
    let mergedPaths = module.UnionSelfD(subjectPaths, module.FillRule.NonZero, CLIPPER_PRECISION)
    subjectPaths.delete?.()

    if (openingCutouts.length > 0) {
      const cutoutPaths = createPathsD(module, openingCutouts)
      const diffPaths = module.DifferenceD(
        mergedPaths,
        cutoutPaths,
        module.FillRule.NonZero,
        CLIPPER_PRECISION,
      )
      mergedPaths.delete?.()
      cutoutPaths.delete?.()
      mergedPaths = diffPaths
    }

    try {
      const merged = readPathsD(module, mergedPaths).filter((path) => Math.abs(path.area) > AREA_EPSILON)
      if (merged.length === 0) continue

      components.push({
        id: componentWalls.map((info) => info.wall.id).join('|'),
        wallIds: componentWalls.map((info) => info.wall.id),
        fillPaths: merged.map((path) => path.points),
      })
    } finally {
      mergedPaths.delete?.()
    }
  }

  return components
}
