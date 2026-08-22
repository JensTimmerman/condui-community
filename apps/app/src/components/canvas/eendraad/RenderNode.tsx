import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Group, Text } from 'react-konva'
import type { LayoutNode } from '@/lib/layout/layoutTree'
import { SupplySymbol } from './SupplySymbol'
import { GroundSymbol } from './GroundSymbol'
import { ProtectionSymbol } from './ProtectionSymbol'
import { EndpointSymbol } from './EndpointSymbol'
import { CircuitLabel } from './CircuitLabel'
import { PanelFrame } from './PanelFrame'
import { PanelSymbol } from './PanelSymbol'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import type { ProjectState } from '@/stores/projectStore'
import { getPanelSymbolLabel } from '@/lib/panel/panelDiagramLabels'
import { useEditionFeatureAvailability } from '@/hooks/useEditionFeatureAvailability'
import { TrunkDeviceSymbol } from './TrunkDeviceSymbol'
import { EENDRAAD_PANEL_SYMBOL_WIDTH, getEendraadPanelBodyCenterYOffset } from './canvasSymbols'
import { useThemeColors } from '@/lib/theme/hooks'
import { useCanvasFontFamily } from '@/editions/community/communityHooks'
import type { BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import {
  CIRCUIT_NOTES_FONT_SIZE,
  CIRCUIT_NOTES_LINE_HEIGHT,
  CIRCUIT_NOTES_VERTICAL_X_NUDGE,
  estimateCircuitNotesBlockHeight,
  estimateCircuitNotesRenderedWidth,
  estimateCircuitNotesWidth,
  getCircuitNotesVisualLines,
  measureCircuitNotesLineWidth,
  normalizeCircuitNotesText,
} from '@/lib/layout/circuitNoteMetrics'
import type { Endpoint, ProtectionDevice, TrunkDevice, Panel } from '@/types/schema'
import { isPanelOnlySubPanelFeeder as isPanelOnlySubPanelFeederCircuit } from '@/lib/layout/bottomUpLayout'
import type { Point } from '@/types/ui'
import { getSupplyProtectionLabelCollisionInfo } from '@/lib/eendraad/supplyProtectionLabelCollisions'
import { findPanelDistributionEndpointInCircuit } from '@/lib/eendraad/panelSupplyLink'
import { countPanelCircuits } from '@/utils/plan/placementHelpers'

function isPanelOnlySubPanelFeeder(
  protection: ProtectionDevice,
  circuitId?: string,
  targetPanel?: Panel
): boolean {
  if (!protection.subPanelId) return false
  const circuit = circuitId
    ? protection.circuits?.find((candidate) => candidate.id === circuitId)
    : targetPanel
      ? (protection.circuits?.find((candidate) =>
          findPanelDistributionEndpointInCircuit(candidate, targetPanel)
        ) ?? protection.circuits?.[0])
      : protection.circuits?.[0]
  if (!circuit) return false
  return isPanelOnlySubPanelFeederCircuit(protection, circuit)
}

interface RenderNodeProps {
  node: LayoutNode
  panelLayout?: BottomUpPanelLayout // For PanelFrame and child nodes
  allEndpoints?: Endpoint[] // For endpoint lookup (still needed for now)
  getProtectionById?: (id: string) => ProtectionDevice | undefined // For protection lookup
  getPanelById?: (id: string) => Panel | undefined // For panel lookup
  supplyProtectionCollisionIds?: Set<string>
  /** Records Alt/Option at drag start; return true to cancel Konva drag (pointer duplicate). */
  onElementDragStart?: (id: string, type: string, altKey: boolean, nativeEvt: MouseEvent) => boolean
  shouldSuppressKonvaDragEnd?: () => boolean
  /** Live drag handler used during internal 1‑draad drags (for preview). */
  onElementDragMove?: (id: string, type: string, newPos: Point) => void
  /** Drag end handler used to execute the actual move on drop. */
  onElementDragEnd?: (id: string, type: string, newPos: Point) => boolean | void
  onGroundDragEnd?: (newPos: Point) => void
  /** Convert Konva drag event to canvas position (pointer). Used so drop target uses cursor position. */
  getCanvasPositionFromEvent?: (e: unknown) => Point | null
}

/**
 * Recursive component that renders a LayoutNode and its children
 *
 * This is the unified rendering system that walks the layout tree
 * and renders the appropriate Konva components for each node type.
 */
const RenderNode = memo(function RenderNode({
  node,
  panelLayout,
  allEndpoints = [],
  getProtectionById,
  getPanelById,
  supplyProtectionCollisionIds,
  onElementDragStart,
  onElementDragMove,
  onElementDragEnd,
  shouldSuppressKonvaDragEnd,
  onGroundDragEnd,
  getCanvasPositionFromEvent,
}: RenderNodeProps) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((s: ProjectState) => s.currentProject)
  const { advancedPanelLabels } = useEditionFeatureAvailability(currentProject?.project.id)
  const resolvedSupplyProtectionCollisionIds =
    supplyProtectionCollisionIds ?? getSupplyProtectionLabelCollisionInfo(node).collisionIds

  // Render based on node type
  switch (node.type) {
    case 'panel':
      // Panel nodes wrap everything in a PanelFrame
      if (!panelLayout) return null
      return (
        <PanelFrame key={node.id} panelLayout={panelLayout}>
          <Group>
            {node.children.map((child, i) => (
              <RenderNode
                key={`${child.id}-${i}`}
                node={child}
                panelLayout={panelLayout}
                allEndpoints={allEndpoints}
                getProtectionById={getProtectionById}
                getPanelById={getPanelById}
                supplyProtectionCollisionIds={resolvedSupplyProtectionCollisionIds}
                onElementDragStart={onElementDragStart}
                onElementDragMove={onElementDragMove}
                onElementDragEnd={onElementDragEnd}
                shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
                onGroundDragEnd={onGroundDragEnd}
                getCanvasPositionFromEvent={getCanvasPositionFromEvent}
              />
            ))}
          </Group>
        </PanelFrame>
      )

    case 'supply':
      if (node.visual?.type === 'symbol' && node.visual.opacity === 0) return null
      return (
        <SupplySymbol
          key={node.id}
          x={node.bounds.x}
          y={node.bounds.y}
          panelId={panelLayout?.panel.id}
        />
      )

    case 'ground':
      return <GroundSymbol key={node.id} x={node.bounds.x} y={node.bounds.y} />

    case 'busBar':
      // Main bus or secondary bus container — visual line is rendered via wire segments
      if (!panelLayout) return null
      return (
        <Group key={node.id}>
          {node.children.map((child, i) => (
            <RenderNode
              key={`${child.id}-${i}`}
              node={child}
              panelLayout={panelLayout}
              allEndpoints={allEndpoints}
              getProtectionById={getProtectionById}
              getPanelById={getPanelById}
              supplyProtectionCollisionIds={resolvedSupplyProtectionCollisionIds}
              onElementDragStart={onElementDragStart}
              onElementDragMove={onElementDragMove}
              onElementDragEnd={onElementDragEnd}
              shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
              onGroundDragEnd={onGroundDragEnd}
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
            />
          ))}
        </Group>
      )

    case 'rcd':
    case 'mcb': {
      // Protection devices (RCD, MCB)
      if (!node.domainRef || !getProtectionById) return null
      if (node.id === 'parent-mcb') return null
      const protection = node.domainRef as ProtectionDevice
      const targetPanel =
        protection.subPanelId && getPanelById ? getPanelById(protection.subPanelId) : undefined
      const renderProtectionSymbol = !(
        (node.id.includes('-nest-') || protection.directPanelFeeder === true) &&
        isPanelOnlySubPanelFeeder(protection, node.circuitIdForWires, targetPanel)
      )
      return (
        <Group key={node.id}>
          {renderProtectionSymbol && (
            <ProtectionSymbol
              protection={protection}
              position={{ x: node.bounds.x, y: node.bounds.y }}
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
              onDragEnd={
                onElementDragEnd
                  ? (newPos) => onElementDragEnd(protection.id, 'protection', newPos)
                  : () => {}
              }
              onDragStart={
                onElementDragStart
                  ? (altKey, evt) => onElementDragStart(protection.id, 'protection', altKey, evt)
                  : undefined
              }
              shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
              onDragMove={
                onElementDragMove
                  ? (newPos) => onElementDragMove(protection.id, 'protection', newPos)
                  : undefined
              }
            />
          )}
          {!renderProtectionSymbol &&
            !node.id.includes('-nest-') &&
            !protection.directPanelFeeder && (
              <ProtectionSymbol
                protection={protection}
                position={{ x: node.bounds.x, y: node.bounds.y }}
                renderSymbol={false}
                onDragEnd={() => {}}
              />
            )}
          {node.children.map((child, i) => (
            <RenderNode
              key={`${child.id}-${i}`}
              node={child}
              panelLayout={panelLayout}
              allEndpoints={allEndpoints}
              getProtectionById={getProtectionById}
              getPanelById={getPanelById}
              supplyProtectionCollisionIds={resolvedSupplyProtectionCollisionIds}
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
              onElementDragStart={onElementDragStart}
              onElementDragMove={onElementDragMove}
              onElementDragEnd={onElementDragEnd}
              shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
              onGroundDragEnd={onGroundDragEnd}
            />
          ))}
        </Group>
      )
    }

    case 'secondaryBus':
      // Secondary bus (trunk) - rendered as wire segment, but we still need the container
      return (
        <Group key={node.id}>
          {node.children.map((child, i) => (
            <RenderNode
              key={`${child.id}-${i}`}
              node={child}
              panelLayout={panelLayout}
              allEndpoints={allEndpoints}
              getProtectionById={getProtectionById}
              getPanelById={getPanelById}
              supplyProtectionCollisionIds={resolvedSupplyProtectionCollisionIds}
              onElementDragStart={onElementDragStart}
              onElementDragMove={onElementDragMove}
              onElementDragEnd={onElementDragEnd}
              shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
              onGroundDragEnd={onGroundDragEnd}
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
            />
          ))}
        </Group>
      )

    case 'branch':
      // Branch - just a container for endpoints
      return (
        <Group key={node.id}>
          {node.children.map((child, i) => (
            <RenderNode
              key={`${child.id}-${i}`}
              node={child}
              panelLayout={panelLayout}
              allEndpoints={allEndpoints}
              getProtectionById={getProtectionById}
              getPanelById={getPanelById}
              supplyProtectionCollisionIds={resolvedSupplyProtectionCollisionIds}
              onElementDragStart={onElementDragStart}
              onElementDragMove={onElementDragMove}
              onElementDragEnd={onElementDragEnd}
              shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
              onGroundDragEnd={onGroundDragEnd}
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
            />
          ))}
        </Group>
      )

    case 'endpoint': {
      // Endpoint symbol or sub-panel symbol. A panel_distribution endpoint is the
      // canonical source-side symbol for a linked panel, so render/select it as a
      // panel symbol even when it has a real endpoint domainRef.
      if (node.visual?.type === 'symbol' && node.visual.symbolId === 'panel_distribution') {
        const visual = node.visual
        const endpoint = node.domainRef as Endpoint | undefined
        const linkedPanelId = endpoint?.panelId
        const fallbackByLabelId = visual.label
          ? panelLayout?.panel.subPanels?.find((p: Panel) => p.name === visual.label)?.id
          : undefined
        const legacyLinkedPanelId = endpoint ? undefined : node.domainId
        const resolvedSubPanelId = linkedPanelId || fallbackByLabelId || legacyLinkedPanelId
        const subPanel = resolvedSubPanelId ? getPanelById?.(resolvedSubPanelId) : undefined

        if (subPanel) {
          const feederProtectionId = node.id.startsWith('subpanel-symbol-')
            ? node.id.slice('subpanel-symbol-'.length)
            : undefined
          const isHorizontalConverterBackup = panelLayout?.circuits.some(
            ({ circuit }) =>
              circuit.supplySource?.kind === 'converter-backup' &&
              (circuit.endpoints.some((candidate) => candidate.id === endpoint?.id) ||
                panelLayout.elements.some(
                  (element) =>
                    element.type === 'protection' &&
                    element.protectionId === feederProtectionId &&
                    element.circuitId === circuit.id
                ))
          )
          const circuitCount = countPanelCircuits(subPanel)
          const nextColumnX = (() => {
            if (!panelLayout) return null
            const trunkXs = Array.from(
              new Set(panelLayout.branches.map((branch) => Math.round(branch.trunkX)))
            ).sort((a, b) => a - b)
            return trunkXs.find((x) => x > node.bounds.x + 1) ?? null
          })()
          const labelStartX = node.bounds.x + EENDRAAD_PANEL_SYMBOL_WIDTH / 2 + 5
          const maxLabelWidth =
            nextColumnX != null
              ? Math.max(40, nextColumnX - labelStartX - 8)
              : Math.max(80, panelLayout!.frame.x + panelLayout!.frame.width - labelStartX - 12)

          const panelName =
            currentProject != null
              ? getPanelSymbolLabel(currentProject, subPanel, advancedPanelLabels)
              : subPanel.name || visual.label || endpoint?.label || ''

          return (
            <PanelSymbol
              key={node.id}
              position={{
                x: node.bounds.x,
                y:
                  node.bounds.y -
                  (isHorizontalConverterBackup ? getEendraadPanelBodyCenterYOffset() : 0),
              }}
              panelName={panelName}
              subPanelId={subPanel.id}
              circuitCount={circuitCount}
              symbolLabelDisplay={subPanel.symbolLabelDisplay}
              maxLabelWidth={isHorizontalConverterBackup ? 120 : maxLabelWidth}
              labelPosition={isHorizontalConverterBackup ? 'top' : 'right'}
              onDragStart={
                onElementDragStart
                  ? (altKey, event) =>
                      onElementDragStart(subPanel.id, 'panelAttachment', altKey, event)
                  : undefined
              }
              onDragMove={
                onElementDragMove
                  ? (position) => onElementDragMove(subPanel.id, 'panelAttachment', position)
                  : undefined
              }
              onDragEnd={
                onElementDragEnd
                  ? (position) => onElementDragEnd(subPanel.id, 'panelAttachment', position)
                  : undefined
              }
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
            />
          )
        }
      }

      // Regular endpoint symbol
      if (!node.domainRef) return null
      const endpoint = node.domainRef as Endpoint
      // Find full endpoint data (includes placements, etc.)
      const fullEndpoint = allEndpoints.find((e) => e.id === endpoint.id) || endpoint
      // Only the domotica parent module is non-draggable.
      // Domotica child endpoints must stay draggable so users can pull them back out.
      const canDragEndpoint = fullEndpoint.symbol !== 'domotica'
      return (
        <EndpointSymbol
          key={node.id}
          endpoint={fullEndpoint}
          position={{ x: node.bounds.x, y: node.bounds.y }}
          onDragMove={
            onElementDragMove
              ? (newPos) => onElementDragMove(endpoint.id, 'endpoint', newPos)
              : undefined
          }
          onDragEnd={
            onElementDragEnd
              ? (newPos) => onElementDragEnd(endpoint.id, 'endpoint', newPos)
              : () => {}
          }
          onDragStart={
            onElementDragStart
              ? (altKey, evt) => onElementDragStart(endpoint.id, 'endpoint', altKey, evt)
              : undefined
          }
          shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
          // Allow dragging for internal 1‑draad moves; EndpointSymbol will still gate
          // this by selection so only selected endpoints are actually draggable.
          draggable={canDragEndpoint}
          getCanvasPositionFromEvent={getCanvasPositionFromEvent}
          isEndpointAtBranchEnd={
            node.visual?.type === 'symbol' ? node.visual.isEndpointAtBranchEnd : undefined
          }
          mirrorHorizontally={
            node.visual?.type === 'symbol' ? node.visual.mirrorHorizontally : undefined
          }
          bottomLabelMinimumLeftX={
            node.visual?.type === 'symbol' ? node.visual.bottomLabelMinimumLeftX : undefined
          }
          bottomLabelMaximumRightX={
            node.visual?.type === 'symbol' ? node.visual.bottomLabelMaximumRightX : undefined
          }
        />
      )
    }

    case 'trunkDevice': {
      // Trunk device symbol (energy meter, protection, etc.)
      if (!node.domainRef) return null
      const trunkDevice = node.domainRef as unknown as TrunkDevice
      // Supply trunk devices have IDs starting with 'supplyTrunkDevice-' and are on horizontal wire
      const isSupplyTrunkDevice = node.id?.startsWith('supplyTrunkDevice-')
      const isVerticalSupplyBranchDevice =
        isSupplyTrunkDevice &&
        trunkDevice.supplyPath === 'converter-grid' &&
        trunkDevice.converterGridPlacement === 'input-leg'
      const isSubPanelSupplyTrunkDevice = node.id?.startsWith('subpanelSupplyTrunkDevice-')
      const isGroundTrunkDevice = node.id?.startsWith('groundTrunkDevice-')
      const isDraggableTrunkDevice = !isGroundTrunkDevice
      return (
        <TrunkDeviceSymbol
          key={node.id}
          device={trunkDevice}
          position={{ x: node.bounds.x, y: node.bounds.y }}
          supplyDevicePositions={panelLayout?.supplyDevices}
          isHorizontal={isSupplyTrunkDevice && !isVerticalSupplyBranchDevice}
          protectionLabelPosition={isVerticalSupplyBranchDevice ? 'right' : undefined}
          showDeviceLabelLeft={isSubPanelSupplyTrunkDevice}
          splitProtectionResidualLine={
            isSupplyTrunkDevice && resolvedSupplyProtectionCollisionIds.has(node.id)
          }
          getCanvasPositionFromEvent={getCanvasPositionFromEvent}
          onDragMove={
            isDraggableTrunkDevice && onElementDragMove
              ? (p) => onElementDragMove(trunkDevice.id, 'trunkDevice', p)
              : undefined
          }
          onDragStart={
            isDraggableTrunkDevice && onElementDragStart
              ? (altKey, nativeEvt) =>
                  onElementDragStart(trunkDevice.id, 'trunkDevice', altKey, nativeEvt)
              : undefined
          }
          shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
          onDragEnd={
            isDraggableTrunkDevice && onElementDragEnd
              ? (p) => onElementDragEnd(trunkDevice.id, 'trunkDevice', p)
              : undefined
          }
          draggableCircuitTrunk={isDraggableTrunkDevice}
        />
      )
    }

    case 'label':
      // Circuit labels and other text labels. Wrapped in Group so export can strip them
      // and redraw on top of each slice (labels are added in a post-process pass).
      if (node.visual?.type === 'label') {
        if (node.visual.variant === 'circuit-notes') {
          return (
            <Group key={node.id} name="export-strip-label">
              <CircuitNotesLabel node={node} />
            </Group>
          )
        }
        const isSupplyFeedLabel =
          node.id === 'supply-continuation-label' || node.id === 'feed-output-label'
        const selectSupply = isSupplyFeedLabel
          ? (event: { cancelBubble: boolean }) => {
              event.cancelBubble = true
              useUIStore.getState().setSelection({
                type: 'supply',
                ids: ['supply'],
                supplyPanelId: panelLayout?.panel.id,
              })
            }
          : undefined
        return (
          <Group
            key={node.id}
            name="export-strip-label"
            onClick={selectSupply}
            onTap={selectSupply}
          >
            <CircuitLabel
              x={node.bounds.x}
              y={node.bounds.y}
              label={
                node.visual.translationKey
                  ? t(node.visual.translationKey, node.visual.text)
                  : node.visual.text
              }
              align={node.visual.align}
            />
          </Group>
        )
      }
      return null

    default:
      // Unknown node type - just render children
      return (
        <Group key={node.id}>
          {node.children.map((child, i) => (
            <RenderNode
              key={`${child.id}-${i}`}
              node={child}
              panelLayout={panelLayout}
              allEndpoints={allEndpoints}
              getProtectionById={getProtectionById}
              getPanelById={getPanelById}
              supplyProtectionCollisionIds={resolvedSupplyProtectionCollisionIds}
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
              onElementDragStart={onElementDragStart}
              onElementDragMove={onElementDragMove}
              onElementDragEnd={onElementDragEnd}
              shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
              onGroundDragEnd={onGroundDragEnd}
            />
          ))}
        </Group>
      )
  }
})

