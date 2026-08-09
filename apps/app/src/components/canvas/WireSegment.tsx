import { logger } from '@/lib/logger'
/**
 * Wire Segment Component
 *
 * Renders a selectable wire segment with properties
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Line, Group, Circle, Image, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useThemeColors } from '@/lib/theme/hooks'
import { useIsPreviewSelected } from '@/contexts/SelectionPreviewContext'
import {
  useCanvasFontFamily,
  useEffectiveCanvasZoom,
  useIsWireSelected,
  useSetSelection,
} from '@/editions/community/communityHooks'
import type { WireSegment } from '@/types/schema'
import { WireTextLabel } from '@/components/canvas/eendraad/WireTextLabel'
import { SELECTION_COLOR } from '@/components/canvas/eendraad/canvasSymbols'
import {
  ZOOM_100,
  screenPxToCanvasUnits,
  HOVER_OUTLINE_DASH_PX,
  HOVER_OUTLINE_DASH_PX_MIN,
  HOVER_OUTLINE_DASH_PX_MAX,
  HOVER_OUTLINE_STROKE_PX,
  HOVER_OUTLINE_STROKE_PX_MIN,
  HOVER_OUTLINE_STROKE_PX_MAX,
  WIRE_SELECTION_EXTRA_PX,
  WIRE_SELECTION_EXTRA_PX_MIN,
  WIRE_SELECTION_EXTRA_PX_MAX,
} from '@/constants/canvasConstants'
import {
  isBusBarProtectionStubSegment,
  isFireClassLabelVisibleForSegment,
  isRouteIndicatorVisibleForSegment,
  isWireLabelVisibleForSegment,
  isWireLengthLabelVisibleForSegment,
} from '@/lib/wireLabelVisibility'
import { getWireLengthLabel } from '@/lib/wires/wireFingerprint'
import { getDomainForSymbol, getSymbolById } from '@/lib/symbols'
import { loadProcessedSymbol } from '@/lib/symbolImage'
import {
  WIRE_LABEL_DISTANCE_FROM_WIRE,
  WIRE_LABEL_FONT_SIZE,
  formatWireLabel,
  getWireFireClassLabel,
  getWireLabelAlignForSegment,
  getWireLabelOffsetAlongWire,
  getWireLabelOrientationForSegment,
  getSupplyWireLabelAnchor,
} from '@/lib/wireTextLabel'
import type { WireTranslateFn } from '@/lib/wires/wireFingerprint'
import { shouldShowDomainChangeMarker } from '@/lib/wires/domainChangeMarker'
import { getElectricalInstallationFromProject } from '@/lib/projectV2/electrical'
import {
  getPhaseAssignmentLabel,
  isPhaseAssignmentLabelVisible,
} from '@/lib/wires/phaseAssignment'

type WireSegmentPointerEvent = KonvaEventObject<MouseEvent | TouchEvent>

/** E-shape line geometry for wall route (in-wall): vertical left, 3 horizontals right. Drawn once, reused above/below; on-wall = 180° rotation. */
const WALL_ROUTE_LINES: Array<[number, number, number, number]> = [
  [0, -6, 0, 6], // vertical
  [0, -6, 6, -6], // top horizontal
  [0, 0, 6, 0], // middle
  [0, 6, 6, 6], // bottom
]

interface WireSegmentProps {
  wireSegment: WireSegment
  onSelect?: (wireSegmentId: string) => void
}

