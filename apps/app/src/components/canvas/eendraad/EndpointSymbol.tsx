import { memo, useState, useEffect, useCallback, useMemo } from 'react'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { Group, Image, Line, Rect, Text } from 'react-konva'
import { useUIStore } from '@/stores/uiStore'
import { useEndpointSelected, useHoverIncludes, useSetSelection } from '@/editions/community/communityHooks'
import { useSettingsStore } from '@/stores/settingsStore'
import { logger } from '@/lib/logger'
import {
  getSymbolById,
  getFixedApplianceSymbolPath,
  SOCKET_OVERLAY_PATHS,
  getSwitchSymbolPaths,
  LIGHT_POINT_OVERLAY_PATHS,
  LIGHT_SPOT_OVERLAY_PATHS,
  HVAC_ENERGY_SOURCE_PATHS,
  HVAC_TYPE_OVERLAY_PATHS,
  RELAY_OVERLAY_PATHS,
  DOMOTICA_CONTROL_OVERLAY_PATHS,
  TRANSFORMER_OVERLAY_PATHS,
} from '@/lib/symbols'
import { loadProcessedSymbol } from '@/lib/symbolImage'
import {
  showLightPointDecentralOverlay,
  showLightPointSafetyOverlay,
} from '@/lib/lightPointProps'
import { endpointSupportsMultiplier, getEndpointMultiplier } from '@/utils/endpointMultipliers'
import { useIsPreviewSelected } from '@/contexts/SelectionPreviewContext'
import { useCanvasFontFamily, useEffectiveCanvasZoom, useTouchPrimaryDevice } from '@/editions/community/communityHooks'
import { applyTouchHitPadding } from '@/lib/canvas/touchHitZones'
import { SymbolTextLabels } from './SymbolTextLabels'
import {
  SYMBOL_SIZE,
  ENDPOINT_OUTLINE_SIZE,
  DOMOTICA_BASE_HEIGHT,
  DOMOTICA_BOX_WIDTH,
  DOMOTICA_OUTPUT_SPACING,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_CONTROL_BAR_HEIGHT,
  MULTI_SOCKET_OFFSET,
  getSocketExtraWidth,
  getSymbolColor,
  getEndpointHoverOutlineProps,
  getEndpointPreviewOutlineProps,
  getEndpointSelectionOutlineProps,
  getPaddedRectHoverOutlineProps,
  getPaddedRectPreviewOutlineProps,
  getPaddedRectSelectionOutlineProps,
  getSecondaryTextColor,
  SOCKET_WATERPROOF_H_OFFSET_RIGHT,
  SOCKET_WATERPROOF_H_OFFSET_TOP,
  SOCKET_WATERPROOF_H_FONT_SIZE,
  LIGHT_POINT_WATERPROOF_H_OFFSET_TOP,
  HVAC_ENERGY_OFFSET_Y_FACTOR,
  HVAC_FUNCTION_OFFSET_X_FACTOR,
  HVAC_HEAT_EXCHANGE_TYPE_OFFSET_Y,
} from './canvasSymbols'
import type { Endpoint, DomoticaControlKey } from '@/types/schema'
import type { Point } from '@/types/ui'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import {
  getVisibleConversionLabelParts,
  getVisibleEndpointNoteText,
} from '@/lib/conversionLabels'

