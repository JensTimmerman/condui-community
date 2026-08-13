import { useMemo } from 'react'
import { Group, Circle, Rect } from 'react-konva'
import {
  collectDropZoneHints,
  resolveActiveDropZoneHintNodeId,
} from '@/lib/layout/collectDropZoneHints'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { LayoutTree } from '@/lib/layout/layoutTree'
import type { SymbolMetadata } from '@/lib/symbols'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import type { Point } from '@/types/ui'

/** Matches drag-preview accent (EendraadCanvas / DragPreview). */
const PREVIEW_STROKE = '#0284c7'
const PREVIEW_FILL = 'rgba(2, 132, 199, 0.12)'
const PREVIEW_DASH = [6, 4]
const HINT_RADIUS = 8

interface DropZoneHintsOverlayProps {
  layoutTree: LayoutTree | null
  project: ProjectWithOptionalV2Electrical | null
  symbol: SymbolMetadata | null
  activeDropTarget?: DropTarget | null
  activeDropTargetNodeId?: string | null
  activePosition?: Point | null
}

export function DropZoneHintsOverlay({
  layoutTree,
  project,
  symbol,
  activeDropTarget = null,
  activeDropTargetNodeId = null,
  activePosition = null,
}: DropZoneHintsOverlayProps) {
  const hints = useMemo(() => {
    if (!layoutTree || !project || !symbol) return []
    return collectDropZoneHints(symbol, layoutTree, project)
  }, [layoutTree, project, symbol])

  const activeHintNodeId = useMemo(
    () =>
      resolveActiveDropZoneHintNodeId(
        hints,
        activeDropTarget,
        activeDropTargetNodeId,
        activePosition,
      ),
    [hints, activeDropTarget, activeDropTargetNodeId, activePosition],
  )

  const visibleHints = useMemo(
    () => hints.filter((hint) => hint.nodeId !== activeHintNodeId),
    [hints, activeHintNodeId],
  )

  if (visibleHints.length === 0) return null

  return (
    <Group listening={false} name="drop-zone-hints">
      {visibleHints.map((hint) => (
        hint.outline ? (
          <Rect
            key={hint.nodeId}
            {...hint.outline}
            fill={PREVIEW_FILL}
            stroke={PREVIEW_STROKE}
            strokeWidth={2}
            dash={PREVIEW_DASH}
            listening={false}
          />
        ) : (
          <Circle
            key={hint.nodeId}
            x={hint.x}
            y={hint.y}
            radius={HINT_RADIUS}
            fill={PREVIEW_FILL}
            stroke={PREVIEW_STROKE}
            strokeWidth={1.5}
            dash={PREVIEW_DASH}
            listening={false}
          />
        )
      ))}
    </Group>
  )
}
