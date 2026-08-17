import { useMemo } from 'react'
import { Group, Circle, Line, Rect } from 'react-konva'
import {
  collectDropZoneHints,
  isRelocationNoOpDropZoneHint,
  resolveActiveDropZoneHintNodeId,
  type DropZoneHintRelocation,
} from '@/lib/layout/collectDropZoneHints'
import { SECONDARY_BUS_PREVIEW_STUB_LENGTH, type DropTarget } from '@/lib/layout/findDropTarget'
import type { LayoutTree } from '@/lib/layout/layoutTree'
import type { SymbolMetadata } from '@/lib/symbols'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import type { Point } from '@/types/ui'

/** Matches drag-preview accent (EendraadCanvas / DragPreview). */
const PREVIEW_STROKE = '#0284c7'
const PREVIEW_FILL = 'rgba(2, 132, 199, 0.12)'
const PREVIEW_DASH = [6, 4]
const HINT_RADIUS = 8
const SECONDARY_BUS_STUB_WIDTH = 4

interface DropZoneHintsOverlayProps {
  layoutTree: LayoutTree | null
  project: ProjectWithOptionalV2Electrical | null
  symbol: SymbolMetadata | null
  activeDropTarget?: DropTarget | null
  activeDropTargetNodeId?: string | null
  activePosition?: Point | null
  relocation?: DropZoneHintRelocation | null
}

export function DropZoneHintsOverlay({
  layoutTree,
  project,
  symbol,
  activeDropTarget = null,
  activeDropTargetNodeId = null,
  activePosition = null,
  relocation = null,
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
        activePosition
      ),
    [hints, activeDropTarget, activeDropTargetNodeId, activePosition]
  )

  const visibleHints = useMemo(
    () =>
      hints.filter(
        (hint) =>
          !isRelocationNoOpDropZoneHint(hint, relocation) &&
          (hint.nodeId !== activeHintNodeId || hint.nodeId.startsWith('same-symbol-add-more-'))
      ),
    [hints, activeHintNodeId, relocation]
  )

  if (visibleHints.length === 0) return null

  return (
    <Group listening={false} name="drop-zone-hints">
      {visibleHints.map((hint) =>
        hint.outline ? (
          <Group key={hint.nodeId} listening={false}>
            <Rect
              {...hint.outline}
              fill={PREVIEW_FILL}
              stroke={PREVIEW_STROKE}
              strokeWidth={2}
              dash={PREVIEW_DASH}
              listening={false}
            />
            {hint.nodeId.startsWith('same-symbol-add-more-') && (
              <>
                <Circle
                  x={hint.x}
                  y={hint.y}
                  radius={7}
                  fill={PREVIEW_FILL}
                  stroke={PREVIEW_STROKE}
                  strokeWidth={1.5}
                  listening={false}
                />
                <Line
                  points={[hint.x - 3, hint.y, hint.x + 3, hint.y]}
                  stroke={PREVIEW_STROKE}
                  strokeWidth={1.5}
                  listening={false}
                />
                <Line
                  points={[hint.x, hint.y - 3, hint.x, hint.y + 3]}
                  stroke={PREVIEW_STROKE}
                  strokeWidth={1.5}
                  listening={false}
                />
              </>
            )}
          </Group>
        ) : (
          <Group key={hint.nodeId} listening={false}>
            {hint.secondaryBusPreviewY != null && (
              <Line
                points={[
                  hint.x,
                  hint.secondaryBusPreviewY,
                  hint.x + SECONDARY_BUS_PREVIEW_STUB_LENGTH,
                  hint.secondaryBusPreviewY,
                ]}
                stroke={PREVIEW_STROKE}
                strokeWidth={SECONDARY_BUS_STUB_WIDTH}
                dash={PREVIEW_DASH}
                lineCap="round"
                listening={false}
              />
            )}
            <Circle
              x={hint.x}
              y={hint.y}
              radius={HINT_RADIUS}
              fill={PREVIEW_FILL}
              stroke={PREVIEW_STROKE}
              strokeWidth={1.5}
              dash={PREVIEW_DASH}
              listening={false}
            />
          </Group>
        )
      )}
    </Group>
  )
}
