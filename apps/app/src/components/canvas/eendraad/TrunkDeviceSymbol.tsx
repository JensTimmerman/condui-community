import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { Group, Image, Line, Rect, Text } from 'react-konva'
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
  SELECTION_COLOR,
} from './canvasSymbols'
import { ProtectionOneWireLabels } from './ProtectionOneWireLabels'
import { useEendraadWireSegments } from '@/hooks/eendraad'
import { getCertificationSideLabelExtraOffsetPx } from '@/lib/conversionSideLabelOffset'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { getVisibleConversionLabelParts } from '@/lib/conversionLabels'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'
import type { SymbolLabelPosition, TrunkDevice } from '@/types/schema'
import type { Point } from '@/types/ui'
import { getSupplyDeviceMultiplier } from '@/utils/inverterMultipliers'
import { openSupplyDeviceAddMoreDialog } from '@/components/endpoints/AddMoreCountDialog'
import { MultiplierBadge } from './MultiplierBadge'
import { useCanvasPanOrClickGesture } from './CanvasPanOrClickGesture'
import { DomainMarker } from './DomainMarker'
import { getElectricalInstallationFromProject } from '@/lib/projectV2/electrical'
import {
  getPhaseAssignmentLabel,
  phaseAssignmentDiffersFromInstallation,
} from '@/lib/wires/phaseAssignment'
import { getSupplyConverterAcPhaseAssignment } from '@/lib/supplyAssembly/supplyConverterPhases'
import {
  CONVERTER_ARTWORK_PATHS,
  CONVERTER_DOMAIN_ICON_SIZE_RATIO,
  getConverterArtworkLayout,
  getConverterConnectionDomains,
  getConverterCornerPosition,
  getConverterDomainCorner,
  isDirectionalConverterSymbol,
} from '@/lib/converterArtwork'
import { countSymbolLabelVisualLines } from '@/lib/symbolLabelMetrics'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import {
  getSupplyMetadataCalloutGroupPlacements,
  getSupplyMetadataCalloutLeaderPoints,
  getSupplyMetadataCalloutPlacement,
  getSupplyMetadataCalloutPlacementKind,
  shouldUseSupplyMetadataCallout,
  SUPPLY_METADATA_CALLOUT_MIN_WIDTH,
} from '@/lib/supplyMetadataCallout'

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
  /** Other devices on this supply lane, used to keep metadata cards apart. */
  supplyDevicePositions?: Array<{ device: TrunkDevice; x: number; y: number }>
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
  onDragStart?: (altKey: boolean, nativeEvt: MouseEvent) => boolean
  shouldSuppressKonvaDragEnd?: () => boolean
  /** Circuit trunk devices: allow 1‑draad drag to another trunk when selected alone. */
  draggableCircuitTrunk?: boolean
}

const SUPPLY_METADATA_FONT_SIZE = 8

function isSupplyMetadataDevice(device: TrunkDevice): boolean {
  // DC-DC devices can carry long model/charger notes even when they do not have
  // certification fields. Treat them like the other supply equipment so those
  // notes use the same collision-aware callout instead of floating over the inverter.
  return (
    device.symbol === 'inverter' ||
    device.symbol === 'dc_dc_converter' ||
    device.symbol === 'solar_panel' ||
    device.symbol === 'battery'
  )
}

function getSupplyMetadataLinesForDevice(device: TrunkDevice): string[] {
  const multiplier = getSupplyDeviceMultiplier(device)
  const certificationParts = getVisibleCertificationLabelParts(device)
  const conversionParts =
    device.type === 'conversion' || device.symbol === 'solar_panel' || device.symbol === 'battery'
      ? getVisibleConversionLabelParts(device)
      : []
  const notesText = (device.notes ?? '').trim()
  const showNotes =
    device.type !== 'protection' &&
    notesText.length > 0 &&
    isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)

  return [
    ...certificationParts.map((part) => ({
      key: part.key,
      text:
        part.key === 'certificationModel' && multiplier > 1
          ? `${multiplier}× ${part.text}`
          : part.text,
    })),
    ...conversionParts,
    ...(showNotes ? [{ key: 'trunkDeviceNotes', text: notesText }] : []),
  ].map((item) => item.text)
}