const LocalizedWireTextLabel = memo(function LocalizedWireTextLabel({
  wireSegment,
  wireLabelOffsetAlongWire,
  fontFamily,
  color,
  onLabelClick,
  onLabelMouseEnter,
  onLabelMouseLeave,
}: {
  wireSegment: WireSegment
  wireLabelOffsetAlongWire: number
  fontFamily: string
  color: string
  onLabelClick: (event: unknown) => void
  onLabelMouseEnter: () => void
  onLabelMouseLeave: () => void
}) {
  const { t } = useTranslation()
  const translateWire = t as unknown as WireTranslateFn

  return (
    <WireTextLabel
      text={formatWireLabel(wireSegment, {
        otherLabel: t('wires.other', 'Other'),
      })}
      fireClassText={
        isFireClassLabelVisibleForSegment(wireSegment)
          ? getWireFireClassLabel(wireSegment.cable)
          : undefined
      }
      wireLengthText={
        isWireLengthLabelVisibleForSegment(wireSegment)
          ? getWireLengthLabel(wireSegment, translateWire)
          : undefined
      }
      startPoint={wireSegment.startPoint}
      endPoint={wireSegment.wireLabelEndPoint ?? wireSegment.endPoint}
      config={{
        orientation: getWireLabelOrientationForSegment(wireSegment),
        align: getWireLabelAlignForSegment(wireSegment),
        distanceFromWire: WIRE_LABEL_DISTANCE_FROM_WIRE,
        offsetAlongWire: wireLabelOffsetAlongWire,
        labelAnchor: getSupplyWireLabelAnchor(wireSegment),
      }}
      fontSize={WIRE_LABEL_FONT_SIZE}
      fontFamily={fontFamily}
      color={color}
      onLabelClick={onLabelClick}
      onLabelMouseEnter={onLabelMouseEnter}
      onLabelMouseLeave={onLabelMouseLeave}
    />
  )
})

