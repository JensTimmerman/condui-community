import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  HOVER_OUTLINE_DASH_PX,
  HOVER_OUTLINE_DASH_PX_MAX,
  HOVER_OUTLINE_DASH_PX_MIN,
  HOVER_OUTLINE_STROKE_PX,
  HOVER_OUTLINE_STROKE_PX_MAX,
  HOVER_OUTLINE_STROKE_PX_MIN,
  WIRE_SELECTION_EXTRA_PX,
  WIRE_SELECTION_EXTRA_PX_MAX,
  WIRE_SELECTION_EXTRA_PX_MIN,
  ZOOM_100,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'
import { Group, Image, Line, Rect, Text } from 'react-konva'
import {
  getDomainForSymbol,
  getSwitchSymbolPaths,
  getSymbolById,
  TRANSFORMER_OVERLAY_PATHS,
} from '@/lib/symbols'
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
import {
  useClearHover,
  useHoverIncludes,
  useSetHover,
  useSetSelection,
  useTrunkDeviceSelected,
} from '@/editions/community/communityHooks'
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
import { getSupplyDeviceMultiplier } from '@/lib/supplyAssembly/inverterMultipliers'
import { openSupplyDeviceAddMoreDialog } from '@/components/endpoints/AddMoreCountDialog'
import { MultiplierBadge } from './MultiplierBadge'
import { useCanvasPanOrClickGesture } from './CanvasPanOrClickGesture'
import { DomainMarker } from './DomainMarker'
import { getElectricalInstallationFromProject } from '@/lib/projectV2/electrical'
import { getEarthingSeparatorPairIds } from '@/lib/eendraad/earthingSeparatorPairs'
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
  getSupplyMetadataCalloutClusters,
  getSupplyMetadataCalloutLeaderPoints,
  getSupplyMetadataCalloutPlacement,
  getSupplyMetadataCalloutPlacementKind,
  getSupplyMetadataSharedLeaderPointSets,
  shouldUseSupplyDeviceMetadataCallout,
} from '@/lib/supplyMetadataCallout'
import { resolveTrunkDeviceMetadataCalloutSelection } from '@/lib/ui/metadataCalloutSelection'
import {
  applyMetadataCalloutMultiplier,
  getMetadataCalloutWidth,
} from '@/lib/metadataCalloutGrouping'
import {
  getCircuitConverterDcConnectionCount,
  getSupplyConverterBodyGeometry,
  supportsCircuitConverterDcConnections,
} from '@/lib/layout/circuitConverterGeometry'
import {
  clampConverterDcConnectionCount,
  resizeConverterDcConnections,
} from '@/lib/eendraad/resizeConverterDcConnections'
import { isVerticalSupplyDevice } from '@/lib/layout/supplyDeviceOrientation'

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

const CONVERTER_RESIZE_OUTLINE_PADDING = 4
const CONVERTER_RESIZE_HANDLE_WIDTH = 6
const CONVERTER_RESIZE_HANDLE_HIT_WIDTH = 14

