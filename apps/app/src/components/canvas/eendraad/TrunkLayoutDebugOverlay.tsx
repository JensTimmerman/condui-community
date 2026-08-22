import { useMemo } from 'react'
import { Group, Rect, Text } from 'react-konva'
import type {
  BottomUpCircuitLayout,
  BottomUpLayoutResult,
  BottomUpPanelLayout,
} from '@/lib/layout/bottomUpLayout'
import { LAYOUT_CONSTANTS } from '@/lib/layout/bottomUpLayout'
import { getCircuitNotesPaintBounds } from '@/lib/layout/circuitNoteMetrics'
import type { OneWireLayoutBlockKind } from '@/lib/layout/oneWireBlockLayout'
import { getBusFeedMarkerPaintBounds } from '@/lib/layout/busFeedMarkerGeometry'
import type { WireSegment } from '@/types/schema'
import { useSettingsStore } from '@/stores/settingsStore'

interface TrunkLayoutDebugOverlayProps {
  layout: BottomUpLayoutResult | null
  wireSegments: WireSegment[]
}

interface TrunkDebugBox {
  id: string
  code: string
  depth: number
  x: number
  y: number
  width: number
  height: number
  anchorX: number
}

interface NoteDebugBox {
  id: string
  code: string
  x: number
  y: number
  width: number
  height: number
  anchorX: number
  anchorY: number
}

function collectDescendantIds(
  panelLayout: BottomUpPanelLayout,
  circuitLayout: BottomUpCircuitLayout
): Set<string> {
  const ids = new Set<string>()
  const visit = (circuitId: string) => {
    if (ids.has(circuitId)) return
    ids.add(circuitId)
    const circuit = panelLayout.circuits.find(
      (candidate) => candidate.circuit.id === circuitId
    )?.circuit
    for (const childId of circuit?.subCircuitIds ?? []) visit(childId)
  }
  visit(circuitLayout.circuit.id)
  return ids
}

function getCircuitDepth(circuitLayout: BottomUpCircuitLayout): number {
  let depth = 0
  let parent = circuitLayout.parentCircuit
  while (parent) {
    depth += 1
    parent = null
  }
  return depth
}

function buildDebugBox(
  panelLayout: BottomUpPanelLayout,
  circuitLayout: BottomUpCircuitLayout
): TrunkDebugBox {
  const circuitIds = collectDescendantIds(panelLayout, circuitLayout)
  let minY = panelLayout.mainBus.y - LAYOUT_CONSTANTS.SYMBOL_SIZE
  let maxY = panelLayout.mainBus.y + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2

  for (const branch of panelLayout.branches) {
    if (!circuitIds.has(branch.circuitId)) continue
    minY = Math.min(minY, branch.branchY - LAYOUT_CONSTANTS.SYMBOL_SIZE)
    maxY = Math.max(maxY, branch.branchY + LAYOUT_CONSTANTS.SYMBOL_SIZE)
  }
  for (const element of panelLayout.elements) {
    if (!element.circuitId || !circuitIds.has(element.circuitId)) continue
    minY = Math.min(minY, element.position.y - LAYOUT_CONSTANTS.SYMBOL_SIZE)
    maxY = Math.max(maxY, element.position.y + LAYOUT_CONSTANTS.SYMBOL_SIZE)
  }
  for (const note of panelLayout.circuitNotes ?? []) {
    if (!circuitIds.has(note.circuitId) || note.notesVisible === false) continue
    const noteBounds = getCircuitNotesPaintBounds(note.label, note.notesOrientation)
    minY = Math.min(minY, note.y + noteBounds.top)
  }

  const anchorX =
    circuitLayout.x +
    circuitLayout.leftReserve +
    Math.max(LAYOUT_CONSTANTS.PROTECTION_WIDTH, LAYOUT_CONSTANTS.SYMBOL_SIZE) / 2
  return {
    id: circuitLayout.circuit.id,
    code: circuitLayout.circuit.code,
    depth: getCircuitDepth(circuitLayout),
    x: circuitLayout.x,
    y: minY,
    width: circuitLayout.width,
    height: Math.max(1, maxY - minY),
    anchorX,
  }
}

function collectNoteDebugBoxes(layout: BottomUpLayoutResult): NoteDebugBox[] {
  return layout.panels.flatMap((panelLayout) => {
    if (panelLayout.frameRole === 'supply') return []
    return (panelLayout.circuitNotes ?? []).flatMap((note) => {
      if (note.notesVisible === false || !note.label.trim()) return []
      const bounds = getCircuitNotesPaintBounds(note.label, note.notesOrientation)
      const code =
        panelLayout.circuits.find((candidate) => candidate.circuit.id === note.circuitId)?.circuit
          .code ?? '?'
      return [
        {
          id: `${panelLayout.diagramId}-${note.circuitId}`,
          code,
          x: note.x + bounds.left,
          y: note.y + bounds.top,
          width: bounds.width,
          height: bounds.height,
          anchorX: note.x,
          anchorY: note.y,
        },
      ]
    })
  })
}

