import type { WireSegment } from '@/types/schema'

const SUPPLY_WIRE_DEBUG_COLORS = [
  '#a855f7',
  '#db2777',
  '#0891b2',
  '#16a34a',
  '#dc2626',
  '#65a30d',
  '#f59e0b',
] as const

function getSupplyWirePropertyKey(wire: WireSegment): string | undefined {
  if (wire.supplySectionKey) {
    return `section:${wire.panelId}:${wire.supplySectionKey}`
  }
  if (wire.supplyAssemblyId && wire.supplyConnectionId) {
    return `connection:${wire.supplyAssemblyId}:${wire.supplyConnectionId}`
  }

  const role = wire.supplyMergedIntoBusDrop
    ? 'downstream'
    : (wire.supplyWireRole ??
      (wire.type === 'vertical' && !wire.circuitId && !wire.fromElementType
        ? 'downstream'
        : wire.isSupplyTrunk
          ? 'upstream'
          : undefined))
  if (!role || wire.isSubPanelSupply) return undefined

  return `role:${wire.panelId}:${wire.supplyFeedScope ?? 'shared'}:${role}`
}

export interface SupplyWireDiagnostic {
  code: string
  color: string
  propertyKey: string
}

/**
 * Temporary, compact identifier for the property record edited by a supply wire.
 * Drawable bends that intentionally share one property record receive the same code.
 */
export function getSupplyWireDiagnostic(
  selectedWire: WireSegment,
  allWires: WireSegment[]
): SupplyWireDiagnostic | undefined {
  const propertyKey = getSupplyWirePropertyKey(selectedWire)
  if (!propertyKey) return undefined

  const groups = new Map<string, { domain: 'AC' | 'DC'; maxX: number; centerY: number }>()
  for (const wire of allWires) {
    const key = getSupplyWirePropertyKey(wire)
    if (!key) continue
    const maxX = Math.max(wire.startPoint.x, wire.endPoint.x)
    const centerY = (wire.startPoint.y + wire.endPoint.y) / 2
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        domain: wire.domain === 'DC' ? 'DC' : 'AC',
        maxX,
        centerY,
      })
      continue
    }
    existing.maxX = Math.max(existing.maxX, maxX)
    existing.centerY = Math.max(existing.centerY, centerY)
  }
  const propertyKeys = [...groups.entries()]
    .sort(([leftKey, left], [rightKey, right]) => {
      if (left.domain !== right.domain) return left.domain === 'AC' ? -1 : 1
      if (left.maxX !== right.maxX) return right.maxX - left.maxX
      if (left.centerY !== right.centerY) return right.centerY - left.centerY
      return leftKey.localeCompare(rightKey)
    })
    .map(([key]) => key)
  const index = propertyKeys.indexOf(propertyKey)
  if (index < 0) return undefined

  return {
    code: `W${String(index + 1).padStart(2, '0')}`,
    color: SUPPLY_WIRE_DEBUG_COLORS[index % SUPPLY_WIRE_DEBUG_COLORS.length]!,
    propertyKey,
  }
}
