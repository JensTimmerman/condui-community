export interface MetadataCalloutGroupItem {
  id: string
  ownerId: string
  symbol: string
  lines: string[]
  multiplier: number
}

export interface MetadataCalloutGroup {
  representativeId: string
  targetIds: string[]
  totalMultiplier: number
}

export const METADATA_CALLOUT_MIN_WIDTH = 44
const METADATA_CALLOUT_HORIZONTAL_PADDING = 5
const METADATA_CALLOUT_MAX_WIDTH = 260

export function getMetadataCalloutWidth(textWidths: number[]): number {
  return Math.min(
    METADATA_CALLOUT_MAX_WIDTH,
    Math.max(
      METADATA_CALLOUT_MIN_WIDTH,
      Math.max(0, ...textWidths) + METADATA_CALLOUT_HORIZONTAL_PADDING * 2
    )
  )
}

export function applyMetadataCalloutMultiplier<
  T extends { key: string; text: string },
>(items: T[], totalMultiplier: number): T[] {
  if (totalMultiplier <= 1) return items
  return items.map((item) =>
    item.key === 'certificationModel'
      ? { ...item, text: `${totalMultiplier}× ${item.text}` }
      : item
  )
}

/** Groups equal displayed specs while keeping quantity out of the identity. */
export function getMetadataCalloutGroups(
  items: MetadataCalloutGroupItem[]
): Map<string, MetadataCalloutGroup> {
  const grouped = new Map<string, MetadataCalloutGroupItem[]>()
  for (const item of items) {
    if (item.lines.length === 0) continue
    const key = [item.ownerId, item.symbol, ...item.lines].join('\u0000')
    const group = grouped.get(key) ?? []
    group.push(item)
    grouped.set(key, group)
  }

  const result = new Map<string, MetadataCalloutGroup>()
  for (const itemsInGroup of grouped.values()) {
    const group = {
      representativeId: itemsInGroup[0]!.id,
      targetIds: itemsInGroup.map((item) => item.id),
      totalMultiplier: itemsInGroup.reduce(
        (total, item) => total + Math.max(1, item.multiplier),
        0
      ),
    }
    group.targetIds.forEach((targetId) => result.set(targetId, group))
  }
  return result
}