export const WireSegmentComponent = memo(function WireSegmentComponent({
  wireSegment,
  onSelect,
}: WireSegmentProps) {
  const setSelection = useSetSelection()
  const isSelected = useIsWireSelected(wireSegment.id)
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const isExporting = useUIStore((s) => s.isExporting)
  const theme = useSettingsStore((state) => state.theme)
  const colors = useThemeColors()
  const fontFamily = useCanvasFontFamily()
  const isPreviewSelected = useIsPreviewSelected('wire', wireSegment.id)
  const { currentProject, getEndpointById, getTrunkDeviceById, getProtectionById } =
    useProjectStore()
  const [acSymbolImage, setAcSymbolImage] = useState<HTMLImageElement | null>(null)
  const [dcSymbolImage, setDcSymbolImage] = useState<HTMLImageElement | null>(null)
  const [isHovered, setIsHovered] = useState(false)

  // Determine line properties based on wire type
  const isBusBar = wireSegment.type === 'mainBus'
  const isThick = wireSegment.type === 'trunk' || isBusBar
  const lineWidth = isThick ? 6 : 2
  const lineCap: 'butt' | 'round' = isBusBar ? 'round' : 'butt'
  const lineColor = colors.wireColor

  // Bus bars (mainBus type) are not selectable - they don't need wire properties

  const selectedColor = colors.selectionColor
  const previewColor = colors.selectionColor
  const wireSelectionExtra = screenPxToCanvasUnits(
    canvasZoom,
    WIRE_SELECTION_EXTRA_PX,
    WIRE_SELECTION_EXTRA_PX_MIN,
    WIRE_SELECTION_EXTRA_PX_MAX
  )
  const wireSelectionStroke = lineWidth + wireSelectionExtra
  const wireHoverStroke = screenPxToCanvasUnits(
    canvasZoom,
    HOVER_OUTLINE_STROKE_PX,
    HOVER_OUTLINE_STROKE_PX_MIN,
    HOVER_OUTLINE_STROKE_PX_MAX
  )
  const wireHoverDash = screenPxToCanvasUnits(
    canvasZoom,
    HOVER_OUTLINE_DASH_PX,
    HOVER_OUTLINE_DASH_PX_MIN,
    HOVER_OUTLINE_DASH_PX_MAX
  )

  const wireMeta = useCallback(
    () => ({
      id: wireSegment.id,
      // Persist only segment kinds relevant for re-matching in properties.
      type: wireSegment.type === 'secondaryBus' ? 'mainBus' : wireSegment.type,
      domain: wireSegment.domain,
      circuitId: wireSegment.circuitId,
      panelId: wireSegment.panelId,
      isSupply:
        (wireSegment.type === 'vertical' &&
          !wireSegment.circuitId &&
          !wireSegment.fromElementType) ||
        !!wireSegment.isSupplyTrunk,
      isGround: wireSegment.fromElementType === 'ground',
      ...(wireSegment.supplyWireRole && { supplyWireRole: wireSegment.supplyWireRole }),
      ...(wireSegment.supplyFeedScope && { supplyFeedScope: wireSegment.supplyFeedScope }),
      ...(wireSegment.isSupplyTrunk &&
        wireSegment.supplySegmentIndex !== undefined && {
          supplySegmentIndex: wireSegment.supplySegmentIndex,
        }),
      ...(wireSegment.circuitId && {
        fromElementType: wireSegment.fromElementType,
        fromElementId: wireSegment.fromElementId,
        toElementType: wireSegment.toElementType,
        toElementId: wireSegment.toElementId,
      }),
      ...(wireSegment.feederProtectionId && { feederProtectionId: wireSegment.feederProtectionId }),
      ...(wireSegment.showWireLabelOnBusStub && { showWireLabelOnBusStub: true as const }),
      ...(wireSegment.domoticaOutputGroup &&
        typeof wireSegment.domoticaOutputIndex === 'number' && {
          domoticaOutputGroup: wireSegment.domoticaOutputGroup,
          domoticaOutputIndex: wireSegment.domoticaOutputIndex,
        }),
    }),
    [
      wireSegment.id,
      wireSegment.type,
      wireSegment.domain,
      wireSegment.circuitId,
      wireSegment.panelId,
      wireSegment.isSupplyTrunk,
      wireSegment.supplyWireRole,
      wireSegment.supplyFeedScope,
      wireSegment.supplySegmentIndex,
      wireSegment.fromElementType,
      wireSegment.fromElementId,
      wireSegment.toElementType,
      wireSegment.toElementId,
      wireSegment.feederProtectionId,
      wireSegment.domoticaOutputGroup,
      wireSegment.domoticaOutputIndex,
      wireSegment.showWireLabelOnBusStub,
    ]
  )

  const handleClick = useCallback(
    (e: unknown) => {
      const event = e as WireSegmentPointerEvent
      // Bus bars are not selectable
      if (isBusBar) {
        return
      }
      event.cancelBubble = true

      // Debug logging: inspect exact geometry & metadata for the clicked wire
      // to investigate layout issues (e.g. short stubs above trunk devices).
      // This only runs on user click, so it won't spam the console.

      logger.info('[Eendraad Wire Debug]', {
        id: wireSegment.id,
        type: wireSegment.type,
        startPoint: wireSegment.startPoint,
        endPoint: wireSegment.endPoint,
        circuitId: wireSegment.circuitId,
        panelId: wireSegment.panelId,
        fromElementType: wireSegment.fromElementType,
        fromElementId: wireSegment.fromElementId,
        toElementType: wireSegment.toElementType,
        toElementId: wireSegment.toElementId,
        domain: wireSegment.domain,
        isSupplyTrunk: wireSegment.isSupplyTrunk,
        supplySegmentIndex: wireSegment.supplySegmentIndex,
      })
      logger.info('[Wire Selection Debug][manual click]', {
        id: wireSegment.id,
        type: wireSegment.type,
        domain: wireSegment.domain,
        circuitId: wireSegment.circuitId,
        panelId: wireSegment.panelId,
        fromElementType: wireSegment.fromElementType,
        fromElementId: wireSegment.fromElementId,
        toElementType: wireSegment.toElementType,
        toElementId: wireSegment.toElementId,
        startPoint: wireSegment.startPoint,
        endPoint: wireSegment.endPoint,
        selectionMetadata: wireMeta(),
      })

      if ('shiftKey' in event.evt && event.evt.shiftKey) {
        // Add to selection
        const { selection } = useUIStore.getState()
        if (selection.type === 'wire' && !selection.ids.includes(wireSegment.id)) {
          setSelection({
            type: 'wire',
            ids: [...selection.ids, wireSegment.id],
            wireMetadata: [...(selection.wireMetadata || []), wireMeta()],
          })
        } else if (selection.type !== 'wire') {
          setSelection({ type: 'wire', ids: [wireSegment.id], wireMetadata: [wireMeta()] })
        }
      } else if (
        ('altKey' in event.evt && event.evt.altKey) ||
        ('ctrlKey' in event.evt && event.evt.ctrlKey) ||
        ('metaKey' in event.evt && event.evt.metaKey)
      ) {
        // Remove from selection
        const { selection } = useUIStore.getState()
        if (selection.type === 'wire' && selection.ids.includes(wireSegment.id)) {
          const newIds = selection.ids.filter((id) => id !== wireSegment.id)
          if (newIds.length === 0) {
            useUIStore.getState().clearSelection()
          } else {
            setSelection({ type: 'wire', ids: newIds })
          }
        }
      } else {
        setSelection({ type: 'wire', ids: [wireSegment.id], wireMetadata: [wireMeta()] })
        if (onSelect) {
          onSelect(wireSegment.id)
        }
      }
    },
    [wireSegment, setSelection, onSelect, isBusBar, wireMeta]
  )

  const handleMouseEnter = useCallback(() => {
    if (!isBusBar) setIsHovered(true)
  }, [isBusBar])

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false)
  }, [])

  const wireLinePoints = [
    wireSegment.startPoint.x,
    wireSegment.startPoint.y,
    wireSegment.endPoint.x,
    wireSegment.endPoint.y,
  ]
  const showHoverHighlight = !isBusBar && isHovered && !isSelected && !isPreviewSelected

  // Calculate hit area (expand for easier clicking)
  const hitAreaPadding = 5
  const isHorizontal = wireSegment.startPoint.y === wireSegment.endPoint.y
  const isVertical = wireSegment.startPoint.x === wireSegment.endPoint.x
  const isBusBarProtectionStub = isBusBarProtectionStubSegment(wireSegment)
  const isWireLabelVisible = isWireLabelVisibleForSegment(wireSegment)
  const wireLabelOffsetAlongWire = getWireLabelOffsetAlongWire(wireSegment)
  const showCableLabel =
    (!isBusBarProtectionStub || wireSegment.showWireLabelOnBusStub) && isWireLabelVisible
  const showVerticalRouteIndicators = isRouteIndicatorVisibleForSegment(wireSegment)
  const secondaryBusReferenceLabel = wireSegment.secondaryBusReferenceLabel?.trim()
  const secondaryBusReferenceFontSize = 8
  const secondaryBusReferenceTextWidth = secondaryBusReferenceLabel
    ? Math.max(10, secondaryBusReferenceLabel.length * secondaryBusReferenceFontSize * 0.62)
    : 0
  const secondaryBusReferenceTextLeft = -secondaryBusReferenceTextWidth
  const secondaryBusReferenceTextCenterY = secondaryBusReferenceFontSize / 2
  const secondaryBusArrowRightX = secondaryBusReferenceTextLeft - 7
  const secondaryBusArrowTipX = secondaryBusArrowRightX - 22
  const secondaryBusArrowHeadHalfHeight = 3
  const route = wireSegment.wireRoute
  const inWall = wireSegment.inWall === true
  const effectiveRoute: 'inWall' | 'onWall' | 'ground' | 'air' | undefined =
    route === 'ground'
      ? 'ground'
      : route === 'air'
        ? 'air'
        : route === 'wall'
          ? inWall
            ? 'inWall'
            : 'onWall'
          : undefined
  const centeredIndicatorY = (wireSegment.endPoint.y - wireSegment.startPoint.y) / 2 + 10
  const fromTrunkDevice = wireSegment.fromElementId
    ? getTrunkDeviceById(wireSegment.fromElementId)
    : undefined
  const fromEndpoint =
    wireSegment.fromElementType === 'endpoint' && wireSegment.fromElementId
      ? getEndpointById(wireSegment.fromElementId)
      : undefined
  const fromDeviceSymbolId = fromTrunkDevice?.device.symbol ?? fromEndpoint?.symbol
  const fromDeviceSymbol = fromDeviceSymbolId ? getSymbolById(fromDeviceSymbolId) : null
  const fromDeviceDomainInfo = fromDeviceSymbol ? getDomainForSymbol(fromDeviceSymbol.id) : null
  const isFromConversionDevice =
    !!fromDeviceDomainInfo && fromDeviceDomainInfo.inputDomain !== fromDeviceDomainInfo.outputDomain
  const showDomainChangeLabel = fromTrunkDevice
    ? fromTrunkDevice.device.showDomainChangeLabel !== false
    : true
  const domainLabelText: 'AC' | 'DC' = wireSegment.domain === 'DC' ? 'DC' : 'AC'
  const isTrunkConversionOutput = !!fromTrunkDevice
  const isBranchConversionOutput = !!fromEndpoint
  const shouldDrawDomainLabelOnWire = shouldShowDomainChangeMarker(
    wireSegment,
    fromTrunkDevice ? 'trunkDevice' : fromEndpoint ? 'endpoint' : undefined,
    isFromConversionDevice,
    showDomainChangeLabel
  )
  const phaseSystem = currentProject
    ? getElectricalInstallationFromProject(currentProject)?.nominalVoltage.system
    : undefined
  const isSubPanelIncomingPhaseSegment =
    wireSegment.isSubPanelSupply === true &&
    wireSegment.fromElementId === wireSegment.feederProtectionId
  const isRootSupplyPhaseSegment =
    wireSegment.supplyWireRole === 'downstream' &&
    wireSegment.supplyFeedScope === 'root' &&
    !wireSegment.circuitId
  const incomingPanelPhaseLabel =
    (isSubPanelIncomingPhaseSegment || isRootSupplyPhaseSegment) &&
    phaseSystem &&
    isPhaseAssignmentLabelVisible(
      wireSegment.phaseAssignment,
      phaseSystem,
      wireSegment.showPhaseLabel
    ) &&
    isVertical
      ? getPhaseAssignmentLabel(wireSegment.phaseAssignment, phaseSystem)
      : undefined
  const incomingPanelPhaseLabelWidth = 48
  const incomingPanelPhaseLabelY =
    Math.max(wireSegment.startPoint.y, wireSegment.endPoint.y) +
    (isRootSupplyPhaseSegment ? 4 : -10)
  const isProtectionInputPhaseSegment =
    wireSegment.type === 'vertical' &&
    !!wireSegment.circuitId &&
    wireSegment.toElementType === 'protection'
  const protectionPhaseLabel =
    isProtectionInputPhaseSegment &&
    phaseSystem &&
    isPhaseAssignmentLabelVisible(
      wireSegment.phaseAssignment,
      phaseSystem,
      wireSegment.showPhaseLabel
    )
      ? getPhaseAssignmentLabel(wireSegment.phaseAssignment, phaseSystem)
      : undefined
  const protectionPhaseLabelWidth = 48
  const protectionPhaseLabelOffsetY =
    getProtectionById(wireSegment.toElementId ?? '')?.type === 'SPD' ? 14 : 4

  const isDark = theme?.mode === 'dark'
  useEffect(() => {
    if (!shouldDrawDomainLabelOnWire) {
      setAcSymbolImage(null)
      setDcSymbolImage(null)
      return
    }
    loadProcessedSymbol('/symbols/energy-conversion/symbol_AC.svg', isDark)
      .then(setAcSymbolImage)
      .catch(() => setAcSymbolImage(null))
    loadProcessedSymbol('/symbols/energy-conversion/symbol_DC.svg', isDark)
      .then(setDcSymbolImage)
      .catch(() => setDcSymbolImage(null))
  }, [isDark, shouldDrawDomainLabelOnWire])

  const domainIconImage = domainLabelText === 'DC' ? dcSymbolImage : acSymbolImage
  const domainLabelOffsetX = isTrunkConversionOutput && isWireLabelVisible ? 10 : 0
  const domainLabelX =
    wireSegment.startPoint.x + (isBranchConversionOutput ? 7 : 10) + domainLabelOffsetX
  const domainLabelY = wireSegment.startPoint.y - 4
  const domainIconSize = 11

  let hitArea: { x: number; y: number; width: number; height: number } | null = null

  if (isHorizontal) {
    const minX = Math.min(wireSegment.startPoint.x, wireSegment.endPoint.x)
    const maxX = Math.max(wireSegment.startPoint.x, wireSegment.endPoint.x)
    hitArea = {
      x: minX - hitAreaPadding,
      y: wireSegment.startPoint.y - hitAreaPadding,
      width: maxX - minX + hitAreaPadding * 2,
      height: lineWidth + hitAreaPadding * 2,
    }
  } else if (isVertical) {
    const minY = Math.min(wireSegment.startPoint.y, wireSegment.endPoint.y)
    const maxY = Math.max(wireSegment.startPoint.y, wireSegment.endPoint.y)
    hitArea = {
      x: wireSegment.startPoint.x - hitAreaPadding,
      y: minY - hitAreaPadding,
      width: lineWidth + hitAreaPadding * 2,
      height: maxY - minY + hitAreaPadding * 2,
    }
  }

  return (
    <Group name={`wire-${wireSegment.id}`}>
      {/* Main wire line */}
      <Line
        points={wireLinePoints}
        stroke={isSelected ? selectedColor : isPreviewSelected ? previewColor : lineColor}
        strokeWidth={isSelected || isPreviewSelected ? wireSelectionStroke : lineWidth}
        lineCap={lineCap}
        lineJoin="round"
        onClick={isBusBar ? undefined : handleClick}
        onTap={isBusBar ? undefined : handleClick}
        onMouseEnter={isBusBar ? undefined : handleMouseEnter}
        onMouseLeave={isBusBar ? undefined : handleMouseLeave}
        listening={!isBusBar}
      />

      {!isExporting && secondaryBusReferenceLabel && isHorizontal && (
        <Group x={wireSegment.endPoint.x} y={wireSegment.endPoint.y + 10} listening={false}>
          <Line
            points={[
              secondaryBusArrowRightX,
              secondaryBusReferenceTextCenterY,
              secondaryBusArrowTipX + 2,
              secondaryBusReferenceTextCenterY,
            ]}
            stroke={colors.wireColor}
            strokeWidth={1.2}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
          <Line
            points={[
              secondaryBusArrowTipX,
              secondaryBusReferenceTextCenterY,
              secondaryBusArrowTipX + 6,
              secondaryBusReferenceTextCenterY - secondaryBusArrowHeadHalfHeight,
            ]}
            stroke={colors.wireColor}
            strokeWidth={1.2}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
          <Line
            points={[
              secondaryBusArrowTipX,
              secondaryBusReferenceTextCenterY,
              secondaryBusArrowTipX + 6,
              secondaryBusReferenceTextCenterY + secondaryBusArrowHeadHalfHeight,
            ]}
            stroke={colors.wireColor}
            strokeWidth={1.2}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
          <Text
            x={secondaryBusReferenceTextLeft}
            y={0}
            width={secondaryBusReferenceTextWidth}
            text={secondaryBusReferenceLabel}
            fontSize={secondaryBusReferenceFontSize}
            fontFamily={fontFamily}
            fill={colors.wireColor}
            align="right"
            listening={false}
          />
        </Group>
      )}

      {/* Invisible hit area for easier clicking - only for non-bus bars */}
      {hitArea && !isBusBar && (
        <Line
          points={wireLinePoints}
          stroke="transparent"
          strokeWidth={Math.max(lineWidth + hitAreaPadding * 2, 10)}
          lineCap="round"
          lineJoin="round"
          onClick={handleClick}
          onTap={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          listening={true}
        />
      )}

      {/* Hover highlight — dashed yellow line, matches selectable symbol hover */}
      {showHoverHighlight && (
        <Line
          points={wireLinePoints}
          stroke={SELECTION_COLOR}
          strokeWidth={wireHoverStroke}
          dash={[wireHoverDash, wireHoverDash]}
          lineCap={lineCap}
          lineJoin="round"
          listening={false}
        />
      )}

      {/* Cable label (vertical circuit wires, supply trunk, main supply drop) */}
      {showCableLabel && (
        <LocalizedWireTextLabel
          wireSegment={wireSegment}
          wireLabelOffsetAlongWire={wireLabelOffsetAlongWire}
          fontFamily={fontFamily}
          color={colors.wireColor}
          onLabelClick={handleClick}
          onLabelMouseEnter={handleMouseEnter}
          onLabelMouseLeave={handleMouseLeave}
        />
      )}

      {incomingPanelPhaseLabel && isVertical && (
        <Group
          x={wireSegment.startPoint.x}
          y={incomingPanelPhaseLabelY}
          name="export-strip-label"
          onClick={handleClick}
          onTap={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <Text
            x={isRootSupplyPhaseSegment ? 5 : -incomingPanelPhaseLabelWidth - 5}
            y={0}
            width={incomingPanelPhaseLabelWidth}
            text={incomingPanelPhaseLabel}
            fontSize={8}
            fontFamily={fontFamily}
            fill={colors.wireColor}
            align={isRootSupplyPhaseSegment ? 'left' : 'right'}
          />
        </Group>
      )}

      {protectionPhaseLabel && (
        <Group
          x={wireSegment.endPoint.x}
          y={wireSegment.endPoint.y + protectionPhaseLabelOffsetY}
          name="export-strip-label"
          onClick={handleClick}
          onTap={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <Text
            x={-protectionPhaseLabelWidth - 3}
            y={0}
            width={protectionPhaseLabelWidth}
            text={protectionPhaseLabel}
            fontSize={8}
            fontFamily={fontFamily}
            fill={colors.wireColor}
            align="right"
          />
        </Group>
      )}

      {/* Route indicators (tube, wall, air, ground) — vertical circuit wires only */}
      {showVerticalRouteIndicators && (
        <>
          <Group x={wireSegment.startPoint.x} y={wireSegment.startPoint.y - 10} rotation={0}>
            {/* In Tube indicator - Circle (75% size, shifted right so right edge stays at wire) */}
            {wireSegment.inTube && (
              <Circle
                x={effectiveRoute === 'air' ? -8 : -6}
                y={effectiveRoute === 'ground' ? centeredIndicatorY + 7 : centeredIndicatorY}
                radius={3}
                stroke={colors.wireColor}
                strokeWidth={1}
                listening={false}
              />
            )}

            {/* Route indicator: exactly one of none, inWall, onWall, ground, air. Mutually exclusive. */}
            {(() => {
              const thickness = 1.5
              if (effectiveRoute === 'ground') {
                return (
                  <Group
                    x={-6.5}
                    y={wireSegment.inTube ? centeredIndicatorY - 7 : centeredIndicatorY}
                    scaleX={0.75}
                    scaleY={0.75}
                    rotation={-90}
                  >
                    <Line
                      points={[-8, -4, 8, -4]}
                      stroke={colors.wireColor}
                      strokeWidth={thickness}
                      lineCap="round"
                      listening={false}
                    />
                    <Line
                      points={[-4, 0, 4, 0]}
                      stroke={colors.wireColor}
                      strokeWidth={thickness}
                      lineCap="round"
                      listening={false}
                    />
                    <Line
                      points={[-2, 4, 2, 4]}
                      stroke={colors.wireColor}
                      strokeWidth={thickness}
                      lineCap="round"
                      listening={false}
                    />
                  </Group>
                )
              }
              if (effectiveRoute === 'air') {
                return (
                  <>
                    <Circle
                      x={0}
                      y={centeredIndicatorY}
                      radius={3.5}
                      stroke={colors.wireColor}
                      strokeWidth={thickness * 0.75}
                      listening={false}
                    />
                  </>
                )
              }
              if (effectiveRoute === 'inWall' || effectiveRoute === 'onWall') {
                const wallRotation = effectiveRoute === 'inWall' ? 0 : 180
                const wallScale = 0.75
                const wallSymbolCenterX = 3
                const wallSymbolCenterY = 0
                const segmentLength = Math.abs(wireSegment.endPoint.y - wireSegment.startPoint.y)
                // Position both wall symbols along the actual segment length:
                // keep comfortable margins on long segments and shrink margins/gap on shorter ones.
                const idealMargin = 10
                const minMargin = 3
                const marginFromEnds = Math.max(
                  minMargin,
                  Math.min(idealMargin, segmentLength / 2 - minMargin)
                )
                const bottomSymbolY = 10 - marginFromEnds
                const topSymbolY = 10 - (segmentLength - marginFromEnds)
                const wallLines = WALL_ROUTE_LINES.map((points, i) => (
                  <Line
                    key={i}
                    points={points}
                    stroke={colors.wireColor}
                    strokeWidth={thickness}
                    lineCap="round"
                    listening={false}
                  />
                ))
                return (
                  <>
                    <Group
                      x={-8.5 + wallSymbolCenterX}
                      y={topSymbolY}
                      scaleX={wallScale}
                      scaleY={wallScale}
                      offsetX={wallSymbolCenterX}
                      offsetY={wallSymbolCenterY}
                      rotation={wallRotation}
                    >
                      {wallLines}
                    </Group>
                    <Group
                      x={-8.5 + wallSymbolCenterX}
                      y={bottomSymbolY}
                      scaleX={wallScale}
                      scaleY={wallScale}
                      offsetX={wallSymbolCenterX}
                      offsetY={wallSymbolCenterY}
                      rotation={wallRotation}
                    >
                      {wallLines}
                    </Group>
                  </>
                )
              }
              return null
            })()}
          </Group>
        </>
      )}

      {/* Domain-change marker immediately after a trunk or branch conversion device. */}
      {shouldDrawDomainLabelOnWire && domainIconImage && (
        <>
          <Text
            x={domainLabelX - domainIconSize / 2}
            y={domainLabelY - 9}
            width={domainIconSize}
            text={domainLabelText}
            fontSize={6}
            fontFamily={fontFamily}
            fill={colors.wireColor}
            align="center"
            listening={false}
          />
          <Image
            image={domainIconImage}
            x={domainLabelX}
            y={domainLabelY}
            width={domainIconSize}
            height={domainIconSize}
            offsetX={domainIconSize / 2}
            offsetY={domainIconSize / 2}
            listening={false}
          />
        </>
      )}
    </Group>
  )
})

/**
 * Render wire segments for a panel
 */
export const WireSegments = memo(function WireSegments({
  panelId,
  wireSegments,
}: {
  panelId: string
  wireSegments: WireSegment[]
}) {
  const panelWires = useMemo(
    () => wireSegments.filter((ws) => ws.panelId === panelId),
    [panelId, wireSegments]
  )

  return (
    <>
      {panelWires.map((wireSegment) => (
        <WireSegmentComponent key={wireSegment.id} wireSegment={wireSegment} />
      ))}
    </>
  )
})
