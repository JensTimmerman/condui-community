import type { Endpoint, TrunkDevice } from '@/types/schema'
import { getHitZoneBounds } from '@/lib/layout/findDropTarget'
import type { LayoutNode, LayoutTree } from '@/lib/layout/layoutTree'
import type { Point } from '@/types/ui'
import { endpointSupportsMultiplier, getEndpointMultiplier } from '@/utils/endpointMultipliers'
import {
  getSupplyDeviceMultiplier,
  supportsSupplyDeviceMultiplier,
} from '@/lib/supplyAssembly/inverterMultipliers'

export type SameSymbolAddMoreTarget =
  | { endpoint: Endpoint; trunkDevice?: never }
  | { endpoint?: never; trunkDevice: TrunkDevice }

export interface SameSymbolAddMoreDeps {
  updateSocketCount: (endpointId: string, count: number) => void
  syncEndpointCount: (endpointId: string, count: number) => boolean
  syncSupplyDeviceCount: (deviceId: string, count: number) => boolean
}

export type SameSymbolAddMoreResult = 'not-applicable' | 'incremented' | 'blocked'

export function canIncrementSameSymbolAddMoreTarget(
  droppedSymbolId: string,
  target: SameSymbolAddMoreTarget
): boolean {
  if (target.endpoint) {
    return (
      target.endpoint.symbol === droppedSymbolId &&
      (target.endpoint.type === 'socket' || endpointSupportsMultiplier(target.endpoint))
    )
  }
  return (
    target.trunkDevice.symbol === droppedSymbolId &&
    supportsSupplyDeviceMultiplier(target.trunkDevice)
  )
}

export interface SameSymbolAddMoreLayoutTarget {
  nodeId: string
  target: SameSymbolAddMoreTarget
  center: Point
  badgePosition: Point
  outline: { x: number; y: number; width: number; height: number; cornerRadius: number }
}

const SAME_SYMBOL_PREVIEW_SIZE = 24
const MULTIPLIER_BADGE_FONT_SIZE = 8

function multiplierBadgeWidth(count: number): number {
  return Math.max(9, Math.ceil(`${count}x`.length * MULTIPLIER_BADGE_FONT_SIZE * 0.58))
}

function getTargetMultiplier(target: SameSymbolAddMoreTarget): number {
  if (target.endpoint) {
    if (target.endpoint.type === 'socket') return target.endpoint.socketProps?.socketCount ?? 1
    return getEndpointMultiplier(target.endpoint)
  }
  return getSupplyDeviceMultiplier(target.trunkDevice)
}

function multiplierBadgePosition(target: SameSymbolAddMoreTarget, center: Point): Point {
  return target.endpoint
    ? { x: center.x + 8, y: center.y - 20 }
    : { x: center.x + 21, y: center.y - 28 }
}

function supportsSameSymbolTarget(
  symbolId: string,
  node: LayoutNode
): SameSymbolAddMoreTarget | null {
  if (node.type === 'endpoint') {
    const endpoint = node.domainRef as Endpoint | undefined
    if (!endpoint || endpoint.symbol !== symbolId) return null
    if (endpoint.type !== 'socket' && !endpointSupportsMultiplier(endpoint)) return null
    return { endpoint }
  }
  if (node.type === 'trunkDevice') {
    const trunkDevice = node.domainRef as TrunkDevice | undefined
    if (
      !trunkDevice ||
      trunkDevice.symbol !== symbolId ||
      !supportsSupplyDeviceMultiplier(trunkDevice)
    ) {
      return null
    }
    return { trunkDevice }
  }
  return null
}

/** Find multiplier-capable symbols themselves, rather than their surrounding wire hit zones. */
export function findSameSymbolAddMoreLayoutTargets(
  symbolId: string,
  layoutTree: LayoutTree,
  position?: Point
): SameSymbolAddMoreLayoutTarget[] {
  const matches: SameSymbolAddMoreLayoutTarget[] = []
  const visit = (node: LayoutNode) => {
    const target = supportsSameSymbolTarget(symbolId, node)
    if (target) {
      const bounds = getHitZoneBounds(node, 'core')
      const center = {
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2,
      }
      const outline = {
        x: center.x - SAME_SYMBOL_PREVIEW_SIZE / 2,
        y: center.y - SAME_SYMBOL_PREVIEW_SIZE / 2,
        width: SAME_SYMBOL_PREVIEW_SIZE,
        height: SAME_SYMBOL_PREVIEW_SIZE,
        cornerRadius: 5,
      }
      const isHit =
        !position ||
        (position.x >= outline.x &&
          position.x <= outline.x + outline.width &&
          position.y >= outline.y &&
          position.y <= outline.y + outline.height)
      if (isHit) {
        matches.push({
          nodeId: node.id,
          target,
          center,
          badgePosition: multiplierBadgePosition(target, center),
          outline,
        })
      }
    }
    node.children.forEach(visit)
  }
  layoutTree.panels.forEach(visit)
  return matches
}

/** Multiplier text is an editor control, never a library drop target. */
export function positionHitsMultiplierBadge(layoutTree: LayoutTree, position: Point): boolean {
  let hit = false
  const visit = (node: LayoutNode) => {
    if (hit) return
    const endpoint = node.type === 'endpoint' ? (node.domainRef as Endpoint | undefined) : undefined
    const trunkDevice =
      node.type === 'trunkDevice' ? (node.domainRef as TrunkDevice | undefined) : undefined
    const target = endpoint
      ? supportsSameSymbolTarget(endpoint.symbol ?? '', node)
      : trunkDevice
        ? supportsSameSymbolTarget(trunkDevice.symbol, node)
        : null
    if (target) {
      const count = getTargetMultiplier(target)
      if (count > 1) {
        const bounds = getHitZoneBounds(node, 'core')
        const center = {
          x: (bounds.left + bounds.right) / 2,
          y: (bounds.top + bounds.bottom) / 2,
        }
        const badge = multiplierBadgePosition(target, center)
        const width = multiplierBadgeWidth(count)
        hit =
          position.x >= badge.x - 1 &&
          position.x <= badge.x + width + 1 &&
          position.y >= badge.y - 1 &&
          position.y <= badge.y + MULTIPLIER_BADGE_FONT_SIZE + 3
      }
    }
    node.children.forEach(visit)
  }
  layoutTree.panels.forEach(visit)
  return hit
}

/** Increment an existing entity only when the dropped symbol is one of its supported multipliers. */
export function incrementSameSymbolAddMoreTarget(
  droppedSymbolId: string,
  target: SameSymbolAddMoreTarget,
  deps: SameSymbolAddMoreDeps
): SameSymbolAddMoreResult {
  if (!canIncrementSameSymbolAddMoreTarget(droppedSymbolId, target)) return 'not-applicable'
  if (target.endpoint) {
    const endpoint = target.endpoint
    if (endpoint.type === 'socket') {
      deps.updateSocketCount(endpoint.id, (endpoint.socketProps?.socketCount ?? 1) + 1)
      return 'incremented'
    }
    return deps.syncEndpointCount(endpoint.id, getEndpointMultiplier(endpoint) + 1)
      ? 'incremented'
      : 'blocked'
  }

  const device = target.trunkDevice
  return deps.syncSupplyDeviceCount(device.id, getSupplyDeviceMultiplier(device) + 1)
    ? 'incremented'
    : 'blocked'
}