interface TrunkDeviceSymbolProps {
  device: TrunkDevice
  position: Point
  /** Original circuit-trunk anchor when a widened converter's painted center shifts right. */
  circuitConverterAnchor?: Point
  /** Painted width of a selectable DC busbar. */
  dcBusWidth?: number
  /** Circuit-level collision-solved metadata frame for a widened converter. */
  metadataCallout?: {
    x: number
    y: number
    width: number
    height: number
    leaderPoints: [number, number, number, number]
    targetIds?: string[]
  }
  /** Other devices on this supply lane, used to keep metadata cards apart. */
  supplyDevicePositions?: Array<{ device: TrunkDevice; x: number; y: number }>
  /** Left-to-right supply layouts are solved in canonical space, then mirrored back. */
  supplyMirrorAxisX?: number
  supplyPanelId?: string
  /** If true, symbol is on a horizontal wire (supply trunk). Default: vertical trunk. */
  isHorizontal?: boolean
  /** Artwork rotation resolved by the shared layout tree. */
  symbolRotationDeg?: number
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
const CONVERTER_ARTWORK_VIEWBOX_SIZE = 48
const CONVERTER_ARTWORK_EDGE = 5.3
const CONVERTER_ARTWORK_STROKE = 2

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

function getSupplyMetadataLinesForDevice(device: TrunkDevice, multiplier = 1): string[] {
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

  return applyMetadataCalloutMultiplier(
    [
      ...conversionParts,
      ...certificationParts,
      ...(showNotes ? [{ key: 'trunkDeviceNotes', text: notesText }] : []),
    ],
    multiplier
  ).map((item) => item.text)
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
    width: getMetadataCalloutWidth(
      lines.map((line) => measureSymbolLabelTextWidth(line, fontFamily, SUPPLY_METADATA_FONT_SIZE))
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
  circuitConverterAnchor,
  dcBusWidth,
  metadataCallout,
  supplyDevicePositions,
  supplyMirrorAxisX,
  supplyPanelId,
  isHorizontal,
  symbolRotationDeg,
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
  const setHover = useSetHover()
  const clearHover = useClearHover()
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
  const [converterDiagonalImage, setConverterDiagonalImage] = useState<HTMLImageElement | null>(
    null
  )
  const [converterAcImage, setConverterAcImage] = useState<HTMLImageElement | null>(null)
  const [converterDcImage, setConverterDcImage] = useState<HTMLImageElement | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [converterResizePreviewCount, setConverterResizePreviewCount] = useState<number | null>(
    null
  )
  const converterResizeCountRef = useRef<number | null>(null)
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
  const isDirectionalConverter =
    isDirectionalConverterSymbol(device.symbol) ||
    (!!circuitConverterAnchor && device.symbol === 'dc_dc_converter')
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
  const isVerticalSupplyProtection = isProtection && isVerticalSupplyDevice(device)
  const showSupplyProtectionNameLabel =
    (isHorizontal === true || isVerticalSupplyProtection) &&
    (isProtection || device.symbol === 'source_changeover') &&
    nameLabelText.length > 0 &&
    isSymbolLabelVisible(device.symbolLabelDisplay, 'supplyProtectionNameLabel', true)
  const wireSegments = useEendraadWireSegments()
  const converterConnectionDomains = isDirectionalConverter
    ? getConverterConnectionDomains(
        wireSegments,
        device.id,
        circuitConverterAnchor ?? position,
        SYMBOL_SIZE
      )
    : {}
  const converterArtworkLayout = isDirectionalConverter
    ? (() => {
        const domains = getDomainForSymbol(device.symbol)
        return getConverterArtworkLayout(
          domains.inputDomain === 'DC' ? 'DC' : 'AC',
          domains.outputDomain === 'DC' ? 'DC' : 'AC',
          converterConnectionDomains
        )
      })()
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
      ...conversionLabelParts.map((part) => ({ key: part.key, text: part.text })),
      ...certificationLabelParts.map((part) => ({ key: part.key, text: part.text })),
      ...(showNotesLabel ? [{ key: 'trunkDeviceNotes' as const, text: notesText }] : []),
    ],
    [certificationLabelParts, conversionLabelParts, notesText, showNotesLabel]
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
  const metadataCalloutLayout = useMemo(() => {
    const renderedPeerPositions = supplyDevicePositions?.length
      ? supplyDevicePositions
      : [{ device, x: position.x, y: position.y }]
    const peerPositions = renderedPeerPositions.map((peer) => {
      const isScalableSupplyConverter =
        supportsCircuitConverterDcConnections(peer.device) &&
        (peer.device.supplyPath === 'converter-branch' || peer.device.supplyPath === 'backup')
      const visualX = isScalableSupplyConverter
        ? getSupplyConverterBodyGeometry(peer.device, { x: peer.x, y: peer.y }).center.x
        : peer.x
      return {
        ...peer,
        x: supplyMirrorAxisX == null ? visualX : supplyMirrorAxisX * 2 - visualX,
      }
    })
    const peers = peerPositions.filter(
      ({ device: peer }) =>
        isSupplyMetadataDevice(peer) &&
        !(peer.supplyPath === 'converter-grid' && peer.converterGridPlacement === 'input-leg')
    )
    const hasLongPeer = peers.some(({ device: peer }) => {
      const lines = getSupplyMetadataLinesForDevice(peer)
      return shouldUseSupplyDeviceMetadataCallout(peer, lines, getSupplyDeviceMultiplier(peer))
    })
    const clusters = getSupplyMetadataCalloutClusters(
      peers.map(({ device: peer }) => ({
        device: peer,
        lines: getSupplyMetadataLinesForDevice(peer),
      }))
    )
    if (!hasLongPeer) {
      return {
        placements: new Map<
          string,
          ReturnType<typeof getSupplyMetadataCalloutGroupPlacements> extends Map<
            string,
            infer Placement
          >
            ? Placement
            : never
        >(),
        clusters,
      }
    }

    const symbolRects = peers.map(({ device: peer, x, y }) => {
      const width = supportsCircuitConverterDcConnections(peer)
        ? SYMBOL_SIZE * getCircuitConverterDcConnectionCount(peer)
        : SYMBOL_SIZE
      return {
        left: x - width / 2 - 4,
        top: y - SYMBOL_SIZE / 2 - 4,
        right: x + width / 2 + 4,
        bottom: y + SYMBOL_SIZE / 2 + 4,
      }
    })
    const items = peers.flatMap(({ device: peer, x, y }) => {
      const cluster = clusters.get(peer.id)
      const lines = getSupplyMetadataLinesForDevice(peer, cluster?.totalMultiplier)
      if (lines.length === 0) return []
      if (cluster && cluster.representativeId !== peer.id) return []
      const clusterPeers = cluster
        ? peers.filter(({ device: candidate }) => cluster.targetIds.includes(candidate.id))
        : [{ device: peer, x, y }]
      const clusterX =
        clusterPeers.reduce((total, candidate) => total + candidate.x, 0) / clusterPeers.length
      const clusterY = Math.min(...clusterPeers.map((candidate) => candidate.y))
      const { width, height } = getSupplyMetadataCardSize(lines, fontFamily)
      return [
        {
          id: peer.id,
          symbolPosition: { x: clusterX, y: clusterY },
          width,
          height,
          placement: getSupplyMetadataCalloutPlacementKind({
            symbol: peer.symbol,
            peerCount: peers.length,
          }),
        },
      ]
    })
    const canonicalPlacements = getSupplyMetadataCalloutGroupPlacements({
      items,
      segments: wireSegments
        .filter((segment) => supplyPanelId == null || segment.panelId === supplyPanelId)
        .map((segment) =>
          supplyMirrorAxisX == null
            ? segment
            : {
                ...segment,
                startPoint: {
                  ...segment.startPoint,
                  x: supplyMirrorAxisX * 2 - segment.startPoint.x,
                },
                endPoint: {
                  ...segment.endPoint,
                  x: supplyMirrorAxisX * 2 - segment.endPoint.x,
                },
              }
        ),
      symbolRects,
      // Supply assemblies are mirrored for rendering. A canonical right-side
      // nudge becomes the visually preferable left-side placement.
      packRows: supplyMirrorAxisX == null,
      preferRightNudges: supplyMirrorAxisX != null,
    })
    const representativePositionById = new Map(
      peers.map((peer) => [peer.device.id, { x: peer.x, y: peer.y }])
    )
    if (supplyMirrorAxisX == null) {
      return {
        placements: new Map(
          [...canonicalPlacements].map(([id, placement]) => {
            const representative = representativePositionById.get(id) ?? placement.symbolPosition
            return [
              id,
              {
                ...placement,
                symbolPosition: representative,
                x: placement.rect.left - representative.x,
                y: placement.rect.top - representative.y,
              },
            ]
          })
        ),
        clusters,
      }
    }

    return {
      placements: new Map(
        [...canonicalPlacements].map(([id, placement]) => {
          const representative = representativePositionById.get(id) ?? placement.symbolPosition
          const renderedSymbolX = supplyMirrorAxisX * 2 - representative.x
          const renderedCardLeft = supplyMirrorAxisX * 2 - placement.rect.right
          return [
            id,
            {
              ...placement,
              symbolPosition: { x: renderedSymbolX, y: representative.y },
              x: renderedCardLeft - renderedSymbolX,
              y: placement.rect.top - representative.y,
              rect: {
                left: renderedCardLeft,
                top: placement.rect.top,
                right: supplyMirrorAxisX * 2 - placement.rect.left,
                bottom: placement.rect.bottom,
              },
            },
          ]
        })
      ),
      clusters,
    }
  }, [
    device,
    fontFamily,
    position.x,
    position.y,
    supplyDevicePositions,
    supplyMirrorAxisX,
    supplyPanelId,
    wireSegments,
  ])
  const metadataCalloutGroup = metadataCalloutLayout.placements
  const metadataCalloutCluster = metadataCalloutLayout.clusters.get(device.id)
  const isSharedMetadataRepresentative =
    metadataCalloutCluster?.representativeId === device.id &&
    metadataCalloutCluster.targetIds.length > 1
  const isSharedMetadataMember =
    metadataCalloutCluster != null && metadataCalloutCluster.targetIds.length > 1
  const renderedMetadataCalloutItems = useMemo(
    () =>
      applyMetadataCalloutMultiplier(
        metadataCalloutItems,
        metadataCalloutCluster?.totalMultiplier ?? supplyDeviceMultiplier
      ),
    [metadataCalloutCluster?.totalMultiplier, metadataCalloutItems, supplyDeviceMultiplier]
  )
  const renderedMetadataCalloutLines = useMemo(
    () => renderedMetadataCalloutItems.map((item) => item.text),
    [renderedMetadataCalloutItems]
  )
  const useMetadataCallout =
    metadataCallout != null ||
    (isSupplyMetadataDevice(device) &&
      isHorizontal === true &&
      metadataCalloutGroup.has(device.id) &&
      (!isSharedMetadataMember || isSharedMetadataRepresentative))
  const metadataCalloutVisualLineCount = useMemo(
    () =>
      renderedMetadataCalloutLines.reduce(
        (total, line) => total + countSymbolLabelVisualLines(line),
        0
      ),
    [renderedMetadataCalloutLines]
  )
  const metadataCalloutWidth = useMemo(
    () =>
      metadataCallout?.width ??
      getMetadataCalloutWidth(
        renderedMetadataCalloutLines.map((line) => measureSymbolLabelTextWidth(line, fontFamily, 8))
      ),
    [fontFamily, metadataCallout?.width, renderedMetadataCalloutLines]
  )
  const metadataCalloutHeight = metadataCallout?.height ?? metadataCalloutVisualLineCount * 10 + 10
  const metadataCalloutPlacement = useMemo(() => {
    if (metadataCallout) return { x: metadataCallout.x, y: metadataCallout.y }
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
    metadataCallout,
    metadataCalloutGroup,
    metadataCalloutPlacementKind,
    metadataCalloutWidth,
    position,
    wireSegments,
  ])
  const circuitConverterConnectionCount =
    circuitConverterAnchor && supportsCircuitConverterDcConnections(device)
      ? getCircuitConverterDcConnectionCount(device)
      : 1
  const isSupplyConverterResize =
    supportsCircuitConverterDcConnections(device) &&
    isHorizontal === true &&
    (device.supplyPath === 'converter-branch' || device.supplyPath === 'backup')
  const isOrdinaryConverterResize =
    supportsCircuitConverterDcConnections(device) &&
    circuitConverterAnchor != null &&
    !isSupplyConverterResize
  const converterResizeDirection = isSupplyConverterResize
    ? 'left'
    : isOrdinaryConverterResize
      ? 'right'
      : undefined
  const renderedSymbolSize = useMemo(() => {
    if (circuitConverterConnectionCount > 1) {
      return { width: SYMBOL_SIZE * circuitConverterConnectionCount, height: SYMBOL_SIZE }
    }
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
  }, [circuitConverterConnectionCount, isDomoticaDevice, processedImage])
  const metadataCalloutLeaderPoints =
    metadataCallout?.leaderPoints ??
    getSupplyMetadataCalloutLeaderPoints({
      placement: metadataCalloutPlacement,
      width: metadataCalloutWidth,
      height: metadataCalloutHeight,
      symbolWidth: renderedSymbolSize.width,
      symbolHeight: renderedSymbolSize.height,
      placementKind: metadataCalloutPlacementKind,
      mirrorHorizontally: supplyMirrorAxisX != null,
    })
  const metadataCalloutTargetIds =
    metadataCallout?.targetIds ??
    (isSharedMetadataRepresentative ? metadataCalloutCluster?.targetIds : undefined)
  const metadataCalloutLeaderPointSets = useMemo(() => {
    if (!isSharedMetadataRepresentative || !metadataCalloutTargetIds?.length) {
      return [metadataCalloutLeaderPoints]
    }
    const renderedPeers = supplyDevicePositions?.length
      ? supplyDevicePositions
      : [{ device, x: position.x, y: position.y }]
    const targets = metadataCalloutTargetIds.flatMap((targetId) => {
      const target = renderedPeers.find(({ device: peer }) => peer.id === targetId)
      if (!target) return []
      return [
        {
          position: { x: target.x - position.x, y: target.y - position.y },
          width: supportsCircuitConverterDcConnections(target.device)
            ? SYMBOL_SIZE * getCircuitConverterDcConnectionCount(target.device)
            : SYMBOL_SIZE,
          height: SYMBOL_SIZE,
        },
      ]
    })
    return getSupplyMetadataSharedLeaderPointSets({
      placement: metadataCalloutPlacement,
      width: metadataCalloutWidth,
      height: metadataCalloutHeight,
      targets,
    })
  }, [
    device,
    isSharedMetadataRepresentative,
    metadataCalloutHeight,
    metadataCalloutLeaderPoints,
    metadataCalloutPlacement,
    metadataCalloutTargetIds,
    metadataCalloutWidth,
    position.x,
    position.y,
    supplyDevicePositions,
  ])

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
      loadProcessedSymbol(path, isDark)
        .then(setter)
        .catch(() => setter(null))
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

      const currentProject = useProjectStore.getState().currentProject
      const pairedIds = currentProject
        ? getEarthingSeparatorPairIds(
            getElectricalInstallationFromProject(currentProject)?.groundTrunkDevices,
            device.id
          )
        : [device.id]
      if (e.evt.shiftKey) {
        const { selection } = useUIStore.getState()
        if (
          selection.type === 'trunkDevice' &&
          !pairedIds.every((id) => selection.ids.includes(id))
        ) {
          setSelection({ type: 'trunkDevice', ids: [...new Set([...selection.ids, ...pairedIds])] })
        } else if (selection.type !== 'trunkDevice') {
          setSelection({ type: 'trunkDevice', ids: pairedIds })
        }
      } else if (e.evt.altKey || e.evt.ctrlKey || e.evt.metaKey) {
        const { selection } = useUIStore.getState()
        if (
          selection.type === 'trunkDevice' &&
          pairedIds.some((id) => selection.ids.includes(id))
        ) {
          const newIds = selection.ids.filter((id) => !pairedIds.includes(id))
          if (newIds.length === 0) {
            useUIStore.getState().clearSelection()
          } else {
            setSelection({ type: 'trunkDevice', ids: newIds })
          }
        }
      } else {
        setSelection({ type: 'trunkDevice', ids: pairedIds })
      }
    },
    [device.id, setSelection]
  )
  const handleMetadataCalloutClick = useCallback(
    (event: unknown) => {
      if (!metadataCalloutTargetIds?.length) {
        handleClick(event)
        return
      }
      const e = event as EendraadPointerEvent
      e.cancelBubble = true
      if (e.evt.button != null && e.evt.button !== 0) return
      const { selection } = useUIStore.getState()
      setSelection(
        resolveTrunkDeviceMetadataCalloutSelection(selection, metadataCalloutTargetIds, {
          extend: !!e.evt.shiftKey,
          toggle: !!(e.evt.altKey || e.evt.ctrlKey || e.evt.metaKey),
        })
      )
    },
    [handleClick, metadataCalloutTargetIds, setSelection]
  )
  const metadataCalloutGestureHandlers = useCanvasPanOrClickGesture(handleMetadataCalloutClick)
  const handleMetadataCalloutMouseEnter = useCallback(
    (event: unknown) => {
      const e = event as EendraadPointerEvent
      e.cancelBubble = true
      if (metadataCalloutTargetIds?.length) {
        setHover({ type: 'trunkDevice', ids: metadataCalloutTargetIds })
      }
    },
    [metadataCalloutTargetIds, setHover]
  )
  const handleMetadataCalloutMouseLeave = useCallback(
    (event: unknown) => {
      const e = event as EendraadPointerEvent
      e.cancelBubble = true
      const { hover } = useUIStore.getState()
      if (
        metadataCalloutTargetIds?.length &&
        hover.type === 'trunkDevice' &&
        metadataCalloutTargetIds.every((id) => hover.ids.includes(id))
      ) {
        clearHover()
      }
    },
    [clearHover, metadataCalloutTargetIds]
  )
  const stopMetadataCalloutClickBubble = useCallback((event: unknown) => {
    const pointerEvent = event as EendraadPointerEvent
    pointerEvent.cancelBubble = true
  }, [])

  const rotateForHorizontal = isHorizontal && isProtection && !isInlineSwitch
  const rotateMirroredChangeover =
    isHorizontal === true && device.symbol === 'source_changeover' && supplyMirrorAxisX != null
  const renderedSymbolRotationDeg =
    symbolRotationDeg ?? (rotateMirroredChangeover ? 180 : rotateForHorizontal ? 90 : 0)
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
      converterIconSize
    )
  }
  const converterAcPosition = converterArtworkImagePosition('AC')
  const converterDcPosition = converterArtworkImagePosition('DC')
  const dcDcConverterPositions =
    isDirectionalConverter && device.symbol === 'dc_dc_converter'
      ? (['bottom-left', 'top-right'] as const).map((corner) =>
          getConverterCornerPosition(
            corner,
            renderedSymbolSize.width,
            renderedSymbolSize.height,
            converterIconMargin,
            converterIconSize
          )
        )
      : []
  const isWideCircuitConverter = circuitConverterConnectionCount > 1
  const currentConverterWidth = circuitConverterConnectionCount * SYMBOL_SIZE
  const previewConverterWidth =
    (converterResizePreviewCount ?? circuitConverterConnectionCount) * SYMBOL_SIZE
  const converterFixedEdge =
    converterResizeDirection === 'left' ? currentConverterWidth / 2 : -currentConverterWidth / 2
  const converterResizeEdge =
    converterResizeDirection === 'left'
      ? converterFixedEdge - previewConverterWidth
      : converterFixedEdge + previewConverterWidth
  const converterResizeDirectionSign = converterResizeDirection === 'left' ? -1 : 1
  const converterResizeHandleEdge =
    converterResizeEdge + converterResizeDirectionSign * CONVERTER_RESIZE_OUTLINE_PADDING
  const wideConverterArtworkInset =
    (CONVERTER_ARTWORK_EDGE / CONVERTER_ARTWORK_VIEWBOX_SIZE) * SYMBOL_SIZE
  const wideConverterArtworkStroke =
    (CONVERTER_ARTWORK_STROKE / CONVERTER_ARTWORK_VIEWBOX_SIZE) * SYMBOL_SIZE
  const wideConverterArtworkColor = getSymbolColor(theme?.mode === 'dark')
  const wideConverterArtworkLeft = -renderedSymbolSize.width / 2 + wideConverterArtworkInset
  const wideConverterArtworkRight = renderedSymbolSize.width / 2 - wideConverterArtworkInset
  const wideConverterArtworkTop = -renderedSymbolSize.height / 2 + wideConverterArtworkInset
  const wideConverterArtworkBottom = renderedSymbolSize.height / 2 - wideConverterArtworkInset

  const isHoveredAny = isHovered || isHoveredFromBreadcrumb

  if (device.type === 'dc_bus' || device.symbol === 'dc_bus') {
    const busWidth = Math.max(48, dcBusWidth ?? 48)
    const busStartX = -busWidth / 2
    const busEndX = busStartX + busWidth
    const busLineWidth = 5
    const busSelectionStroke =
      busLineWidth +
      screenPxToCanvasUnits(
        canvasZoom,
        WIRE_SELECTION_EXTRA_PX,
        WIRE_SELECTION_EXTRA_PX_MIN,
        WIRE_SELECTION_EXTRA_PX_MAX
      )
    const busHoverStroke = screenPxToCanvasUnits(
      canvasZoom,
      HOVER_OUTLINE_STROKE_PX,
      HOVER_OUTLINE_STROKE_PX_MIN,
      HOVER_OUTLINE_STROKE_PX_MAX
    )
    const busHoverDash = screenPxToCanvasUnits(
      canvasZoom,
      HOVER_OUTLINE_DASH_PX,
      HOVER_OUTLINE_DASH_PX_MIN,
      HOVER_OUTLINE_DASH_PX_MAX
    )
    const busColor =
      isSelected || isPreviewSelected ? SELECTION_COLOR : getSymbolColor(theme?.mode === 'dark')
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
            ? (event) => {
                const nativeEvent = event.evt as MouseEvent
                if (onDragStart(!!nativeEvent.altKey, nativeEvent)) event.target.stopDrag()
              }
            : undefined
        }
        onDragMove={
          canDragTrunk && onDragMove
            ? (event) =>
                onDragMove(
                  getCanvasPositionFromEvent?.(event) ?? {
                    x: event.target.x(),
                    y: event.target.y(),
                  }
                )
            : undefined
        }
        onDragEnd={
          canDragTrunk && onDragEnd
            ? (event) => {
                if (shouldSuppressKonvaDragEnd?.()) return
                onDragEnd(
                  getCanvasPositionFromEvent?.(event) ?? {
                    x: event.target.x(),
                    y: event.target.y(),
                  }
                )
                event.target.position({ x: position.x, y: position.y })
              }
            : undefined
        }
      >
        {/* Match ordinary busbars: a narrow line-shaped target, not the entire surrounding box. */}
        <Line
          points={[busStartX, 0, busEndX, 0]}
          stroke="transparent"
          strokeWidth={Math.max(busLineWidth + 10, 10)}
          lineCap="round"
        />
        <Line
          points={[busStartX, 0, busEndX, 0]}
          stroke={busColor}
          strokeWidth={isSelected || isPreviewSelected ? busSelectionStroke : busLineWidth}
          lineCap="round"
          listening={false}
        />
        {isHoveredAny && !isSelected && !isPreviewSelected && (
          <Line
            points={[busStartX, 0, busEndX, 0]}
            stroke={SELECTION_COLOR}
            strokeWidth={busHoverStroke}
            dash={[busHoverDash, busHoverDash]}
            lineCap="round"
            listening={false}
          />
        )}
        <DomainMarker
          domain="DC"
          x={busStartX - 10}
          y={0}
          color={getSecondaryTextColor(theme?.mode === 'dark')}
        />
        {!!device.label?.trim() && (
          <Text
            x={busStartX}
            y={8}
            text={device.label}
            fontFamily={fontFamily}
            fontSize={10}
            fill={getTextColor(theme?.mode === 'dark')}
          />
        )}
      </Group>
    )
  }

  if (!symbol || !processedImage) return null

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
          {...(isWideCircuitConverter
            ? {
                x: -renderedSymbolSize.width / 2 - (touchPrimary ? 7 : 4),
                y: -renderedSymbolSize.height / 2 - (touchPrimary ? 7 : 4),
                width: renderedSymbolSize.width + (touchPrimary ? 14 : 8),
                height: renderedSymbolSize.height + (touchPrimary ? 14 : 8),
                fill: 'transparent',
              }
            : getTouchAwareHitAreaProps(
                ENDPOINT_OUTLINE_SIZE,
                canvasZoom,
                isSelected,
                touchPrimary
              ))}
        />
      )}

      {/* Symbol image — offsetY by orientation; protection on horizontal trunk rotated 90° left */}
      {isWideCircuitConverter ? (
        <Rect
          x={wideConverterArtworkLeft}
          y={wideConverterArtworkTop}
          width={wideConverterArtworkRight - wideConverterArtworkLeft}
          height={wideConverterArtworkBottom - wideConverterArtworkTop}
          cornerRadius={(1.3 / CONVERTER_ARTWORK_VIEWBOX_SIZE) * SYMBOL_SIZE}
          fill="transparent"
          stroke={wideConverterArtworkColor}
          strokeWidth={wideConverterArtworkStroke}
          lineJoin="round"
          listening={false}
        />
      ) : (
        <Image
          image={processedImage}
          {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: renderedSymbolPath }}
          width={renderedSymbolSize.width}
          height={renderedSymbolSize.height}
          offsetX={isSurgeProtection ? surgeSymbolAnchor.x : renderedSymbolSize.width / 2}
          offsetY={isSurgeProtection ? surgeSymbolAnchor.y : renderedSymbolSize.height / 2}
          rotation={renderedSymbolRotationDeg}
          listening={false}
        />
      )}
      {isWideCircuitConverter && converterArtworkLayout ? (
        <Line
          points={
            converterArtworkLayout.diagonal === 'top-left-to-bottom-right'
              ? [
                  wideConverterArtworkLeft,
                  wideConverterArtworkTop,
                  wideConverterArtworkRight,
                  wideConverterArtworkBottom,
                ]
              : [
                  wideConverterArtworkLeft,
                  wideConverterArtworkBottom,
                  wideConverterArtworkRight,
                  wideConverterArtworkTop,
                ]
          }
          stroke={wideConverterArtworkColor}
          strokeWidth={wideConverterArtworkStroke}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      ) : isDirectionalConverter && converterDiagonalImage && converterArtworkLayout ? (
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
      ) : null}
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
      {isDirectionalConverter &&
        converterDcImage &&
        converterDcPosition &&
        device.symbol !== 'dc_dc_converter' && (
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
      {converterDcImage &&
        dcDcConverterPositions.map((iconPosition, index) => (
          <Image
            key={`dc-dc-domain-${index}`}
            image={converterDcImage}
            {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: CONVERTER_ARTWORK_PATHS.DC }}
            width={converterIconSize}
            height={converterIconSize}
            offsetX={converterIconSize / 2}
            offsetY={converterIconSize / 2}
            x={iconPosition.x}
            y={iconPosition.y}
            listening={false}
          />
        ))}
      {isSelected && converterResizeDirection && (
        <>
          {converterResizePreviewCount != null &&
            converterResizePreviewCount !== circuitConverterConnectionCount && (
              <Rect
                x={
                  converterResizeDirection === 'left'
                    ? converterFixedEdge - previewConverterWidth
                    : converterFixedEdge
                }
                y={-renderedSymbolSize.height / 2}
                width={previewConverterWidth}
                height={renderedSymbolSize.height}
                stroke="#0284c7"
                strokeWidth={1}
                dash={[3, 2]}
                listening={false}
              />
            )}
          <Rect
            x={converterResizeHandleEdge - CONVERTER_RESIZE_HANDLE_HIT_WIDTH / 2}
            y={-renderedSymbolSize.height / 2}
            width={CONVERTER_RESIZE_HANDLE_HIT_WIDTH}
            height={renderedSymbolSize.height}
            fill="transparent"
            draggable
            onMouseDown={(event) => {
              event.cancelBubble = true
            }}
            onClick={(event) => {
              event.cancelBubble = true
            }}
            onTap={(event) => {
              event.cancelBubble = true
            }}
            onDragStart={(event) => {
              event.cancelBubble = true
              converterResizeCountRef.current = circuitConverterConnectionCount
              setConverterResizePreviewCount(circuitConverterConnectionCount)
            }}
            onDragMove={(event) => {
              event.cancelBubble = true
              const handleCenter = event.target.x() + CONVERTER_RESIZE_HANDLE_HIT_WIDTH / 2
              const bodyEdgeAtPointer =
                handleCenter - converterResizeDirectionSign * CONVERTER_RESIZE_OUTLINE_PADDING
              const requestedWidth =
                converterResizeDirection === 'left'
                  ? converterFixedEdge - bodyEdgeAtPointer
                  : bodyEdgeAtPointer - converterFixedEdge
              const nextCount = clampConverterDcConnectionCount(requestedWidth / SYMBOL_SIZE)
              converterResizeCountRef.current = nextCount
              setConverterResizePreviewCount(nextCount)
              const snappedWidth = nextCount * SYMBOL_SIZE
              const snappedEdge =
                converterResizeDirection === 'left'
                  ? converterFixedEdge - snappedWidth
                  : converterFixedEdge + snappedWidth
              const snappedHandleEdge =
                snappedEdge + converterResizeDirectionSign * CONVERTER_RESIZE_OUTLINE_PADDING
              event.target.x(snappedHandleEdge - CONVERTER_RESIZE_HANDLE_HIT_WIDTH / 2)
              event.target.y(-renderedSymbolSize.height / 2)
            }}
            onDragEnd={(event) => {
              event.cancelBubble = true
              const nextCount = converterResizeCountRef.current ?? circuitConverterConnectionCount
              converterResizeCountRef.current = null
              setConverterResizePreviewCount(null)
              if (nextCount !== circuitConverterConnectionCount) {
                resizeConverterDcConnections(device.id, nextCount)
              }
            }}
            onMouseEnter={(event) => {
              const stage = event.target.getStage()
              if (stage) stage.container().style.cursor = 'ew-resize'
            }}
            onMouseLeave={(event) => {
              const stage = event.target.getStage()
              if (stage) stage.container().style.cursor = ''
            }}
          />
        </>
      )}
      {device.symbol === 'source_changeover' &&
        isSymbolLabelVisible(device.symbolLabelDisplay, 'changeoverPort1Label', true) &&
        (device.changeoverProps?.port1Label ?? '1').trim().length > 0 && (
          <Text
            x={
              rotateMirroredChangeover
                ? -renderedSymbolSize.width / 2 + 2
                : renderedSymbolSize.width / 2 - 162
            }
            y={
              rotateMirroredChangeover
                ? (renderedSymbolSize.height * 7) / 24 + 2
                : -(renderedSymbolSize.height * 7) / 24 - 11
            }
            width={160}
            text={device.changeoverProps?.port1Label ?? '1'}
            align={rotateMirroredChangeover ? 'left' : 'right'}
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
            x={
              rotateMirroredChangeover
                ? -renderedSymbolSize.width / 2 + 2
                : renderedSymbolSize.width / 2 - 162
            }
            y={
              rotateMirroredChangeover
                ? -(renderedSymbolSize.height * 7) / 24 - 11
                : (renderedSymbolSize.height * 7) / 24 + 2
            }
            width={160}
            text={device.changeoverProps?.port2Label ?? '2'}
            align={rotateMirroredChangeover ? 'left' : 'right'}
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

      {useMetadataCallout && renderedMetadataCalloutLines.length > 0 && (
        <>
          {metadataCalloutLeaderPointSets.map((points, index) => (
            <Line
              key={`${device.id}-metadata-leader-${index}`}
              points={points}
              stroke={getSecondaryTextColor(isDark ?? false)}
              strokeWidth={0.7}
              dash={[3, 3]}
              listening={false}
            />
          ))}
          <Group
            x={metadataCalloutPlacement.x}
            y={metadataCalloutPlacement.y}
            {...metadataCalloutGestureHandlers}
            onMouseEnter={handleMetadataCalloutMouseEnter}
            onMouseLeave={handleMetadataCalloutMouseLeave}
            onClick={stopMetadataCalloutClickBubble}
            onTap={stopMetadataCalloutClickBubble}
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
              text={renderedMetadataCalloutLines.join('\n')}
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
          rotation={renderedSymbolRotationDeg}
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
          rotation={renderedSymbolRotationDeg}
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
          rotation={renderedSymbolRotationDeg}
          listening={false}
        />
      )}

      {/* Generic trunk labels on the right: conversion details + notes (single stacked flow). */}
      {!useMetadataCallout && !isSharedMetadataMember && stackedRightLabelItems.length > 0 && (
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
        !isSharedMetadataMember &&
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
        !isSharedMetadataMember &&
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
            : isWideCircuitConverter || converterResizeDirection != null
              ? getPaddedRectPreviewOutlineProps(
                  canvasZoom,
                  -renderedSymbolSize.width / 2,
                  -renderedSymbolSize.height / 2,
                  renderedSymbolSize.width,
                  renderedSymbolSize.height,
                  4
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
            : isWideCircuitConverter || converterResizeDirection != null
              ? getPaddedRectHoverOutlineProps(
                  canvasZoom,
                  -renderedSymbolSize.width / 2,
                  -renderedSymbolSize.height / 2,
                  renderedSymbolSize.width,
                  renderedSymbolSize.height,
                  4
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
            : isWideCircuitConverter || converterResizeDirection != null
              ? getPaddedRectSelectionOutlineProps(
                  canvasZoom,
                  -renderedSymbolSize.width / 2,
                  -renderedSymbolSize.height / 2,
                  renderedSymbolSize.width,
                  renderedSymbolSize.height,
                  4
                )
              : getSelectionOutlineProps(canvasZoom, ENDPOINT_OUTLINE_SIZE))}
        />
      )}
      {/* Keep the resize pill above the yellow selection outline. */}
      {isSelected && converterResizeDirection && (
        <Rect
          x={converterResizeHandleEdge - CONVERTER_RESIZE_HANDLE_WIDTH / 2}
          y={-(renderedSymbolSize.height + 2) / 2}
          width={CONVERTER_RESIZE_HANDLE_WIDTH}
          height={renderedSymbolSize.height + 2}
          fill="#0284c7"
          opacity={0.9}
          cornerRadius={2}
          listening={false}
        />
      )}
    </Group>
  )
}
