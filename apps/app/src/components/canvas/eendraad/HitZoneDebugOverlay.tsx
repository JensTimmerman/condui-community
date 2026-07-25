import { useMemo } from 'react'
import { Group, Rect, Circle, Line, Text } from 'react-konva'
import type { LayoutTree, LayoutNode } from '@/lib/layout/layoutTree'
import { findDropTargetWithDebug, getHitZoneBounds, type HitBounds } from '@/lib/layout/findDropTarget'
import type { DragPreviewState } from '@/hooks/eendraad'
import { useSettingsStore } from '@/stores/settingsStore'
import { estimateCircuitNotesWidth } from '@/lib/layout/bottomUpLayout'
import {
  getSupplyProtectionLabelCollisionInfo,
  SUPPLY_PROTECTION_LABEL_PADDING,
  type SupplyProtectionLabelCandidate,
  type SupplyProtectionLabelOverlap,
} from '@/lib/eendraad/supplyProtectionLabelCollisions'

interface HitZoneDebugOverlayProps {
  layoutTree: LayoutTree | null
  dragPreview: DragPreviewState | null
}

interface DebugNodeInfo {
  nodeId: string
  boundsCore: HitBounds
  boundsPadded: HitBounds
  hitZoneType: string
}

interface CircuitNotesDebugInfo {
  nodeId: string
  centerX: number
  centerY: number
  width: number
  height: number
  orientation: 'horizontal' | 'vertical'
}

interface SupplyLabelCollisionDebugInfo {
  candidates: SupplyProtectionLabelCandidate[]
  overlaps: SupplyProtectionLabelOverlap[]
  collisionIds: Set<string>
}

const HITZONE_COLORS: Record<string, string> = {
  endpoint: '#22c55e', // green
  circuit: '#0284c7', // blue
  mainBus: '#f97316', // orange
  rcd: '#8b5cf6', // violet
  protection: '#0ea5e9', // cyan
  supplyWire: '#a855f7', // purple
  groundWire: '#ca8a04', // amber
}

function collectDebugNodes(layoutTree: LayoutTree): DebugNodeInfo[] {
  const nodes: DebugNodeInfo[] = []

  const visit = (node: LayoutNode) => {
    if (node.hitZone?.type) {
      const boundsCore = getHitZoneBounds(node, 'core')
      const boundsPadded = getHitZoneBounds(node, 'padded')
      nodes.push({
        nodeId: node.id,
        boundsCore,
        boundsPadded,
        hitZoneType: node.hitZone.type,
      })
    }
    for (const child of node.children) {
      visit(child)
    }
  }

  for (const panel of layoutTree.panels) {
    visit(panel)
  }

  return nodes
}

function collectCircuitNotesDebug(layoutTree: LayoutTree): CircuitNotesDebugInfo[] {
  const nodes: CircuitNotesDebugInfo[] = []

  const visit = (node: LayoutNode) => {
    if (
      node.type === 'label' &&
      node.visual &&
      node.visual.type === 'label' &&
      node.visual.variant === 'circuit-notes'
    ) {
      const orientation = node.visual.notesOrientation ?? 'horizontal'
      const text = node.visual.text ?? ''

      // Mirror CircuitNotesLabel sizing logic so debug rectangles match the
      // actual rendered text box instead of the generic layout bounds.
      const estWidth = estimateCircuitNotesWidth(text)
      const lineHeight = 14

      const centerX = node.bounds.x
      let centerY = node.bounds.y
      let width: number
      let height: number

      if (orientation === 'vertical') {
        // RenderNode shifts the group up by estWidth / 2 and rotates -90° around
        // its center. After rotation, the axis-aligned bounding box has height
        // ≈ estWidth and width ≈ lineHeight, with the same center point.
        centerY = node.bounds.y - estWidth / 2
        width = lineHeight
        height = estWidth
      } else {
        // Horizontal: tight text box around the center.
        width = estWidth
        height = lineHeight
      }

      nodes.push({
        nodeId: node.id,
        centerX,
        centerY,
        width,
        height,
        orientation,
      })
    }
    for (const child of node.children) {
      visit(child)
    }
  }

  for (const panel of layoutTree.panels) {
    visit(panel)
  }

  return nodes
}

function collectSupplyLabelCollisionDebug(layoutTree: LayoutTree): SupplyLabelCollisionDebugInfo {
  const candidates: SupplyProtectionLabelCandidate[] = []
  const overlaps: SupplyProtectionLabelOverlap[] = []
  const collisionIds = new Set<string>()

  for (const panel of layoutTree.panels) {
    const info = getSupplyProtectionLabelCollisionInfo(panel)
    candidates.push(...info.candidates)
    overlaps.push(...info.overlaps)
    for (const id of info.collisionIds) {
      collisionIds.add(id)
    }
  }

  return { candidates, overlaps, collisionIds }
}