function collectDebugBoxes(layout: BottomUpLayoutResult): TrunkDebugBox[] {
  return layout.panels.flatMap((panelLayout) =>
    panelLayout.frameRole === 'supply'
      ? []
      : panelLayout.circuits.map((circuitLayout) => buildDebugBox(panelLayout, circuitLayout))
  )
}

export function TrunkLayoutDebugOverlay({ layout, wireSegments }: TrunkLayoutDebugOverlayProps) {
  const settingEnabled = useSettingsStore((state) => state.eendraadTrunkLayoutDebug)
  const enabled = import.meta.env.DEV && settingEnabled
  const boxes = useMemo(
    () => (layout && enabled ? collectDebugBoxes(layout) : []),
    [layout, enabled]
  )
  const noteBoxes = useMemo(
    () => (layout && enabled ? collectNoteDebugBoxes(layout) : []),
    [layout, enabled]
  )
  const layoutBlocks = useMemo(
    () =>
      layout && enabled
        ? layout.panels.flatMap((panel) =>
            (panel.layoutBlocks ?? []).filter((block) => block.debugVisible !== false)
          )
        : [],
    [layout, enabled]
  )
  const generatedStubBlocks = useMemo(
    () =>
      enabled
        ? wireSegments.flatMap((segment) => {
            if (!segment.showBusFeedMarker || !segment.busSectionId) return []
            const bounds = getBusFeedMarkerPaintBounds(segment)
            return [
              {
                id: `generated-stub-${segment.id}`,
                kind: 'supply-stub' as const,
                label: `${segment.busFeedKind ?? 'feed'} ${
                  segment.type === 'mainBus' ? 'rail' : 'stub'
                }`,
                ...bounds,
              },
            ]
          })
        : [],
    [enabled, wireSegments]
  )
  const visibleLayoutBlocks = [...layoutBlocks, ...generatedStubBlocks]

  if (
    !enabled ||
    (boxes.length === 0 && noteBoxes.length === 0 && visibleLayoutBlocks.length === 0)
  ) {
    return null
  }

  const blockColor = (kind: OneWireLayoutBlockKind): string => {
    switch (kind) {
      case 'main-bus':
        return '#a855f7'
      case 'supply-assembly':
        return '#22c55e'
      case 'supply-stub':
        return '#f97316'
      case 'secondary-feed':
        return '#eab308'
      case 'info-block':
        return '#3b82f6'
    }
  }

  return (
    <Group listening={false}>
      {boxes.map((box) => {
        const nested = box.depth > 0
        const color = nested ? '#f59e0b' : '#06b6d4'
        return (
          <Group key={box.id}>
            <Rect
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              fill={nested ? '#f59e0b0a' : '#06b6d40a'}
              stroke={color}
              strokeWidth={nested ? 0.8 : 1.2}
              dash={nested ? [5, 4] : undefined}
            />
            <Rect
              x={box.anchorX - 0.75}
              y={box.y}
              width={1.5}
              height={box.height}
              fill={`${color}99`}
            />
            <Text
              x={box.x + 3}
              y={box.y + 3}
              text={`${nested ? 'secondary' : 'trunk'} ${box.code}`}
              fontSize={8}
              fill={color}
              listening={false}
            />
          </Group>
        )
      })}
      {noteBoxes.map((box) => {
        const color = '#ec4899'
        return (
          <Group key={`note-${box.id}`}>
            <Rect
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              fill="#ec48990d"
              stroke={color}
              strokeWidth={1}
              dash={[3, 2]}
            />
            <Rect x={box.anchorX - 2} y={box.anchorY - 0.5} width={4} height={1} fill={color} />
            <Rect x={box.anchorX - 0.5} y={box.anchorY - 2} width={1} height={4} fill={color} />
            <Text
              x={box.x}
              y={box.y - 10}
              text={`note ${box.code} ${Math.round(box.width)}×${Math.round(box.height)}`}
              fontSize={8}
              fill={color}
              listening={false}
            />
          </Group>
        )
      })}
      {visibleLayoutBlocks.map((block) => {
        const color = blockColor(block.kind)
        return (
          <Group key={`layout-block-${block.id}`}>
            <Rect
              x={block.x}
              y={block.y}
              width={block.width}
              height={block.height}
              fill={`${color}12`}
              stroke={color}
              strokeWidth={1.2}
              dash={[6, 3]}
            />
            <Text
              x={block.x + 3}
              y={block.y + 3}
              text={`${block.label} ${Math.round(block.width)}×${Math.round(block.height)}`}
              fontSize={8}
              fill={color}
              listening={false}
            />
          </Group>
        )
      })}
    </Group>
  )
}