function getSupplyMetadataCardSize(
  lines: string[],
  fontFamily: string
): { width: number; height: number } {
  const visualLineCount = lines.reduce(
    (total, line) => total + countSymbolLabelVisualLines(line),
    0
  )
  return {
    width: Math.min(
      260,
      Math.max(
        SUPPLY_METADATA_CALLOUT_MIN_WIDTH,
        ...lines.map((line) =>
          measureSymbolLabelTextWidth(line, fontFamily, SUPPLY_METADATA_FONT_SIZE)
        )
      ) + 10
    ),
    height: visualLineCount * 10 + 10,
  }
}

/**
 * Renders a trunk device symbol (e.g. energy meter) on a wire.
 * Works for both vertical circuit trunks and horizontal supply wires.
 */
export function TrunkDeviceSymbol({
  device,
  position,
  supplyDevicePositions,
  isHorizontal,
  showDeviceLabelLeft = false,
  splitProtectionResidualLine = false,
  protectionLabelPosition,
  getCanvasPositionFromEvent,
  onDragMove,
  onDragEnd,
  onDragStart,
  shouldSuppressKonvaDragEnd,
  draggableCircuitTrunk = false,
}: TrunkDeviceSymbolProps) {
  const setSelection = useSetSelection()
  const { t } = useTranslation()
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
  const [converterDiagonalImage, setConverterDiagonalImage] = useState<HTMLImageElement | null>(null)
  const [converterAcImage, setConverterAcImage] = useState<HTMLImageElement | null>(null)
  const [converterDcImage, setConverterDcImage] = useState<HTMLImageElement | null>(null)
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
  const supplyDeviceMultiplier = getSupplyDeviceMultiplier(device)
  const isConversionSymbol =
    device.symbol === 'transformer' ||
    device.symbol === 'rectifier' ||
    device.symbol === 'inverter' ||
    device.symbol === 'dc_dc_converter'
  const isDirectionalConverter = isDirectionalConverterSymbol(device.symbol)
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
    : isDirectionalConverter
      ? CONVERTER_ARTWORK_PATHS.base
      : (switchSymbolPaths?.basePath ?? symbol?.svgPath)
  const nameLabelText = (device.label ?? '').trim()
  const isVerticalSupplyProtection =
    isProtection &&
    device.supplyPath === 'converter-grid' &&
    device.converterGridPlacement === 'input-leg'
  const showSupplyProtectionNameLabel =
    (isHorizontal === true || isVerticalSupplyProtection) &&
    (isProtection || device.symbol === 'source_changeover') &&
    nameLabelText.length > 0 &&
    isSymbolLabelVisible(device.symbolLabelDisplay, 'supplyProtectionNameLabel', true)
  const wireSegments = useEendraadWireSegments()
  const converterConnectionDomains = isDirectionalConverter
    ? getConverterConnectionDomains(wireSegments, device.id, position, SYMBOL_SIZE)
    : {}
  const converterArtworkLayout = isDirectionalConverter
    ? getConverterArtworkLayout(
        device.symbol === 'inverter' ? 'DC' : 'AC',
        device.symbol === 'inverter' ? 'AC' : 'DC',
        converterConnectionDomains,
      )
    : null
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
  const hasConnectedBottomWire = isConversionSymbol && device.converterGridInputConnected !== false
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
      ...(isConversionSymbol || device.symbol === 'solar_panel' || device.symbol === 'battery'
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
  const topStackVisualLineCount = useMemo(
    () =>
      topStackLabelItems.reduce((total, item) => total + countSymbolLabelVisualLines(item.text), 0),
    [topStackLabelItems]
  )
  const metadataCalloutItems = useMemo(
    () => [
      ...certificationLabelParts.map((part) => ({
        key: part.key,
        text:
          part.key === 'certificationModel' && supplyDeviceMultiplier > 1
            ? `${supplyDeviceMultiplier}× ${part.text}`
            : part.text,
      })),
      ...conversionLabelParts.map((part) => ({ key: part.key, text: part.text })),
      ...(showNotesLabel ? [{ key: 'trunkDeviceNotes' as const, text: notesText }] : []),
    ],
    [
      certificationLabelParts,
      conversionLabelParts,
      notesText,
      showNotesLabel,
      supplyDeviceMultiplier,
    ]
  )
  const metadataCalloutLines = useMemo(
    () => metadataCalloutItems.map((item) => item.text),
    [metadataCalloutItems]
  )
  const metadataCalloutPeerCount = (
    supplyDevicePositions?.length
      ? supplyDevicePositions
      : [{ device, x: position.x, y: position.y }]
  ).filter(
    ({ device: peer }) =>
      isSupplyMetadataDevice(peer) &&
      !(peer.supplyPath === 'converter-grid' && peer.converterGridPlacement === 'input-leg')
  ).length
  const metadataCalloutPlacementKind = getSupplyMetadataCalloutPlacementKind({
    symbol: device.symbol,
    peerCount: metadataCalloutPeerCount,
  })
  const metadataCalloutGroup = useMemo(() => {
    const peerPositions = supplyDevicePositions?.length
      ? supplyDevicePositions
      : [{ device, x: position.x, y: position.y }]
    const peers = peerPositions.filter(
      ({ device: peer }) =>
        isSupplyMetadataDevice(peer) &&
        !(peer.supplyPath === 'converter-grid' && peer.converterGridPlacement === 'input-leg')
    )
    const hasLongPeer = peers.some(({ device: peer }) => {
      const lines = getSupplyMetadataLinesForDevice(peer)
      return (
        lines.length > 0 && shouldUseSupplyMetadataCallout(lines, getSupplyDeviceMultiplier(peer))
      )
    })
    if (!hasLongPeer) return new Map()

    const symbolRects = peers.map(({ x, y }) => ({
      left: x - SYMBOL_SIZE / 2 - 4,
      top: y - SYMBOL_SIZE / 2 - 4,
      right: x + SYMBOL_SIZE / 2 + 4,
      bottom: y + SYMBOL_SIZE / 2 + 4,
    }))
    const items = peers.flatMap(({ device: peer, x, y }) => {
      const lines = getSupplyMetadataLinesForDevice(peer)
      if (lines.length === 0) return []
      const { width, height } = getSupplyMetadataCardSize(lines, fontFamily)
      return [
        {
          id: peer.id,
          symbolPosition: { x, y },
          width,
          height,
          placement: getSupplyMetadataCalloutPlacementKind({
            symbol: peer.symbol,
            peerCount: peers.length,
          }),
        },
      ]
    })
    return getSupplyMetadataCalloutGroupPlacements({
      items,
      segments: wireSegments,
      symbolRects,
    })
  }, [device, fontFamily, position.x, position.y, supplyDevicePositions, wireSegments])
  const useMetadataCallout =
    isSupplyMetadataDevice(device) && isHorizontal === true && metadataCalloutGroup.has(device.id)
  const metadataCalloutVisualLineCount = useMemo(
    () =>
      metadataCalloutLines.reduce((total, line) => total + countSymbolLabelVisualLines(line), 0),
    [metadataCalloutLines]
  )
  const metadataCalloutWidth = useMemo(
    () =>
      Math.min(
        260,
        Math.max(
          SUPPLY_METADATA_CALLOUT_MIN_WIDTH,
          ...metadataCalloutLines.map((line) => measureSymbolLabelTextWidth(line, fontFamily, 8))
        ) + 10
      ),
    [fontFamily, metadataCalloutLines]
  )
  const metadataCalloutHeight = metadataCalloutVisualLineCount * 10 + 10
  const metadataCalloutPlacement = useMemo(() => {
    const groupPlacement = metadataCalloutGroup.get(device.id)
    if (groupPlacement) return { x: groupPlacement.x, y: groupPlacement.y }
    return getSupplyMetadataCalloutPlacement({
      symbolPosition: position,
      width: metadataCalloutWidth,
      height: metadataCalloutHeight,
      segments: wireSegments,
      placement: metadataCalloutPlacementKind,
    })
  }, [
    device.id,
    metadataCalloutHeight,
    metadataCalloutGroup,
    metadataCalloutPlacementKind,
    metadataCalloutWidth,
    position,
    wireSegments,
  ])
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
  const metadataCalloutLeaderPoints = getSupplyMetadataCalloutLeaderPoints({
    placement: metadataCalloutPlacement,
    width: metadataCalloutWidth,
    height: metadataCalloutHeight,
    symbolWidth: renderedSymbolSize.width,
    symbolHeight: renderedSymbolSize.height,
    placementKind: metadataCalloutPlacementKind,
  })

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

  useEffect(() => {
    if (!isDirectionalConverter) {
      setConverterDiagonalImage(null)
      setConverterAcImage(null)
      setConverterDcImage(null)
      return
    }
    const paths = [
      [CONVERTER_ARTWORK_PATHS.diagonal, setConverterDiagonalImage],
      [CONVERTER_ARTWORK_PATHS.AC, setConverterAcImage],
      [CONVERTER_ARTWORK_PATHS.DC, setConverterDcImage],
    ] as const
    for (const [path, setter] of paths) {
      loadProcessedSymbol(path, isDark).then(setter).catch(() => setter(null))
    }
  }, [isDirectionalConverter, isDark])

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
  const metadataCalloutGestureHandlers = useCanvasPanOrClickGesture((event) => handleClick(event))

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

  const converterIconSize = SYMBOL_SIZE * CONVERTER_DOMAIN_ICON_SIZE_RATIO
  const converterIconMargin = 2
  const converterArtworkImagePosition = (domain: 'AC' | 'DC') => {
    const corner = converterArtworkLayout
      ? getConverterDomainCorner(converterArtworkLayout, domain)
      : undefined
    if (!corner) return undefined
    return getConverterCornerPosition(
      corner,
      renderedSymbolSize.width,
      renderedSymbolSize.height,
      converterIconMargin,
      converterIconSize,
    )
  }
  const converterAcPosition = converterArtworkImagePosition('AC')
  const converterDcPosition = converterArtworkImagePosition('DC')

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
      onDragStart={
        canDragTrunk && onDragStart
          ? (e) => {
              const evt = e.evt as MouseEvent
              if (onDragStart(!!evt.altKey, evt)) {
                e.target.stopDrag()
                e.target.position({ x: position.x, y: position.y })
              }
            }
          : undefined
      }
      onDragMove={
        canDragTrunk && onDragMove
          ? (e) => {
              onDragMove(getCanvasPositionFromEvent?.(e) ?? { x: e.target.x(), y: e.target.y() })
            }
          : undefined
      }
      onDragEnd={
        canDragTrunk && onDragEnd
          ? (e) => {
              if (shouldSuppressKonvaDragEnd?.()) {
                e.target.position({ x: position.x, y: position.y })
                return
              }
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
      {isDirectionalConverter && converterDiagonalImage && converterArtworkLayout && (
        <Image
          image={converterDiagonalImage}
          {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: CONVERTER_ARTWORK_PATHS.diagonal }}
          width={renderedSymbolSize.width}
          height={renderedSymbolSize.height}
          offsetX={renderedSymbolSize.width / 2}
          offsetY={renderedSymbolSize.height / 2}
          scaleX={converterArtworkLayout.diagonal === 'top-left-to-bottom-right' ? -1 : 1}
          listening={false}
        />
      )}
      {isDirectionalConverter && converterAcImage && converterAcPosition && (
        <Image
          image={converterAcImage}
          {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: CONVERTER_ARTWORK_PATHS.AC }}
          width={converterIconSize}
          height={converterIconSize}
          offsetX={converterIconSize / 2}
          offsetY={converterIconSize / 2}
          x={converterAcPosition.x}
          y={converterAcPosition.y}
          listening={false}
        />
      )}
      {isDirectionalConverter && converterDcImage && converterDcPosition && (
        <Image
          image={converterDcImage}
          {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: CONVERTER_ARTWORK_PATHS.DC }}
          width={converterIconSize}
          height={converterIconSize}
          offsetX={converterIconSize / 2}
          offsetY={converterIconSize / 2}
          x={converterDcPosition.x}
          y={converterDcPosition.y}
          listening={false}
        />
      )}
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
      {!isDirectionalConverter &&
        isConversionSymbol &&
        (device.supplyPath === 'backup' || device.supplyPath === 'converter-branch') && (
          <>
            <DomainMarker
              domain="AC"
              x={-renderedSymbolSize.width / 2 - 6}
              y={-5.5}
              color={getSecondaryTextColor(isDark ?? false)}
            />
            {hasConnectedBottomWire && (
              <DomainMarker
                domain="AC"
                x={7}
                y={renderedSymbolSize.height / 2 + 6}
                color={getSecondaryTextColor(isDark ?? false)}
              />
            )}
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
                {hasConnectedBottomWire && (
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
                )}
              </>
            )}
          </>
        )}
      {supplyDeviceMultiplier > 1 && (
        <MultiplierBadge
          count={supplyDeviceMultiplier}
          x={renderedSymbolSize.width / 2 + 7}
          y={-renderedSymbolSize.height / 2 - 11}
          fontFamily={fontFamily}
          fill={getSymbolColor(theme?.mode === 'dark')}
          onActivate={() => openSupplyDeviceAddMoreDialog(device, t)}
        />
      )}

      {useMetadataCallout && metadataCalloutLines.length > 0 && (
        <>
          <Line
            points={metadataCalloutLeaderPoints}
            stroke={getSecondaryTextColor(isDark ?? false)}
            strokeWidth={0.7}
            dash={[3, 3]}
            listening={false}
          />
          <Group
            x={metadataCalloutPlacement.x}
            y={metadataCalloutPlacement.y}
            {...metadataCalloutGestureHandlers}
          >
            <Rect
              width={metadataCalloutWidth}
              height={metadataCalloutHeight}
              stroke={
                isSelected || isHoveredAny
                  ? SELECTION_COLOR
                  : getSecondaryTextColor(isDark ?? false)
              }
              strokeWidth={isSelected ? 1.2 : 0.7}
              cornerRadius={2}
              fill="transparent"
            />
            <Text
              x={5}
              y={5}
              width={metadataCalloutWidth - 10}
              height={metadataCalloutHeight - 10}
              text={metadataCalloutLines.join('\n')}
              fontFamily={fontFamily}
              fontSize={8}
              lineHeight={1.25}
              fill={getSecondaryTextColor(isDark ?? false)}
              wrap="word"
              listening={false}
            />
          </Group>
        </>
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
      {!useMetadataCallout && stackedRightLabelItems.length > 0 && (
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
      {placeNotesOnTop &&
        !useMetadataCallout &&
        topStackLabelItems.length > 0 &&
        !hasConnectedTopWire && (
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
      {placeNotesOnTop &&
        !useMetadataCallout &&
        topStackLabelItems.length > 0 &&
        hasConnectedTopWire && (
          <Text
            x={-164}
            y={-renderedSymbolSize.height / 2 - topStackVisualLineCount * 10 - 4}
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
