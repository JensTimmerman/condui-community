import { Text } from 'react-konva'
import { usePlanDragLabel, usePlanDragPosition } from '@/stores/planDragVisualStore'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  getSymbolColor,
  LIGHT_POINT_WATERPROOF_H_OFFSET_TOP,
  MULTI_SOCKET_OFFSET,
  SOCKET_WATERPROOF_H_FONT_SIZE,
  SOCKET_WATERPROOF_H_OFFSET_RIGHT,
  SOCKET_WATERPROOF_H_OFFSET_TOP,
  SYMBOL_SIZE,
} from '../eendraad/canvasSymbols'
import { PlacementLabel } from './PlacementLabel'
import type { Placement } from '@/types/schema'
import type { Endpoint } from '@/types/schema'

export function PlanPlacementLabelEntry({
  placementId,
  endpoint,
  junctionPanelLabel,
  staticLabelPosition,
  labelFontSize,
}: {
  placementId: string
  endpoint: Endpoint | null
  junctionPanelLabel?: string
  staticLabelPosition?: { x: number; y: number }
  labelFontSize: number
}) {
  const dragLabel = usePlanDragLabel(placementId)
  const labelPosition = dragLabel ?? staticLabelPosition
  const labelText = endpoint?.label ?? junctionPanelLabel
  if (!labelText || !labelPosition) return null
  return (
    <PlacementLabel
      endpoint={endpoint ?? { label: junctionPanelLabel }}
      labelPosition={labelPosition}
      labelFontSize={labelFontSize}
    />
  )
}

export function PlanPlacementSocketWaterproofH({
  placement,
  endpoint,
  baseSymbolSizePx,
  fontFamily,
}: {
  placement: Placement
  endpoint: Endpoint
  baseSymbolSizePx: number
  fontFamily: string
}) {
  const { theme } = useSettingsStore()
  const dragPos = usePlanDragPosition(placement.id)
  const placementPos = dragPos ?? placement.pos
  if (!endpoint.socketProps?.waterproof || !placementPos) return null

  const symSize = baseSymbolSizePx * placement.scale
  const scale = symSize / SYMBOL_SIZE
  const epSocketExtra =
    Math.max(0, (endpoint.socketProps?.socketCount || 1) - 1) * MULTI_SOCKET_OFFSET * scale
  const hX =
    placementPos.x + (SYMBOL_SIZE / 2 - SOCKET_WATERPROOF_H_OFFSET_RIGHT) * scale + epSocketExtra
  const hY = placementPos.y + (-SYMBOL_SIZE / 4 + SOCKET_WATERPROOF_H_OFFSET_TOP) * scale

  return (
    <Text
      x={hX}
      y={hY}
      text="h"
      fontSize={Math.max(
        SOCKET_WATERPROOF_H_FONT_SIZE,
        Math.round(SOCKET_WATERPROOF_H_FONT_SIZE * scale),
      )}
      fontFamily={fontFamily}
      fill={getSymbolColor(theme.mode === 'dark')}
      align="right"
      listening={false}
    />
  )
}

export function PlanPlacementLightWaterproofH({
  placement,
  endpoint,
  baseSymbolSizePx,
  fontFamily,
}: {
  placement: Placement
  endpoint: Endpoint
  baseSymbolSizePx: number
  fontFamily: string
}) {
  const { theme } = useSettingsStore()
  const dragPos = usePlanDragPosition(placement.id)
  const placementPos = dragPos ?? placement.pos
  if (
    endpoint.type !== 'light_point' ||
    endpoint.symbol !== 'light_point' ||
    !endpoint.lightPointProps?.waterproof ||
    !placementPos
  ) {
    return null
  }

  const symSize = baseSymbolSizePx * placement.scale
  const scale = symSize / SYMBOL_SIZE
  const hY = placementPos.y + (-SYMBOL_SIZE / 4 + LIGHT_POINT_WATERPROOF_H_OFFSET_TOP) * scale

  return (
    <Text
      x={placementPos.x}
      y={hY}
      text="h"
      fontSize={Math.max(
        SOCKET_WATERPROOF_H_FONT_SIZE,
        Math.round(SOCKET_WATERPROOF_H_FONT_SIZE * scale),
      )}
      fontFamily={fontFamily}
      fill={getSymbolColor(theme.mode === 'dark')}
      align="center"
      listening={false}
    />
  )
}
