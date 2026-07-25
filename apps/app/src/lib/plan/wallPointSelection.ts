/** Prefix for encoded vertex ids (format: "v|wallId|pointIndex"). */
export const WALL_POINT_ID_PREFIX = 'v|'

export function parseWallPointIds(ids: string[]): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (const id of ids) {
    if (!id.startsWith(WALL_POINT_ID_PREFIX)) continue
    const parts = id.split('|')
    if (parts.length < 3) continue
    const wallId = parts[1]!
    const pointIndex = parseInt(parts[2]!, 10)
    if (Number.isNaN(pointIndex)) continue
    const list = map.get(wallId) ?? []
    if (!list.includes(pointIndex)) list.push(pointIndex)
    map.set(wallId, list)
  }
  return map
}

export function encodeWallPointId(wallId: string, pointIndex: number): string {
  return `${WALL_POINT_ID_PREFIX}${wallId}|${pointIndex}`
}

export function indexedPointMapsEqual(
  a: Map<string, number[]>,
  b: Map<string, number[]>,
): boolean {
  if (a.size !== b.size) return false
  for (const [key, aVals] of a.entries()) {
    const bVals = b.get(key)
    if (!bVals || aVals.length !== bVals.length) return false
    for (let i = 0; i < aVals.length; i++) {
      if (aVals[i] !== bVals[i]) return false
    }
  }
  return true
}
