import { useState, useEffect, useCallback, useMemo } from 'react'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { Group, Image, Rect, Text } from 'react-konva'
import { getSwitchSymbolPaths, getSymbolById, TRANSFORMER_OVERLAY_PATHS } from '@/lib/symbols'
import { SYMBOL_EXPORT_ATTR_SVG_PATH, loadProcessedSymbol } from '@/lib/symbolImage'
import {
  getSurgeProtectionBodyBounds,
  getSurgeProtectionSymbolPath,
  getSurgeProtectionSymbolAnchor,
  getSurgeProtectionSelectionBounds,
} from '@/lib/surgeProtectionSymbol'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { useHoverIncludes, useSetSelection, useTrunkDeviceSelected } from '@/editions/community/communityHooks'
import { useIsPreviewSelected } from '@/contexts/SelectionPreviewContext'
import { useCanvasFontFamily, useEffectiveCanvasZoom, useTouchPrimaryDevice } from '@/editions/community/communityHooks'
import { SymbolTextLabels } from './SymbolTextLabels'
import {
  SYMBOL_SIZE,
  ENDPOINT_OUTLINE_SIZE,
  getTouchAwareHitAreaProps,
  getSelectionOutlineProps,
  getHoverOutlineProps,
  getPreviewOutlineProps,
  getPaddedRectSelectionOutlineProps,
  getPaddedRectHoverOutlineProps,
  getPaddedRectPreviewOutlineProps,
  getSecondaryTextColor,
  getSymbolColor,
  getTextColor,
} from './canvasSymbols'
import { ProtectionOneWireLabels } from './ProtectionOneWireLabels'
import { useEendraadWireSegments } from '@/hooks/eendraad'
import { getCertificationSideLabelExtraOffsetPx } from '@/lib/conversionSideLabelOffset'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { getVisibleConversionLabelParts } from '@/lib/conversionLabels'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'
import type { SymbolLabelPosition, TrunkDevice } from '@/types/schema'
import type { Point } from '@/types/ui'
import { getSupplyInverterMultiplier } from '@/utils/inverterMultipliers'
import { DomainMarker } from './DomainMarker'
import { getElectricalInstallationFromProject } from '@/lib/projectV2/electrical'
import {
  getPhaseAssignmentLabel,
  phaseAssignmentDiffersFromInstallation,
} from '@/lib/wires/phaseAssignment'
import { getSupplyConverterAcPhaseAssignment } from '@/lib/supplyAssembly/supplyConverterPhases'

type EendraadPointerEvent = {
  cancelBubble: boolean
  evt: {
    button?: number
    shiftKey?: boolean
    altKey?: boolean
    ctrlKey?: boolean
    metaKey?: boolean
  }
}
type WindowWithEendraTapSuppression = Window & { __eendraSuppressNextElementTap?: boolean }

interface TrunkDeviceSymbolProps {
  device: TrunkDevice
  position: Point
  /** If true, symbol is on a horizontal wire (supply trunk). Default: vertical trunk. */
  isHorizontal?: boolean
  /** Show the device's own label on the left for special vertical feeder contexts. */
  showDeviceLabelLeft?: boolean
  /** Split a wide residual-current line to avoid adjacent supply-label collisions. */
  splitProtectionResidualLine?: boolean
  /** Override protection label placement for a wire branch with a fixed orientation. */
  protectionLabelPosition?: SymbolLabelPosition
  /** Drop target uses cursor position on drag end (same as protection / endpoint). */
  getCanvasPositionFromEvent?: (e: unknown) => Point | null
  onDragMove?: (newPos: Point) => void
  onDragEnd?: (newPos: Point) => boolean | void
  /** Circuit trunk devices: allow 1‑draad drag to another trunk when selected alone. */
  draggableCircuitTrunk?: boolean
}

/**
 * Renders a trunk device symbol (e.g. energy meter) on a wire.
 * Works for both vertical circuit trunks and horizontal supply wires.
 */
