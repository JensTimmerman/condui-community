import { useState, useEffect, useCallback, useMemo } from 'react'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { Group, Image, Rect } from 'react-konva'
import { getSymbolById, TRANSFORMER_OVERLAY_PATHS } from '@/lib/symbols'
import { SYMBOL_EXPORT_ATTR_SVG_PATH, loadProcessedSymbol } from '@/lib/symbolImage'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useHoverIncludes, useIsIdSelected, useSetSelection } from '@/editions/community/communityHooks'
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
  getSecondaryTextColor,
  getTextColor,
} from './canvasSymbols'
import { ProtectionOneWireLabels } from './ProtectionOneWireLabels'
import { useEendraadWireSegments } from '@/hooks/eendraad'
import { getCertificationSideLabelExtraOffsetPx } from '@/lib/conversionSideLabelOffset'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { getVisibleConversionLabelParts } from '@/lib/conversionLabels'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'
import type { TrunkDevice } from '@/types/schema'
import type { Point } from '@/types/ui'

type EendraadPointerEvent = {
  cancelBubble: boolean
  evt: { button?: number; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
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
  getCanvasPositionFromEvent,
  onDragMove,
  onDragEnd,
  draggableCircuitTrunk = false,
}: TrunkDeviceSymbolProps) {
  const setSelection = useSetSelection()
  const isSelected = useIsIdSelected(device.id)
  const canDragTrunk = useUIStore(
    (s) =>
      draggableCircuitTrunk &&
      s.selection.ids.includes(device.id)
  )
  const isHoveredFromBreadcrumb = useHoverIncludes('trunkDevice', device.id)
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const touchPrimary = useTouchPrimaryDevice()
  const { theme } = useSettingsStore()
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
  const isDark = theme?.mode === 'dark'
  const isTransformer = device.symbol === 'transformer'
  const conversionProps = device.conversionProps
  const isConversionSymbol =
    device.symbol === 'transformer' ||
    device.symbol === 'rectifier' ||
    device.symbol === 'inverter' ||
    device.symbol === 'dc_dc_converter'
  const isProtection = device.type === 'protection'
  const nameLabelText = (device.label ?? '').trim()
  const showSupplyProtectionNameLabel =
    isHorizontal === true &&
    isProtection &&
    nameLabelText.length > 0 &&
    isSymbolLabelVisible(device.symbolLabelDisplay, 'supplyProtectionNameLabel', true)
  const wireSegments = useEendraadWireSegments()
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
      ...(isConversionSymbol
        ? conversionLabelParts.map((part) => ({ key: part.key, text: part.text }))
        : []),
      ...certificationLabelParts.map((part) => ({ key: part.key, text: part.text })),
      ...(!placeNotesOnTop && showNotesLabel ? [{ key: 'trunkDeviceNotes', text: notesText }] : []),
    ],
    [
      certificationLabelParts,
      conversionLabelParts,
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
    [
      device,
      fontFamily,
      isHorizontal,
      renderedSymbolSize.width,
      wireSegments,
    ],
  )

  useEffect(() => {
    if (!symbol) return
    loadProcessedSymbol(symbol.svgPath, isDark)
      .then(setProcessedImage)
      .catch(() => setProcessedImage(null))
  }, [symbol, isDark])

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

  const rotateForHorizontal = isHorizontal && isProtection

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
      <Rect
        {...getTouchAwareHitAreaProps(
          ENDPOINT_OUTLINE_SIZE,
          canvasZoom,
          isSelected,
          touchPrimary,
        )}
      />

      {/* Symbol image — offsetY by orientation; protection on horizontal trunk rotated 90° left */}
      <Image
        image={processedImage}
        {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: symbol.svgPath }}
        width={renderedSymbolSize.width}
        height={renderedSymbolSize.height}
        offsetX={renderedSymbolSize.width / 2}
        offsetY={renderedSymbolSize.height / 2}
        rotation={rotateForHorizontal ? -90 : 0}
        listening={false}
      />

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
      {placeNotesOnTop && topStackLabelItems.length > 0 && (
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
          source={device}
          defaultPosition={isHorizontal ? 'bottom' : 'right'}
          textColor={getSecondaryTextColor(isDark ?? false)}
          fontFamily={fontFamily}
          fontSize={10}
          symbolSize={SYMBOL_SIZE}
          symbolWidth={renderedSymbolSize.width}
          symbolHeight={renderedSymbolSize.height}
          splitResidualLine={splitProtectionResidualLine}
          onLabelClick={handleClick}
        />
      )}
      {/* Preview highlight (during selection rectangle drag) */}
      {isPreviewSelected && !isSelected && (
        <Rect {...getPreviewOutlineProps(canvasZoom, ENDPOINT_OUTLINE_SIZE)} />
      )}
      {/* Hover highlight */}
      {isHoveredAny && !isSelected && !isPreviewSelected && (
        <Rect {...getHoverOutlineProps(canvasZoom, ENDPOINT_OUTLINE_SIZE)} />
      )}
      {/* Selection outline */}
      {isSelected && <Rect {...getSelectionOutlineProps(canvasZoom, ENDPOINT_OUTLINE_SIZE)} />}
    </Group>
  )
}