export function HitZoneDebugOverlay({ layoutTree, dragPreview }: HitZoneDebugOverlayProps) {
  const enabled = useSettingsStore((s) => s.eendraadHitboxDebug)

  const debugNodes = useMemo(() => {
    if (!layoutTree || !enabled) return []
    return collectDebugNodes(layoutTree)
  }, [layoutTree, enabled])

  const circuitNotesNodes = useMemo(() => {
    if (!layoutTree || !enabled) return []
    return collectCircuitNotesDebug(layoutTree)
  }, [layoutTree, enabled])

  const highlightedNodeId = useMemo(() => {
    if (!layoutTree || !dragPreview || !enabled) return null
    const { debug } = findDropTargetWithDebug(
      layoutTree,
      dragPreview.position,
      dragPreview.relocatingTrunkDevice ? { ignoreCircuitTrunkDeviceSymbolHits: true } : undefined,
    )
    const matched = debug.path.find((step) => step.matched && step.nodeId)
    return matched?.nodeId ?? null
  }, [layoutTree, dragPreview, enabled])

  const supplyLabelDebug = useMemo(() => {
    if (!layoutTree || !enabled) {
      return { candidates: [], overlaps: [], collisionIds: new Set<string>() }
    }
    return collectSupplyLabelCollisionDebug(layoutTree)
  }, [layoutTree, enabled])

  if (
    process.env.NODE_ENV === 'production' ||
    !enabled ||
    !layoutTree ||
    (debugNodes.length === 0 &&
      circuitNotesNodes.length === 0 &&
      supplyLabelDebug.candidates.length === 0)
  ) {
    return null
  }

  return (
    <Group listening={false}>
      {debugNodes.map((node) => {
        const isHighlighted = highlightedNodeId === node.nodeId
        const color =
          HITZONE_COLORS[node.hitZoneType] ??
          '#ef4444' // default red for unknown types

        const coreWidth = node.boundsCore.right - node.boundsCore.left
        const coreHeight = node.boundsCore.bottom - node.boundsCore.top
        const paddedWidth = node.boundsPadded.right - node.boundsPadded.left
        const paddedHeight = node.boundsPadded.bottom - node.boundsPadded.top

        return (
          <Group key={node.nodeId}>
            {/* Padded hit zone */}
            <Rect
              x={node.boundsPadded.left}
              y={node.boundsPadded.top}
              width={paddedWidth}
              height={paddedHeight}
              fill={isHighlighted ? `${color}22` : 'transparent'}
              stroke={color}
              strokeWidth={isHighlighted ? 2 : 1}
              dash={isHighlighted ? [6, 4] : [4, 4]}
              listening={false}
            />
            {/* Core bounds */}
            <Rect
              x={node.boundsCore.left}
              y={node.boundsCore.top}
              width={coreWidth}
              height={coreHeight}
              fill="transparent"
              stroke={isHighlighted ? '#000000' : color}
              strokeWidth={isHighlighted ? 2.5 : 1}
              listening={false}
            />
          </Group>
        )
      })}
      {circuitNotesNodes.map((node) => {
        const rectX = node.centerX - node.width / 2
        const rectY = node.centerY - node.height / 2
        const strokeColor =
          node.orientation === 'vertical' ? '#ec4899' : '#22d3ee' // pink for vertical, cyan for horizontal

        return (
          <Group key={`circuit-notes-${node.nodeId}`}>
            {/* Circuit notes bounds (layout box used for stacking) */}
            <Rect
              x={rectX}
              y={rectY}
              width={node.width}
              height={node.height}
              stroke={strokeColor}
              strokeWidth={1}
              dash={[4, 4]}
              listening={false}
            />
            {/* Center / rotation pivot marker */}
            <Circle
              x={node.centerX}
              y={node.centerY}
              radius={2.5}
              fill={strokeColor}
              listening={false}
            />
            <Line
              points={[node.centerX - 6, node.centerY, node.centerX + 6, node.centerY]}
              stroke={strokeColor}
              strokeWidth={1}
              listening={false}
            />
            <Line
              points={[node.centerX, node.centerY - 6, node.centerX, node.centerY + 6]}
              stroke={strokeColor}
              strokeWidth={1}
              listening={false}
            />
          </Group>
        )
      })}
      {supplyLabelDebug.candidates.map((candidate) => {
        const isColliding = supplyLabelDebug.collisionIds.has(candidate.nodeId)
        const color = isColliding ? '#dc2626' : '#16a34a'
        const y = candidate.y + 28
        const halfWidth = candidate.estimatedSequenceWidth / 2
        const left = candidate.x - halfWidth
        const right = candidate.x + halfWidth

        return (
          <Group key={`supply-label-${candidate.nodeId}`}>
            <Line
              points={[left, y, right, y]}
              stroke={color}
              strokeWidth={2}
              listening={false}
            />
            <Circle x={candidate.x} y={y} radius={2.5} fill={color} listening={false} />
            <Text
              x={candidate.x + 4}
              y={y - 14}
              text={`${Math.round(candidate.estimatedSequenceWidth)}px`}
              fontSize={9}
              fill={color}
              listening={false}
            />
          </Group>
        )
      })}
      {supplyLabelDebug.overlaps.map((overlap) => {
        const left = supplyLabelDebug.candidates.find((c) => c.nodeId === overlap.leftNodeId)
        const right = supplyLabelDebug.candidates.find((c) => c.nodeId === overlap.rightNodeId)
        if (!left || !right) return null

        const y = Math.min(left.y, right.y) + 22
        return (
          <Group key={`supply-overlap-${overlap.leftNodeId}-${overlap.rightNodeId}`}>
            <Line
              points={[left.x, y, right.x, y]}
              stroke="#f59e0b"
              strokeWidth={2}
              dash={[6, 4]}
              listening={false}
            />
            <Text
              x={(left.x + right.x) / 2 - 56}
              y={y - 14}
              text={`${Math.round(overlap.actualSpacing)} < ${Math.round(overlap.requiredSpacing)} (+${SUPPLY_PROTECTION_LABEL_PADDING})`}
              fontSize={9}
              fill="#f59e0b"
              listening={false}
            />
          </Group>
        )
      })}
    </Group>
  )
}