export function TrunkDeviceSymbol({
  device,
  position,
  isHorizontal,
  showDeviceLabelLeft = false,
  splitProtectionResidualLine = false,
  protectionLabelPosition,
  getCanvasPositionFromEvent,
  onDragMove,
  onDragEnd,
  draggableCircuitTrunk = false,
}: TrunkDeviceSymbolProps) {
  const setSelection = useSetSelection()
  const isSelected = useTrunkDeviceSelected(device)
  const canDragTrunk = useUIStore(
    (s) => draggableCircuitTrunk && s.selection.ids.includes(device.id)
  )
  const isHoveredFromBreadcrumb = useHoverIncludes('trunkDevice', device.id)
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const touchPrimary = useTouchPrimaryDevice()
  const theme = useSettingsStore((state) => state.theme)
  const fontFamily = useCanvasFontFamily()
  const isPreviewSelected = useIsPreviewSelected('trunkDevice', device.id)
  const [processedImage, setProcessedImage] = useState<HTMLImageElement | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [transformerSafetyImage, setTransformerSafetyImage] = useState<HTMLImageElement | null>(
    null
  )
  const [transformerShortcircuitImage, setTransformerShortcircuitImage] =
    useState<HTMLImageElement | null>(null)
  const [transformerProtectionImage, setTransformerProtectionImage] =
    useState<HTMLImageElement | null>(null)

  const symbol = getSymbolById(device.symbol)
  const isInlineSwitch = symbol?.category === 'switches'
  const isDark = theme?.mode === 'dark'
  const phaseSystem = useProjectStore((state) =>
    state.currentProject
      ? getElectricalInstallationFromProject(state.currentProject)?.nominalVoltage.system
      : undefined
  )
  const isTransformer = device.symbol === 'transformer'
  const conversionProps = device.conversionProps
  const inverterMultiplier = getSupplyInverterMultiplier(device)
  const isConversionSymbol =
    device.symbol === 'transformer' ||
    device.symbol === 'rectifier' ||
    device.symbol === 'inverter' ||
    device.symbol === 'dc_dc_converter'
  const converterAcPhaseAssignment =
    isConversionSymbol && phaseSystem
      ? getSupplyConverterAcPhaseAssignment(device, phaseSystem)
      : undefined
  const converterAcPhaseLabel =
    phaseSystem && phaseAssignmentDiffersFromInstallation(converterAcPhaseAssignment, phaseSystem)
      ? getPhaseAssignmentLabel(converterAcPhaseAssignment, phaseSystem)
      : undefined
  const isProtection = device.type === 'protection'
  const isSurgeProtection = device.protectionType === 'SPD' || device.symbol === 'spd'
  const switchSymbolPaths = isInlineSwitch
    ? getSwitchSymbolPaths(device.symbol, {
        poles: Math.min(4, Math.max(1, device.poles ?? 1)) as 1 | 2 | 3 | 4,
        twoPole: device.symbol === 'switch_2p_twoway',
      })
    : undefined
  const renderedSymbolPath = isSurgeProtection
    ? getSurgeProtectionSymbolPath(device.surgeProtectionKind)
    : (switchSymbolPaths?.basePath ?? symbol?.svgPath)
  const nameLabelText = (device.label ?? '').trim()
  const isVerticalSupplyProtection =
    isProtection && device.supplyPath === 'converter-grid'
  const showSupplyProtectionNameLabel =
    (isHorizontal === true || isVerticalSupplyProtection) &&
    (isProtection || device.symbol === 'source_changeover') &&
    nameLabelText.length > 0 &&
    isSymbolLabelVisible(device.symbolLabelDisplay, 'supplyProtectionNameLabel', true)
  const wireSegments = useEendraadWireSegments()
  const hasConnectedTopWire =
    isConversionSymbol &&
    wireSegments.some(
      (segment) =>
        segment.domain === 'DC' &&
        segment.type === 'vertical' &&
        !!segment.supplyConnectionId &&
        Math.abs(segment.startPoint.x - position.x) < 1 &&
        Math.min(segment.startPoint.y, segment.endPoint.y) < position.y &&
        Math.max(segment.startPoint.y, segment.endPoint.y) <= position.y + 1
    )
  const conversionLabelParts = getVisibleConversionLabelParts(device)
  const certificationLabelParts = getVisibleCertificationLabelParts(device)
  const notesText = (device.notes ?? '').trim()
  const showNotesLabel =
    !isProtection &&
    notesText.length > 0 &&
    isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)
  const isDomoticaDevice = device.symbol === 'domotica'
  const forceProtectionLabelStack = isProtection && isHorizontal !== true
  const placeNotesOnTop = isDomoticaDevice || isHorizontal === true || forceProtectionLabelStack
  const stackedRightLabelItems = useMemo(
    () => [
      ...(isConversionSymbol || device.symbol === 'solar_panel'
        ? conversionLabelParts.map((part) => ({ key: part.key, text: part.text }))
        : []),
      ...(!placeNotesOnTop
        ? certificationLabelParts.map((part) => ({ key: part.key, text: part.text }))
        : []),
      ...(!placeNotesOnTop && showNotesLabel ? [{ key: 'trunkDeviceNotes', text: notesText }] : []),
    ],
    [
      certificationLabelParts,
      conversionLabelParts,
      device.symbol,
      isConversionSymbol,
      notesText,
      placeNotesOnTop,
      showNotesLabel,
    ]
  )
  const topStackLabelItems = useMemo(
    () => [
      ...certificationLabelParts.map((part) => ({ key: part.key, text: part.text })),
      ...(showNotesLabel ? [{ key: 'trunkDeviceNotes' as const, text: notesText }] : []),
    ],
    [certificationLabelParts, notesText, showNotesLabel]
  )

  const renderedSymbolSize = useMemo(() => {
    if (!processedImage || !isDomoticaDevice) {
      return { width: SYMBOL_SIZE, height: SYMBOL_SIZE }
    }
    const imgWidth = processedImage.width || processedImage.naturalWidth || SYMBOL_SIZE
    const imgHeight = processedImage.height || processedImage.naturalHeight || SYMBOL_SIZE
    if (imgWidth <= 0 || imgHeight <= 0) {
      return { width: SYMBOL_SIZE, height: SYMBOL_SIZE }
    }
    if (imgWidth >= imgHeight) {
      return {
        width: SYMBOL_SIZE,
        height: SYMBOL_SIZE * (imgHeight / imgWidth),
      }
    }
    return {
      width: SYMBOL_SIZE * (imgWidth / imgHeight),
      height: SYMBOL_SIZE,
    }
  }, [isDomoticaDevice, processedImage])

  const certificationSideLabelExtraOffset = useMemo(
    () =>
      !isHorizontal
        ? getCertificationSideLabelExtraOffsetPx(device, wireSegments, fontFamily, {
            symbolHalfWidth: renderedSymbolSize.width / 2,
          })
        : 0,
    [device, fontFamily, isHorizontal, renderedSymbolSize.width, wireSegments]
  )

  useEffect(() => {
    if (!renderedSymbolPath) return
    loadProcessedSymbol(renderedSymbolPath, isDark)
      .then(setProcessedImage)
      .catch(() => setProcessedImage(null))
  }, [renderedSymbolPath, isDark])

  // Load transformer overlays for trunk devices
  useEffect(() => {
    if (!isTransformer) {
      setTransformerSafetyImage(null)
      setTransformerShortcircuitImage(null)
      setTransformerProtectionImage(null)
      return
    }
    const safetyType = conversionProps?.transformerSafetyType ?? 'none'

    if (safetyType === 'safety_closed') {
      loadProcessedSymbol(TRANSFORMER_OVERLAY_PATHS.safetyClosed, isDark)
        .then(setTransformerSafetyImage)
        .catch(() => setTransformerSafetyImage(null))
    } else if (safetyType === 'safety_open') {
      loadProcessedSymbol(TRANSFORMER_OVERLAY_PATHS.safetyOpen, isDark)
        .then(setTransformerSafetyImage)
        .catch(() => setTransformerSafetyImage(null))
    } else {
      setTransformerSafetyImage(null)
    }

    if (conversionProps?.transformerShortCircuitProtected) {
      loadProcessedSymbol(TRANSFORMER_OVERLAY_PATHS.shortcircuit, isDark)
        .then(setTransformerShortcircuitImage)
        .catch(() => setTransformerShortcircuitImage(null))
    } else {
      setTransformerShortcircuitImage(null)
    }

    if (conversionProps?.transformerProtected) {
      loadProcessedSymbol(TRANSFORMER_OVERLAY_PATHS.protection, isDark)
        .then(setTransformerProtectionImage)
        .catch(() => setTransformerProtectionImage(null))
    } else {
      setTransformerProtectionImage(null)
    }
  }, [
    isTransformer,
    conversionProps?.transformerSafetyType,
    conversionProps?.transformerShortCircuitProtected,
    conversionProps?.transformerProtected,
    isDark,
  ])

  const handleClick = useCallback(
    (event: unknown) => {
      const e = event as EendraadPointerEvent
      const eendraWindow = window as WindowWithEendraTapSuppression
      if (eendraWindow.__eendraSuppressNextElementTap) {
        eendraWindow.__eendraSuppressNextElementTap = false
        return
      }
      e.cancelBubble = true

      if (e.evt.button != null && e.evt.button !== 0) {
        return
      }

      if (e.evt.shiftKey) {
        const { selection } = useUIStore.getState()
        if (selection.type === 'trunkDevice' && !selection.ids.includes(device.id)) {
          setSelection({ type: 'trunkDevice', ids: [...selection.ids, device.id] })
        } else if (selection.type !== 'trunkDevice') {
          setSelection({ type: 'trunkDevice', ids: [device.id] })
        }
      } else if (e.evt.altKey || e.evt.ctrlKey || e.evt.metaKey) {
        const { selection } = useUIStore.getState()
        if (selection.type === 'trunkDevice' && selection.ids.includes(device.id)) {
          const newIds = selection.ids.filter((id) => id !== device.id)
          if (newIds.length === 0) {
            useUIStore.getState().clearSelection()
          } else {
            setSelection({ type: 'trunkDevice', ids: newIds })
          }
        }
      } else {
        setSelection({ type: 'trunkDevice', ids: [device.id] })
      }
    },
    [device.id, setSelection]
  )

  const rotateForHorizontal = isHorizontal && isProtection && !isInlineSwitch
  const protectionLabelSource = isInlineSwitch
    ? {
        ...device,
        protectionType: undefined,
        ratingA: undefined,
        curve: undefined,
        sensitivityMa: undefined,
        breakingCapacityKa: undefined,
        breakingCapacityOption: undefined,
      }
    : device
  const surgeBodyBounds = getSurgeProtectionBodyBounds(
    renderedSymbolSize.width,
    renderedSymbolSize.height,
    isHorizontal === true
  )
  const surgeSelectionBounds = getSurgeProtectionSelectionBounds(
    renderedSymbolSize.width,
    renderedSymbolSize.height,
    isHorizontal === true
  )
  const surgeSymbolAnchor = getSurgeProtectionSymbolAnchor(
    renderedSymbolSize.width,
    renderedSymbolSize.height
  )

  if (!symbol || !processedImage) return null

  const isHoveredAny = isHovered || isHoveredFromBreadcrumb

  return (
    <Group
      name={`trunkDevice-${device.id}`}
      x={position.x}
      y={position.y}
      draggable={canDragTrunk}
      onClick={handleClick}
      onTap={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDragMove={
        canDragTrunk && onDragMove
          ? (e) => {
              onDragMove({ x: e.target.x(), y: e.target.y() })
            }
          : undefined
      }
      onDragEnd={
        canDragTrunk && onDragEnd
          ? (e) => {
              const pos = getCanvasPositionFromEvent?.(e) ?? { x: e.target.x(), y: e.target.y() }
              onDragEnd(pos)
              e.target.position({ x: position.x, y: position.y })
            }
          : undefined
      }
    >
      {/* Invisible hit area — slightly larger than symbol for easy hover/click selection */}
      {isSurgeProtection ? (
        <Rect
          x={surgeBodyBounds.x - (touchPrimary ? 7 : 4)}
          y={surgeBodyBounds.y - (touchPrimary ? 7 : 4)}
          width={surgeBodyBounds.width + (touchPrimary ? 14 : 8)}
          height={surgeBodyBounds.height + (touchPrimary ? 14 : 8)}
          fill="transparent"
        />
      ) : (
        <Rect
          {...getTouchAwareHitAreaProps(
            ENDPOINT_OUTLINE_SIZE,
            canvasZoom,
            isSelected,
            touchPrimary
          )}
        />
      )}

      {/* Symbol image — offsetY by orientation; protection on horizontal trunk rotated 90° left */}
      <Image
        image={processedImage}
        {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: renderedSymbolPath }}
        width={renderedSymbolSize.width}
        height={renderedSymbolSize.height}
        offsetX={isSurgeProtection ? surgeSymbolAnchor.x : renderedSymbolSize.width / 2}
        offsetY={isSurgeProtection ? surgeSymbolAnchor.y : renderedSymbolSize.height / 2}
        rotation={rotateForHorizontal ? -90 : 0}
        listening={false}
      />
      {device.symbol === 'source_changeover' &&
        isSymbolLabelVisible(device.symbolLabelDisplay, 'changeoverPort1Label', true) &&
        (device.changeoverProps?.port1Label ?? '1').trim().length > 0 && (
          <Text
            x={renderedSymbolSize.width / 2 - 162}
            y={-(renderedSymbolSize.height * 7) / 24 - 11}
            width={160}
            text={device.changeoverProps?.port1Label ?? '1'}
            align="right"
            fontSize={8}
            fontFamily={fontFamily}
            fill={getSecondaryTextColor(isDark ?? false)}
            listening={false}
          />
        )}
      {device.symbol === 'source_changeover' &&
        isSymbolLabelVisible(device.symbolLabelDisplay, 'changeoverPort2Label', true) &&
        (device.changeoverProps?.port2Label ?? '2').trim().length > 0 && (
          <Text
            x={renderedSymbolSize.width / 2 - 162}
            y={(renderedSymbolSize.height * 7) / 24 + 2}
            width={160}
            text={device.changeoverProps?.port2Label ?? '2'}
            align="right"
            fontSize={8}
            fontFamily={fontFamily}
            fill={getSecondaryTextColor(isDark ?? false)}
            listening={false}
          />
        )}
      {isConversionSymbol &&
        (device.supplyPath === 'backup' || device.supplyPath === 'converter-branch') && (
          <>
            <DomainMarker
              domain="AC"
              x={-renderedSymbolSize.width / 2 - 6}
              y={-5.5}
              color={getSecondaryTextColor(isDark ?? false)}
            />
            <DomainMarker
              domain="AC"
              x={7}
              y={renderedSymbolSize.height / 2 + 6}
              color={getSecondaryTextColor(isDark ?? false)}
            />
            <DomainMarker
              domain="DC"
              x={renderedSymbolSize.width / 2 + 6}
              y={-5.5}
              color={getSecondaryTextColor(isDark ?? false)}
            />
            {hasConnectedTopWire && (
              <DomainMarker
                domain="DC"
                x={7}
                y={-renderedSymbolSize.height / 2 - 6}
                color={getSecondaryTextColor(isDark ?? false)}
              />
            )}
            {converterAcPhaseLabel && (
              <>
                <Text
                  x={-renderedSymbolSize.width / 2 - 30}
                  y={2}
                  width={24}
                  text={converterAcPhaseLabel}
                  align="right"
                  fontSize={6}
                  fontFamily={fontFamily}
                  fill={getSecondaryTextColor(isDark ?? false)}
                  listening={false}
                />
                <Text
                  x={-30}
                  y={renderedSymbolSize.height / 2 + 3}
                  width={24}
                  text={converterAcPhaseLabel}
                  align="right"
                  fontSize={6}
                  fontFamily={fontFamily}
                  fill={getSecondaryTextColor(isDark ?? false)}
                  listening={false}
                />
              </>
            )}
          </>
        )}
      {inverterMultiplier > 1 && (
        <Text
          text={`${inverterMultiplier}x`}
          x={ENDPOINT_OUTLINE_SIZE / 2 - 2}
          y={-ENDPOINT_OUTLINE_SIZE / 2 - 10}
          fontSize={8}
          fontStyle="bold"
          fill={getSymbolColor(theme?.mode === 'dark')}
          align="right"
          listening={false}
        />
      )}

      {/* Transformer overlays on trunk device */}
      {isTransformer && transformerSafetyImage && (
        <Image
          image={transformerSafetyImage}
          width={SYMBOL_SIZE}
          height={SYMBOL_SIZE}
          offsetX={SYMBOL_SIZE / 2}
          offsetY={isHorizontal ? SYMBOL_SIZE / 2 : SYMBOL_SIZE / 2}
          rotation={rotateForHorizontal ? -90 : 0}
          listening={false}
        />
      )}
      {isTransformer && transformerShortcircuitImage && (
        <Image
          image={transformerShortcircuitImage}
          width={SYMBOL_SIZE}
          height={SYMBOL_SIZE}
          offsetX={SYMBOL_SIZE / 2}
          offsetY={isHorizontal ? SYMBOL_SIZE / 2 : SYMBOL_SIZE / 2}
          rotation={rotateForHorizontal ? -90 : 0}
          listening={false}
        />
      )}
      {isTransformer && transformerProtectionImage && (
        <Image
          image={transformerProtectionImage}
          width={SYMBOL_SIZE}
          height={SYMBOL_SIZE}
          offsetX={SYMBOL_SIZE / 2}
          offsetY={isHorizontal ? SYMBOL_SIZE / 2 : SYMBOL_SIZE / 2}
          rotation={rotateForHorizontal ? -90 : 0}
          listening={false}
        />
      )}

      {/* Generic trunk labels on the right: conversion details + notes (single stacked flow). */}
      {stackedRightLabelItems.length > 0 && (
        <SymbolTextLabels
          items={stackedRightLabelItems}
          config={{ position: 'right', layout: 'stack' }}
          sideLabelBlockAlign="center"
          offsetFromSymbol={5 + certificationSideLabelExtraOffset}
          textColor={getSecondaryTextColor(isDark ?? false)}
          fontFamily={fontFamily}
          fontSize={8}
          symbolWidth={renderedSymbolSize.width}
          symbolHeight={renderedSymbolSize.height}
        />
      )}
      {placeNotesOnTop && topStackLabelItems.length > 0 && !hasConnectedTopWire && (
        <SymbolTextLabels
          items={topStackLabelItems}
          config={{ position: 'top', layout: 'stack' }}
          textColor={getSecondaryTextColor(isDark ?? false)}
          fontFamily={fontFamily}
          fontSize={8}
          symbolWidth={renderedSymbolSize.width}
          symbolHeight={renderedSymbolSize.height}
        />
      )}
      {placeNotesOnTop && topStackLabelItems.length > 0 && hasConnectedTopWire && (
        <Text
          x={-164}
          y={-renderedSymbolSize.height / 2 - topStackLabelItems.length * 10 - 4}
          width={160}
          text={topStackLabelItems.map((item) => item.text).join('\n')}
          align="right"
          fontFamily={fontFamily}
          fontSize={8}
          lineHeight={1.25}
          fill={getSecondaryTextColor(isDark ?? false)}
          listening={false}
        />
      )}
      {showSupplyProtectionNameLabel && (
        <SymbolTextLabels
          items={[{ key: 'supplyProtectionNameLabel', text: nameLabelText }]}
          config={{ position: 'top', layout: 'stack' }}
          textColor={getTextColor(isDark ?? false)}
          fontFamily={fontFamily}
          fontSize={11}
          symbolWidth={renderedSymbolSize.width}
          symbolHeight={renderedSymbolSize.height}
        />
      )}
      {showDeviceLabelLeft && nameLabelText.length > 0 && (
        <SymbolTextLabels
          items={[{ key: 'trunkDeviceNameLabel', text: nameLabelText }]}
          config={{ position: 'left', layout: 'stack' }}
          textColor={getTextColor(isDark ?? false)}
          fontFamily={fontFamily}
          fontSize={11}
          symbolWidth={renderedSymbolSize.width}
          symbolHeight={renderedSymbolSize.height}
        />
      )}
      {isProtection && (
        <ProtectionOneWireLabels
          source={
            protectionLabelPosition
              ? {
                  ...protectionLabelSource,
                  symbolLabelDisplay: {
                    ...protectionLabelSource.symbolLabelDisplay,
                    position: protectionLabelPosition,
                  },
                }
              : protectionLabelSource
          }
          defaultPosition={isHorizontal ? 'bottom' : 'right'}
          textColor={getSecondaryTextColor(isDark ?? false)}
          fontFamily={fontFamily}
          fontSize={10}
          symbolSize={SYMBOL_SIZE}
          symbolWidth={isSurgeProtection && !isHorizontal ? 0 : renderedSymbolSize.width}
          symbolHeight={
            isSurgeProtection && !isHorizontal ? surgeBodyBounds.height : renderedSymbolSize.height
          }
          splitResidualLine={splitProtectionResidualLine}
          onLabelClick={handleClick}
        />
      )}
      {/* Preview highlight (during selection rectangle drag) */}
      {isPreviewSelected && !isSelected && (
        <Rect
          {...(isSurgeProtection
            ? getPaddedRectPreviewOutlineProps(
                canvasZoom,
                surgeSelectionBounds.x,
                surgeSelectionBounds.y,
                surgeSelectionBounds.width,
                surgeSelectionBounds.height,
                2
              )
            : getPreviewOutlineProps(canvasZoom, ENDPOINT_OUTLINE_SIZE))}
        />
      )}
      {/* Hover highlight */}
      {isHoveredAny && !isSelected && !isPreviewSelected && (
        <Rect
          {...(isSurgeProtection
            ? getPaddedRectHoverOutlineProps(
                canvasZoom,
                surgeSelectionBounds.x,
                surgeSelectionBounds.y,
                surgeSelectionBounds.width,
                surgeSelectionBounds.height,
                2
              )
            : getHoverOutlineProps(canvasZoom, ENDPOINT_OUTLINE_SIZE))}
        />
      )}
      {/* Selection outline */}
      {isSelected && (
        <Rect
          {...(isSurgeProtection
            ? getPaddedRectSelectionOutlineProps(
                canvasZoom,
                surgeSelectionBounds.x,
                surgeSelectionBounds.y,
                surgeSelectionBounds.width,
                surgeSelectionBounds.height,
                2
              )
            : getSelectionOutlineProps(canvasZoom, ENDPOINT_OUTLINE_SIZE))}
        />
      )}
    </Group>
  )
}
