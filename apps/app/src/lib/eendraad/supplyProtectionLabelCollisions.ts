import type { LayoutNode } from '@/lib/layout/layoutTree'
import type { TrunkDevice } from '@/types/schema'
import { getVisibleProtectionLabelLines } from '@/lib/protectionLabels'

export interface SupplyProtectionLabelCandidate {
  nodeId: string
  x: number
  y: number
  estimatedSequenceWidth: number
}

export interface SupplyProtectionLabelOverlap {
  leftNodeId: string
  rightNodeId: string
  actualSpacing: number
  requiredSpacing: number
}

export interface SupplyProtectionLabelCollisionInfo {
  candidates: SupplyProtectionLabelCandidate[]
  overlaps: SupplyProtectionLabelOverlap[]
  collisionIds: Set<string>
}

export const SUPPLY_PROTECTION_LABEL_FONT_SIZE = 10
export const SUPPLY_PROTECTION_LABEL_PADDING = 10
const SUPPLY_PROTECTION_DEFAULT_POSITION = 'bottom'
const SUPPLY_PROTECTION_DEFAULT_LAYOUT = 'sequence'

function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.6
}

function collectSupplyProtectionLabelCandidates(root: LayoutNode): SupplyProtectionLabelCandidate[] {
  const candidates: SupplyProtectionLabelCandidate[] = []
  const stack: LayoutNode[] = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) break

    const isSupplyTrunkDevice = current.type === 'trunkDevice' && current.id?.startsWith('supplyTrunkDevice-')
    if (isSupplyTrunkDevice && current.domainRef) {
      const device = current.domainRef as unknown as TrunkDevice
      const isProtection = device.type === 'protection'
      const isBottomPosition =
        (device.symbolLabelDisplay?.position ?? SUPPLY_PROTECTION_DEFAULT_POSITION) === 'bottom'
      const isSequenceLayout =
        (device.symbolLabelDisplay?.layout ?? SUPPLY_PROTECTION_DEFAULT_LAYOUT) === 'sequence'

      if (isProtection && isBottomPosition && isSequenceLayout) {
        const lines = getVisibleProtectionLabelLines(device)
        if (lines.length > 0) {
          const estimatedSequenceWidth = Math.max(
            ...lines.map((line) => estimateTextWidth(line, SUPPLY_PROTECTION_LABEL_FONT_SIZE)),
          )
          candidates.push({
            nodeId: current.id,
            x: current.bounds.x,
            y: current.bounds.y,
            estimatedSequenceWidth,
          })
        }
      }
    }

    for (const child of current.children) {
      stack.push(child)
    }
  }

  return candidates
}

export function getSupplyProtectionLabelCollisionInfo(
  root: LayoutNode,
): SupplyProtectionLabelCollisionInfo {
  const candidates = collectSupplyProtectionLabelCandidates(root).sort((a, b) => a.x - b.x)
  const overlaps: SupplyProtectionLabelOverlap[] = []
  const collisionIds = new Set<string>()

  for (let i = 1; i < candidates.length; i += 1) {
    const left = candidates[i - 1]!
    const right = candidates[i]!
    const requiredSpacing =
      (left.estimatedSequenceWidth + right.estimatedSequenceWidth) / 2 + SUPPLY_PROTECTION_LABEL_PADDING
    const actualSpacing = Math.abs(right.x - left.x)

    if (actualSpacing < requiredSpacing) {
      overlaps.push({
        leftNodeId: left.nodeId,
        rightNodeId: right.nodeId,
        actualSpacing,
        requiredSpacing,
      })
      collisionIds.add(left.nodeId)
      collisionIds.add(right.nodeId)
    }
  }

  return {
    candidates,
    overlaps,
    collisionIds,
  }
}