const INTERACTIVE_HIT_FILL = 'rgba(0, 0, 0, 0.01)'
type EendraadPointerEvent = {
  cancelBubble: boolean
  evt: { button?: number; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
}
type WindowWithEendraTapSuppression = Window & { __eendraSuppressNextElementTap?: boolean }

interface EndpointSymbolProps {
  endpoint: Endpoint
  position: Point
  /**
   * Called when a drag ends. Should return `true` when the drop was accepted
   * and `false` when it was rejected (invalid target) so the symbol can snap back.
   */
  onDragEnd: (newPos: Point) => boolean | void
  /** Optional live drag callback used by 1‑draad internal drag/preview pipeline. */
  onDragMove?: (newPos: Point) => void
  /** Alt/Option at drag start; return true to use pointer-driven duplicate (source stays put). */
  onDragStart?: (altKey: boolean, nativeEvt: MouseEvent) => boolean
  shouldSuppressKonvaDragEnd?: () => boolean
  /** When true, this endpoint is allowed to be dragged (still gated by selection). */
  draggable?: boolean
  /** Convert Konva drag events to the cursor position in canvas coordinates. */
  getCanvasPositionFromEvent?: (e: unknown) => Point | null
  /** Whether this endpoint is the final symbol on its horizontal branch. */
  isEndpointAtBranchEnd?: boolean
  /** Clamp bottom label text away from the branch wire when needed. */
  bottomLabelMinimumLeftX?: number
  /** Truncate bottom label text before it enters the next circuit column. */
  bottomLabelMaximumRightX?: number
}

export const EndpointSymbol = memo(function EndpointSymbol({
  endpoint,
  position,
  onDragEnd,
  onDragMove,
  onDragStart,
  shouldSuppressKonvaDragEnd,
  draggable = false,
  getCanvasPositionFromEvent,
  isEndpointAtBranchEnd = true,
  bottomLabelMinimumLeftX,
  bottomLabelMaximumRightX,
}: EndpointSymbolProps) {
  const setSelection = useSetSelection()
  const isSelected = useEndpointSelected(endpoint)
  const isHoveredFromBreadcrumb = useHoverIncludes('endpoint', endpoint.id)
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const touchPrimary = useTouchPrimaryDevice()
  const theme = useSettingsStore((state) => state.theme)
  const fontFamily = useCanvasFontFamily()
  const isPreviewSelected = useIsPreviewSelected('endpoint', endpoint.id)
  const [processedImage, setProcessedImage] = useState<HTMLImageElement | null>(null)
  const [overlaySwitchImage, setOverlaySwitchImage] = useState<HTMLImageElement | null>(null)
  const [overlaySwitchLockImage, setOverlaySwitchLockImage] = useState<HTMLImageElement | null>(null)
  const [switchOverlayImage, setSwitchOverlayImage] = useState<HTMLImageElement | null>(null)
  const [lightPointSafetyImage, setLightPointSafetyImage] = useState<HTMLImageElement | null>(null)
  const [lightPointDecentralImage, setLightPointDecentralImage] = useState<HTMLImageElement | null>(null)
  const [lightPointSwitchImage, setLightPointSwitchImage] = useState<HTMLImageElement | null>(null)
  const [lightSpotBeamImage, setLightSpotBeamImage] = useState<HTMLImageElement | null>(null)
  const [transformerSafetyImage, setTransformerSafetyImage] = useState<HTMLImageElement | null>(null)
  const [transformerShortcircuitImage, setTransformerShortcircuitImage] = useState<HTMLImageElement | null>(null)
  const [transformerProtectionImage, setTransformerProtectionImage] = useState<HTMLImageElement | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [hvacEnergyImage, setHvacEnergyImage] = useState<HTMLImageElement | null>(null)
  const [hvacTypeImage, setHvacTypeImage] = useState<HTMLImageElement | null>(null)
  const [relayOverlayImage, setRelayOverlayImage] = useState<HTMLImageElement | null>(null)
  const [domoticaMainImage, setDomoticaMainImage] = useState<HTMLImageElement | null>(null)
  const [domoticaControlImages, setDomoticaControlImages] = useState<
    Partial<Record<DomoticaControlKey, HTMLImageElement | null>>
  >({})
  
  const symbol = endpoint.symbol ? getSymbolById(endpoint.symbol) : null
  const isDomoticaParent = endpoint.symbol === 'domotica' && !endpoint.domoticaChildProps

  const isSocket = endpoint.type === 'socket'
  const isSwitch = endpoint.type === 'switch'
  const socketProps = endpoint.socketProps
  const switchProps = endpoint.switchProps
  const showSwitchOverlay = isSocket && socketProps?.switchOverlay
  const showSwitchOverlayLock = isSocket && socketProps?.switchOverlayLock
  const showSocketWaterproof = isSocket && socketProps?.waterproof
  const socketCount = isSocket ? (socketProps?.socketCount || 1) : 1
  const socketExtraWidth = getSocketExtraWidth(socketCount)
  const isLightPoint = endpoint.type === 'light_point' && endpoint.symbol === 'light_point'
  const isLightSpot = endpoint.type === 'light_point' && endpoint.symbol === 'light_spot'
  const isLightFluorescent = endpoint.type === 'light_point' && endpoint.symbol === 'light_fluorescent'
  const lightPointProps = endpoint.lightPointProps
  const showLightPointWaterproof = isLightPoint && lightPointProps?.waterproof
  const onWallExtraWidth = isLightPoint && lightPointProps?.onWall ? 6 : 0
  const totalExtraWidth = socketExtraWidth + onWallExtraWidth
  const lightSpotProps = endpoint.lightSpotProps
  const lightFluorescentProps = endpoint.lightFluorescentProps
  const tubeCount = isLightFluorescent ? (lightFluorescentProps?.tubeCount ?? 1) : 1
  const isHvac = endpoint.symbol === 'furnace'
  const hvacProps = endpoint.hvacProps
  const relayProps = endpoint.relayProps
  const domoticaProps = endpoint.domoticaProps
  const isTransformer = endpoint.symbol === 'transformer'
  const conversionProps = endpoint.energyConversionProps
  const prefersRightEndpointLabel =
    endpoint.symbol === 'solar_panel' ||
    endpoint.symbol === 'battery' ||
    endpoint.symbol === 'ev'
  const endpointLabelPosition =
    prefersRightEndpointLabel && isEndpointAtBranchEnd ? 'right' : 'bottom'
  const conversionLabelParts = getVisibleConversionLabelParts(endpoint)
  const certificationLabelParts = getVisibleCertificationLabelParts(endpoint)
  const endpointNoteText = getVisibleEndpointNoteText(endpoint)
  const symbolSideLabelItems = [
    ...conversionLabelParts,
    ...certificationLabelParts,
    ...(endpointNoteText ? [{ key: 'endpointNotes' as const, text: endpointNoteText }] : []),
  ]

  const domoticaMainType = domoticaProps?.mainDeviceType
  const domoticaMainSwitchSymbol = domoticaProps?.mainSwitchSymbol
  const domoticaMainSocketSymbol = domoticaProps?.mainSocketSymbol
  const domoticaMainSwitchProps = domoticaProps?.mainSwitchProps

  // Resolve base SVG path: switches use getSwitchSymbolPaths; boiler/heating use getFixedApplianceSymbolPath; else symbol.svgPath
  const baseSvgPath = isDomoticaParent
    ? null
    : isSwitch && endpoint.symbol
      ? getSwitchSymbolPaths(endpoint.symbol, switchProps).basePath
      : endpoint.symbol === 'boiler'
        ? getFixedApplianceSymbolPath('boiler', endpoint.fixedApplianceProps) ?? symbol?.svgPath
        : endpoint.symbol === 'heating'
          ? getFixedApplianceSymbolPath('heating', endpoint.fixedApplianceProps) ?? symbol?.svgPath
          : symbol?.svgPath
  const switchOverlayPath = isSwitch && endpoint.symbol
    ? getSwitchSymbolPaths(endpoint.symbol, switchProps).overlayPath
    : undefined

  const hvacEnergyKey = hvacProps?.energySource ?? 'none'
  const hvacTypeKey = hvacProps?.hvacType ?? 'none'
  const hvacFunctionKey = hvacProps?.hvacFunction ?? 'none'

  useEffect(() => {
    if (!baseSvgPath) {
      setProcessedImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
    loadProcessedSymbol(baseSvgPath, isDark).then(setProcessedImage).catch(() => {
      logger.error('Failed to load symbol:', baseSvgPath)
      setProcessedImage(null)
    })
  }, [baseSvgPath, theme.mode])

  // Load socket overlay images when socketProps request them
  useEffect(() => {
    if (!showSwitchOverlay && !showSwitchOverlayLock) {
      setOverlaySwitchImage(null)
      setOverlaySwitchLockImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
    if (showSwitchOverlay) {
      loadProcessedSymbol(SOCKET_OVERLAY_PATHS.switchOverlay, isDark).then(setOverlaySwitchImage).catch(() => setOverlaySwitchImage(null))
    } else {
      setOverlaySwitchImage(null)
    }
    if (showSwitchOverlayLock) {
      loadProcessedSymbol(SOCKET_OVERLAY_PATHS.switchOverlayLock, isDark).then(setOverlaySwitchLockImage).catch(() => setOverlaySwitchLockImage(null))
    } else {
      setOverlaySwitchLockImage(null)
    }
  }, [showSwitchOverlay, showSwitchOverlayLock, theme?.mode])

  // Load switch verklikkerlamp overlay when switchProps.verklikkerlamp
  useEffect(() => {
    if (!switchOverlayPath) {
      setSwitchOverlayImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
    loadProcessedSymbol(switchOverlayPath, isDark).then(setSwitchOverlayImage).catch(() => setSwitchOverlayImage(null))
  }, [switchOverlayPath, theme?.mode])

  // Load light point overlays (safety, decentral, switch 1p)
  useEffect(() => {
    if (!isLightPoint || !lightPointProps) {
      setLightPointSafetyImage(null)
      setLightPointDecentralImage(null)
      setLightPointSwitchImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
    if (showLightPointSafetyOverlay(lightPointProps)) {
      loadProcessedSymbol(LIGHT_POINT_OVERLAY_PATHS.safety, isDark).then(setLightPointSafetyImage).catch(() => setLightPointSafetyImage(null))
    } else {
      setLightPointSafetyImage(null)
    }
    if (showLightPointDecentralOverlay(lightPointProps)) {
      loadProcessedSymbol(LIGHT_POINT_OVERLAY_PATHS.decentral, isDark).then(setLightPointDecentralImage).catch(() => setLightPointDecentralImage(null))
    } else {
      setLightPointDecentralImage(null)
    }
    if (lightPointProps.switch1p) {
      loadProcessedSymbol(LIGHT_POINT_OVERLAY_PATHS.switch1p, isDark).then(setLightPointSwitchImage).catch(() => setLightPointSwitchImage(null))
    } else {
      setLightPointSwitchImage(null)
    }
  }, [
    isLightPoint,
    lightPointProps,
    lightPointProps?.safety,
    lightPointProps?.decentral,
    lightPointProps?.autonomous,
    lightPointProps?.switch1p,
    theme?.mode,
  ])

  // Load transformer overlays (safety type, short‑circuit, protection)
  useEffect(() => {
    if (!isTransformer) {
      setTransformerSafetyImage(null)
      setTransformerShortcircuitImage(null)
      setTransformerProtectionImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
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
    theme?.mode,
  ])

  // Load light spot beam overlay
  useEffect(() => {
    if (!isLightSpot || !lightSpotProps?.beamType || lightSpotProps.beamType === 'none') {
      setLightSpotBeamImage(null)
      return
    }
    const path = lightSpotProps.beamType === 'straight' ? LIGHT_SPOT_OVERLAY_PATHS.straight : LIGHT_SPOT_OVERLAY_PATHS.diverging
    const isDark = theme?.mode === 'dark'
    loadProcessedSymbol(path, isDark).then(setLightSpotBeamImage).catch(() => setLightSpotBeamImage(null))
  }, [isLightSpot, lightSpotProps?.beamType, theme?.mode])

  // Load HVAC energy source overlays
  useEffect(() => {
    if (!isHvac || !hvacEnergyKey || hvacEnergyKey === 'none') {
      setHvacEnergyImage(null)
      return
    }
    const path = HVAC_ENERGY_SOURCE_PATHS[hvacEnergyKey as keyof typeof HVAC_ENERGY_SOURCE_PATHS]
    if (!path) {
      setHvacEnergyImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
    loadProcessedSymbol(path, isDark)
      .then(setHvacEnergyImage)
      .catch(() => setHvacEnergyImage(null))
  }, [isHvac, hvacEnergyKey, theme?.mode])

  // Load HVAC type overlays
  useEffect(() => {
    if (!isHvac || !hvacTypeKey || hvacTypeKey === 'none') {
      setHvacTypeImage(null)
      return
    }
    const path = HVAC_TYPE_OVERLAY_PATHS[hvacTypeKey as keyof typeof HVAC_TYPE_OVERLAY_PATHS]
    if (!path) {
      setHvacTypeImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
    loadProcessedSymbol(path, isDark)
      .then(setHvacTypeImage)
      .catch(() => setHvacTypeImage(null))
  }, [isHvac, hvacTypeKey, theme?.mode])

  // Load relay control overlay (based on relayProps.control)
  useEffect(() => {
    if (endpoint.symbol !== 'relay') {
      setRelayOverlayImage(null)
      return
    }
    const controlKey = relayProps?.control ?? 'standard'
    const path = RELAY_OVERLAY_PATHS[controlKey as keyof typeof RELAY_OVERLAY_PATHS]
    if (!path) {
      setRelayOverlayImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
    loadProcessedSymbol(path, isDark).then(setRelayOverlayImage).catch(() => setRelayOverlayImage(null))
  }, [endpoint.symbol, relayProps?.control, theme?.mode])

  // Load domotica control overlay icons (shared SVGs per key)
  useEffect(() => {
    if (!isDomoticaParent) {
      setDomoticaControlImages({})
      return
    }
    const isDark = theme?.mode === 'dark'
    const keys: Array<keyof typeof DOMOTICA_CONTROL_OVERLAY_PATHS> = [
      'programmed_control',
      'wireless_control',
      'detection_control',
      'button_control',
    ]
    keys.forEach((key) => {
      const path = DOMOTICA_CONTROL_OVERLAY_PATHS[key]
      loadProcessedSymbol(path, isDark)
        .then((img) => {
          setDomoticaControlImages((prev) => ({ ...prev, [key]: img }))
        })
        .catch(() => {
          setDomoticaControlImages((prev) => ({ ...prev, [key]: null }))
        })
    })
  }, [isDomoticaParent, theme?.mode])

  // Load domotica main device symbol (inner symbol rendered in lower section of frame)
  useEffect(() => {
    if (!isDomoticaParent) {
      setDomoticaMainImage(null)
      return
    }
    let path: string | null = null
    if (domoticaMainType === 'switch' && domoticaMainSwitchSymbol) {
      if (domoticaMainSwitchSymbol === 'relay') {
        const sym = getSymbolById('relay')
        path = sym?.svgPath ?? null
      } else {
        path = getSwitchSymbolPaths(domoticaMainSwitchSymbol, domoticaMainSwitchProps).basePath
      }
    } else if (domoticaMainType === 'socket' && domoticaMainSocketSymbol) {
      const sym = getSymbolById(domoticaMainSocketSymbol)
      path = sym?.svgPath ?? null
    }
    if (!path) {
      setDomoticaMainImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
    loadProcessedSymbol(path, isDark).then(setDomoticaMainImage).catch(() => setDomoticaMainImage(null))
  }, [isDomoticaParent, domoticaMainType, domoticaMainSwitchSymbol, domoticaMainSwitchProps, domoticaMainSocketSymbol, theme?.mode])

  const handleClick = useCallback((event: unknown) => {
    const e = event as EendraadPointerEvent
    // logger.info('[Touch] EndpointSymbol tap/click', { id: endpoint.id, type: e.type, button: e.evt?.button })
    const eendraWindow = window as WindowWithEendraTapSuppression
    if (eendraWindow.__eendraSuppressNextElementTap) {
      eendraWindow.__eendraSuppressNextElementTap = false
      // logger.info('[Touch] EndpointSymbol tap/click suppressed by long-press', { id: endpoint.id })
      return
    }
    e.cancelBubble = true
    
    if (e.evt.button != null && e.evt.button !== 0) {
      return
    }
    
    if (e.evt.shiftKey) {
      const { selection } = useUIStore.getState()
      if (selection.type === 'endpoint' && !selection.ids.includes(endpoint.id)) {
        setSelection({ type: 'endpoint', ids: [...selection.ids, endpoint.id] })
      } else if (selection.type !== 'endpoint') {
        setSelection({ type: 'endpoint', ids: [endpoint.id] })
      }
    } else if (e.evt.altKey || e.evt.ctrlKey || e.evt.metaKey) {
      const { selection } = useUIStore.getState()
      if (selection.type === 'endpoint' && selection.ids.includes(endpoint.id)) {
        const newIds = selection.ids.filter((id) => id !== endpoint.id)
        if (newIds.length === 0) {
          useUIStore.getState().clearSelection()
        } else {
          setSelection({ type: 'endpoint', ids: newIds })
        }
      }
    } else {
      setSelection({ type: 'endpoint', ids: [endpoint.id] })
    }
  }, [endpoint.id, setSelection])

  // Selected by endpoint id (1‑wire, drag rect, …) or by sitplan placement id (multiplied symbols)
  const isHoveredAny = isHovered || isHoveredFromBreadcrumb
  const multiplier = endpointSupportsMultiplier(endpoint) ? getEndpointMultiplier(endpoint) : 1

  const standardHitRect = useMemo(() => {
    const base = {
      x: -ENDPOINT_OUTLINE_SIZE / 2,
      y: -ENDPOINT_OUTLINE_SIZE / 2,
      width: ENDPOINT_OUTLINE_SIZE + totalExtraWidth,
      height: ENDPOINT_OUTLINE_SIZE,
    }
    return applyTouchHitPadding(base, canvasZoom, isSelected, touchPrimary)
  }, [canvasZoom, isSelected, touchPrimary, totalExtraWidth])
  const domoticaEndpointCount = Math.max(
    DOMOTICA_MIN_ENDPOINT_OUTPUTS,
    Math.min(
      DOMOTICA_MAX_ENDPOINT_OUTPUTS,
      Math.trunc(domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS),
    ),
  )
  const domoticaHeight = DOMOTICA_BASE_HEIGHT + Math.max(0, domoticaEndpointCount - 1) * DOMOTICA_OUTPUT_SPACING

  if (!symbol) return null
  if (!processedImage && !isDomoticaParent) return null

  if (isDomoticaParent) {
    const strokeColor = getSymbolColor(theme?.mode === 'dark')
    // Keep the bottom edge fixed at the same place as a normal endpoint (height = DOMOTICA_BASE_HEIGHT)
    // and let additional rows grow upwards.
    const outlineX = 0
    const outlineY = -domoticaHeight / 2
    const outlineWidth = DOMOTICA_BOX_WIDTH
    const outlineHeight = domoticaHeight
    // Outline rect is slightly larger than the box, with rounded corners
    const outlinePad = 2
    const controlBandHeight = Math.min(DOMOTICA_CONTROL_BAR_HEIGHT, domoticaHeight / 2)
    const dividerY = outlineY + controlBandHeight

    const domoticaControlKeys = new Set<DomoticaControlKey>(domoticaProps?.control ?? [])
    const mainDeviceSize = SYMBOL_SIZE*0.75
    const domoticaHitRect = applyTouchHitPadding(
      { x: outlineX, y: outlineY - 2, width: outlineWidth, height: outlineHeight + 4 },
      canvasZoom,
      isSelected,
      touchPrimary,
    )
    return (
      <Group
        name={`endpoint-${endpoint.id}`}
        x={position.x - DOMOTICA_BOX_WIDTH/2}
        y={position.y }
        draggable={draggable}
        onDragStart={
          draggable && onDragStart
            ? (e) => {
                const evt = e.evt as MouseEvent
                if (onDragStart(!!evt.altKey, evt)) {
                  e.target.stopDrag()
                  e.target.position({ x: position.x - DOMOTICA_BOX_WIDTH / 2, y: position.y })
                }
              }
            : undefined
        }
        onDragEnd={
          draggable
            ? (e) => {
                if (shouldSuppressKonvaDragEnd?.()) {
                  e.target.position({ x: position.x - DOMOTICA_BOX_WIDTH / 2, y: position.y })
                  return
                }
                onDragEnd(getCanvasPositionFromEvent?.(e) ?? { x: e.target.x(), y: e.target.y() })
              }
            : undefined
        }
        onClick={handleClick}
        onTap={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Rect
          {...domoticaHitRect}
          fill={INTERACTIVE_HIT_FILL}
          listening={true}
        />
        <Rect
          x={outlineX}
          y={outlineY}
          width={DOMOTICA_BOX_WIDTH}
          height={domoticaHeight}
          fill="transparent"
          stroke={strokeColor}
          strokeWidth={1}
          listening={false}
        />
        
        {isPreviewSelected && !isSelected && (
          <Rect
            {...getPaddedRectPreviewOutlineProps(
              canvasZoom,
              outlineX,
              outlineY,
              outlineWidth,
              outlineHeight,
              outlinePad,
            )}
          />
        )}
        {isHoveredAny && !isSelected && !isPreviewSelected && (
          <Rect
            {...getPaddedRectHoverOutlineProps(
              canvasZoom,
              outlineX,
              outlineY,
              outlineWidth,
              outlineHeight,
              outlinePad,
            )}
          />
        )}
        {isSelected && (
          <Rect
            {...getPaddedRectSelectionOutlineProps(
              canvasZoom,
              outlineX,
              outlineY,
              outlineWidth,
              outlineHeight,
              outlinePad,
            )}
          />
        )}
        {/* Horizontal divider between control band and main device area */}
        <Line
          points={[outlineX, dividerY, outlineX + DOMOTICA_BOX_WIDTH, dividerY]}
          stroke={strokeColor}
          strokeWidth={0.6}
          listening={false}
        />

        {/* Control icons (top band) */}
        {(() => {
          const activeKeys = (Array.from(domoticaControlKeys) as DomoticaControlKey[]).filter((key) =>
            ['programmed_control', 'wireless_control', 'detection_control', 'button_control'].includes(key),
          ) as Array<keyof typeof DOMOTICA_CONTROL_OVERLAY_PATHS>
          const count = activeKeys.length
          if (count === 0) return null
          return activeKeys.map((key, index) => {
            const cx = outlineX + (DOMOTICA_BOX_WIDTH * (index + 1)) / (count + 1)
            const cy = outlineY + controlBandHeight / 2
            const image = domoticaControlImages[key]
            if (!image) return null
            return (
              <Image
                key={key}
                image={image}
                width={SYMBOL_SIZE * 0.3}
                height={SYMBOL_SIZE * 0.3}
                offsetX={(SYMBOL_SIZE * 0.3) / 2}
                offsetY={(SYMBOL_SIZE * 0.3) / 2}
                x={cx}
                y={cy}
                listening={false}
              />
            )
          })
        })()}

        {/* Main device symbol (lower section, centered, same scale as regular symbols) */}
        
        {domoticaMainImage && domoticaMainType && (
          <Image
            image={domoticaMainImage}
            width={mainDeviceSize}
            height={mainDeviceSize}
            offsetX={mainDeviceSize / 2}
            offsetY={mainDeviceSize / 2}
            x={outlineX + DOMOTICA_BOX_WIDTH / 2}
            y={dividerY + (domoticaHeight - controlBandHeight) / 2 }
            listening={false}
          />
        )}
      </Group>
    )
  }

  return (
    <Group
      name={`endpoint-${endpoint.id}`}
      x={position.x}
      y={position.y}
      // Only allow dragging when explicitly enabled *and* this endpoint is selected.
      draggable={draggable && isSelected}
      onDragStart={
        draggable && isSelected && onDragStart
          ? (e) => {
              const evt = e.evt as MouseEvent
              if (onDragStart(!!evt.altKey, evt)) {
                e.target.stopDrag()
                e.target.position({ x: position.x, y: position.y })
              }
            }
          : undefined
      }
      onDragMove={draggable && isSelected && onDragMove ? (e) => {
        onDragMove(getCanvasPositionFromEvent?.(e) ?? { x: e.target.x(), y: e.target.y() })
      } : undefined}
      onDragEnd={draggable && isSelected ? (e) => {
        if (shouldSuppressKonvaDragEnd?.()) {
          e.target.position({ x: position.x, y: position.y })
          return
        }
        const accepted = onDragEnd(getCanvasPositionFromEvent?.(e) ?? { x: e.target.x(), y: e.target.y() })
        // If drop was rejected (no valid target), snap the symbol back to its
        // original layout-driven position so the real symbol never "sticks"
        // at an illegal location.
        if (accepted === false) {
          e.target.position({ x: position.x, y: position.y })
        }
      } : undefined}
      onClick={handleClick}
      onTap={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Invisible hit area - matches outline size for hover detection, grows for multi-socket */}
      <Rect
        {...standardHitRect}
        fill={INTERACTIVE_HIT_FILL}
        listening={true}
      />
      
      {/* Render socket symbols (1-4 copies offset to the right) */}
      {processedImage && Array.from({ length: socketCount }, (_, i) => (
        <Group key={i} x={i * MULTI_SOCKET_OFFSET}>
          <Image
            image={processedImage}
            width={SYMBOL_SIZE}
            height={SYMBOL_SIZE}
            offsetX={SYMBOL_SIZE / 2}
            offsetY={SYMBOL_SIZE / 2}
            y={0}
            listening={false}
          />
          {/* Relay control overlay */}
          {endpoint.symbol === 'relay' && relayOverlayImage && (
            <Image
              image={relayOverlayImage}
              width={SYMBOL_SIZE}
              height={SYMBOL_SIZE}
              offsetX={SYMBOL_SIZE / 2}
              offsetY={SYMBOL_SIZE / 2}
              y={0}
              listening={false}
            />
          )}
          {overlaySwitchImage && (
            <Image
              image={overlaySwitchImage}
              width={SYMBOL_SIZE}
              height={SYMBOL_SIZE}
              offsetX={SYMBOL_SIZE / 2}
              offsetY={SYMBOL_SIZE / 2}
              y={0}
              listening={false}
            />
          )}
          {overlaySwitchLockImage && (
            <Image
              image={overlaySwitchLockImage}
              width={SYMBOL_SIZE}
              height={SYMBOL_SIZE}
              offsetX={SYMBOL_SIZE / 2}
              offsetY={SYMBOL_SIZE / 2}
              y={0}
              listening={false}
            />
          )}
          {switchOverlayImage && (
            <Image
              image={switchOverlayImage}
              width={SYMBOL_SIZE}
              height={SYMBOL_SIZE}
              offsetX={SYMBOL_SIZE / 2}
              offsetY={SYMBOL_SIZE / 2}
              y={0}
              listening={false}
            />
          )}
          {/* Light point overlays: safety, switch 1p */}
          {isLightPoint && lightPointSafetyImage && (
            <Image
              image={lightPointSafetyImage}
              width={SYMBOL_SIZE}
              height={SYMBOL_SIZE}
              offsetX={SYMBOL_SIZE / 2}
              offsetY={SYMBOL_SIZE / 2}
              y={0}
              listening={false}
            />
          )}
          {isLightPoint && lightPointDecentralImage && (
            <Image
              image={lightPointDecentralImage}
              width={SYMBOL_SIZE}
              height={SYMBOL_SIZE}
              offsetX={SYMBOL_SIZE / 2}
              offsetY={SYMBOL_SIZE / 2}
              y={0}
              listening={false}
            />
          )}
          {isLightPoint && lightPointSwitchImage && (
            <Image
              image={lightPointSwitchImage}
              width={SYMBOL_SIZE}
              height={SYMBOL_SIZE}
              offsetX={SYMBOL_SIZE / 2}
              offsetY={SYMBOL_SIZE / 2}
              y={0}
              listening={false}
            />
          )}
          {/* Light point: on wall – line to the right (eendraad only) */}
          {isLightPoint && lightPointProps?.onWall && (() => {
            const gap = 2
            const halfHeight = (SYMBOL_SIZE / 2) + 1
            const xStart = SYMBOL_SIZE / 2 + gap
            return (
              <Line
                points={[xStart, -halfHeight, xStart, halfHeight]}
                stroke={getSymbolColor(theme?.mode === 'dark')}
                strokeWidth={1}
                listening={false}
              />
            )
          })()}
          {/* Light fluorescent: dynamic tube lines (1 = centered, 2 = over 25% height, 3 = even) */}
          {isLightFluorescent && (() => {
            const tubeMarginX = 0.5
            const halfSpan = (SYMBOL_SIZE / 2) - tubeMarginX
            const strokeColor = getSymbolColor(theme?.mode === 'dark')
            const tubeStrokeWidth = 1
            let yPositions: number[]
            if (tubeCount === 1) {
              yPositions = [0]
            } else if (tubeCount === 2) {
              const bandHeight = SYMBOL_SIZE * 0.2
              yPositions = [-bandHeight / 2, bandHeight / 2]
            } else {
              const step = SYMBOL_SIZE / 8
              yPositions = [-step, 0, step]
            }
            return yPositions.map((y, idx) => (
              <Line
                key={idx}
                points={[-halfSpan, y, halfSpan, y]}
                stroke={strokeColor}
                strokeWidth={tubeStrokeWidth}
                listening={false}
              />
            ))
          })()}
          {/* Light spot: beam overlay */}
          {isLightSpot && lightSpotBeamImage && (
            <Image
              image={lightSpotBeamImage}
              width={SYMBOL_SIZE}
              height={SYMBOL_SIZE}
              offsetX={SYMBOL_SIZE / 2}
              offsetY={SYMBOL_SIZE / 2}
              y={0}
              listening={false}
            />
          )}

          {/* Transformer overlays */}
          {isTransformer && transformerSafetyImage && (
            <Image
              image={transformerSafetyImage}
              width={SYMBOL_SIZE}
              height={SYMBOL_SIZE}
              offsetX={SYMBOL_SIZE / 2}
              offsetY={SYMBOL_SIZE / 2}
              y={0}
              listening={false}
            />
          )}
          {isTransformer && transformerShortcircuitImage && (
            <Image
              image={transformerShortcircuitImage}
              width={SYMBOL_SIZE}
              height={SYMBOL_SIZE}
              offsetX={SYMBOL_SIZE / 2}
              offsetY={SYMBOL_SIZE / 2}
              y={0}
              listening={false}
            />
          )}
          {isTransformer && transformerProtectionImage && (
            <Image
              image={transformerProtectionImage}
              width={SYMBOL_SIZE}
              height={SYMBOL_SIZE}
              offsetX={SYMBOL_SIZE / 2}
              offsetY={SYMBOL_SIZE / 2}
              y={0}
              listening={false}
            />
          )}

          {/* Conversion + endpoint notes (branch-tip solar/battery/EV: right; others: bottom) */}
          {symbolSideLabelItems.length > 0 && (
            <SymbolTextLabels
              items={symbolSideLabelItems.map((part) => ({ key: part.key, text: part.text }))}
              config={{ position: endpointLabelPosition, layout: 'stack' }}
              sideLabelBlockAlign={
                endpointLabelPosition === 'right'
                  ? 'center'
                  : 'auto'
              }
              textColor={getSecondaryTextColor(theme?.mode === 'dark')}
              fontFamily={fontFamily}
              fontSize={8}
              symbolSize={SYMBOL_SIZE}
              bottomMinimumLeftX={
                endpointLabelPosition === 'bottom' ? bottomLabelMinimumLeftX : undefined
              }
              bottomMaximumRightX={
                endpointLabelPosition === 'bottom' ? bottomLabelMaximumRightX : undefined
              }
            />
          )}

          {/* HVAC overlays: type (center), energy + function on bottom */}
          {isHvac && (
            <>
              {/* Type overlay (centered, with small upward offset for heat exchange) */}
              {hvacTypeImage && (
                <Image
                  image={hvacTypeImage}
                  width={SYMBOL_SIZE}
                  height={SYMBOL_SIZE}
                  offsetX={SYMBOL_SIZE / 2}
                  offsetY={SYMBOL_SIZE / 2}
                  y={hvacTypeKey === 'heat_exchange' ? HVAC_HEAT_EXCHANGE_TYPE_OFFSET_Y : 0}
                  listening={false}
                />
              )}
              {(() => {
                const hasEnergy = !!hvacEnergyImage && hvacEnergyKey !== 'none'
                const hasFunction = hvacFunctionKey !== 'none'
                if (!hasEnergy && !hasFunction) return null

                const baseY = SYMBOL_SIZE * HVAC_ENERGY_OFFSET_Y_FACTOR
                const xOffset = SYMBOL_SIZE * HVAC_FUNCTION_OFFSET_X_FACTOR
                const energyX = hasEnergy && hasFunction ? -xOffset : 0
                const funcX = hasEnergy && hasFunction ? xOffset : 0

                const funcText =
                  hvacFunctionKey === 'heat'
                    ? '+'
                    : hvacFunctionKey === 'cool'
                      ? '-'
                      : hvacFunctionKey === 'heat_cool'
                        ? '+/-'
                        : ''

                // Center text visually over funcX: single char vs "+/-"
                const funcXAdjust =
                  funcText === '+/-'
                    ? -SYMBOL_SIZE * 0.07
                    : funcText.length === 1
                      ? SYMBOL_SIZE * 0.02
                      : 0

                return (
                  <>
                    {hasEnergy && hvacEnergyImage && (
                      <Image
                        image={hvacEnergyImage}
                        width={SYMBOL_SIZE}
                        height={SYMBOL_SIZE}
                        offsetX={SYMBOL_SIZE / 2}
                        offsetY={SYMBOL_SIZE / 2}
                        x={energyX}
                        y={baseY}
                        listening={false}
                      />
                    )}
                    {hasFunction && funcText && (
                      <Text
                        text={funcText}
                        x={funcX + funcXAdjust}
                        y={baseY - 2}
                        fontSize={4}
                        fontFamily={fontFamily}
                        fill={getSymbolColor(theme?.mode === 'dark')}
                        align="center"
                        listening={false}
                      />
                    )}
                  </>
                )
              })()}
            </>
          )}
        </Group>
      ))}
      {showSocketWaterproof && (
        <Text
          text="h"
          x={SYMBOL_SIZE / 2 - SOCKET_WATERPROOF_H_OFFSET_RIGHT + socketExtraWidth}
          y={-SYMBOL_SIZE / 4 + SOCKET_WATERPROOF_H_OFFSET_TOP}
          fontSize={SOCKET_WATERPROOF_H_FONT_SIZE}
          fontFamily={fontFamily}
          fill={getSymbolColor(theme?.mode === 'dark')}
          align="right"
          listening={false}
        />
      )}
      {showLightPointWaterproof && (
        <Text
          text="h"
          x={socketExtraWidth + onWallExtraWidth}
          y={-SYMBOL_SIZE / 4 + LIGHT_POINT_WATERPROOF_H_OFFSET_TOP}
          fontSize={SOCKET_WATERPROOF_H_FONT_SIZE}
          fontFamily={fontFamily}
          fill={getSymbolColor(theme?.mode === 'dark')}
          align="center"
          listening={false}
        />
      )}
      {multiplier > 1 && (
        <Text
          text={`${multiplier}x`}
          x={ENDPOINT_OUTLINE_SIZE / 2 + socketExtraWidth - 2}
          y={-ENDPOINT_OUTLINE_SIZE / 2 - 10}
          fontSize={8}
          fontStyle="bold"
          fill={getSymbolColor(theme?.mode === 'dark')}
          align="right"
          listening={false}
        />
      )}
      {/* Preview highlight (during selection rectangle drag) — grows for multi-socket */}
      {isPreviewSelected && !isSelected && (
        <Rect
          {...getEndpointPreviewOutlineProps(
            canvasZoom,
            ENDPOINT_OUTLINE_SIZE + totalExtraWidth,
            ENDPOINT_OUTLINE_SIZE,
          )}
        />
      )}
      {/* Hover highlight (from breadcrumb or mouse) — grows for multi-socket */}
      {isHoveredAny && !isSelected && !isPreviewSelected && (
        <Rect
          {...getEndpointHoverOutlineProps(
            canvasZoom,
            ENDPOINT_OUTLINE_SIZE + totalExtraWidth,
            ENDPOINT_OUTLINE_SIZE,
          )}
        />
      )}
      {/* Selection outline — grows for multi-socket */}
      {isSelected && (
        <Rect
          {...getEndpointSelectionOutlineProps(
            canvasZoom,
            ENDPOINT_OUTLINE_SIZE + totalExtraWidth,
            ENDPOINT_OUTLINE_SIZE,
          )}
        />
      )}
      {/* Label removed - already shown on branch to the left */}
    </Group>
  )
})