export default RenderNode

/**
 * Circuit notes label component (italic, gray styling).
 * Supports horizontal or vertical (90° rotated) orientation.
 * When notesVisible is false, nothing is drawn (slot still reserved for layout).
 */
function CircuitNotesLabel({ node }: { node: LayoutNode }) {
  const colors = useThemeColors()
  const fontFamily = useCanvasFontFamily()
  const textColor = colors.secondaryText
  const notesText = normalizeCircuitNotesText(
    node.visual?.type === 'label' ? node.visual.text : ''
  )
  const orientation =
    node.visual?.type === 'label' ? (node.visual.notesOrientation ?? 'horizontal') : 'horizontal'
  const notesVisible = node.visual?.type === 'label' ? node.visual.notesVisible !== false : true

  if (!notesVisible) {
    return null
  }

  const isVertical = orientation === 'vertical'
  const fontSize = CIRCUIT_NOTES_FONT_SIZE
  const lineHeight = CIRCUIT_NOTES_LINE_HEIGHT

  // Both orientations use one shared text block. Rotating it swaps its painted
  // width and height, so multiline vertical notes become wider columns.
  const hWidth = estimateCircuitNotesRenderedWidth(notesText, fontFamily, fontSize)
  const visualLines = getCircuitNotesVisualLines(
    notesText,
    fontFamily,
    fontSize,
    estimateCircuitNotesWidth(notesText, fontFamily, fontSize)
  )
  const blockHeight = estimateCircuitNotesBlockHeight(
    notesText,
    fontFamily,
    fontSize,
    lineHeight
  )
  let rotation = 0

  if (isVertical) {
    // Vertical: rotate -90°. We want the *visual* centre of the rendered text
    // (including glyph ascenders/descenders) to stay on the original wire
    // anchor. The Konva Text is rotated around the Group origin, so we:
    // - keep the group's X at the node centre
    // - shift the group's Y up by half the horizontal width so the rotated
    //   box sits symmetrically around the anchor.
    rotation = -90
  }

  const groupX = node.bounds.x + (isVertical ? CIRCUIT_NOTES_VERTICAL_X_NUDGE : 0)
  const groupY = isVertical ? node.bounds.y - hWidth / 2 : node.bounds.y
  const textY = isVertical ? -blockHeight / 2 : -blockHeight + lineHeight / 2

  return (
    <Group x={groupX} y={groupY} offsetX={0} offsetY={0} rotation={rotation}>
      {visualLines.map((line, index) => {
        const lineWidth = measureCircuitNotesLineWidth(line, fontFamily, fontSize)
        return (
          <Text
            key={`${index}-${line}`}
            x={-lineWidth / 2}
            y={textY + index * lineHeight}
            width={lineWidth}
            text={line}
            fontSize={fontSize}
            fontFamily={fontFamily}
            fontStyle="italic"
            fill={textColor}
            align="left"
            wrap="none"
            listening={false}
          />
        )
      })}
    </Group>
  )
}
