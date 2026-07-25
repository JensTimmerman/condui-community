/* eslint-disable react-refresh/only-export-components */
import { Layer, Stage } from 'react-konva'
import { EndpointSymbol } from '@/components/canvas/eendraad/EndpointSymbol'
import { ENDPOINT_OUTLINE_SIZE, getSocketExtraWidth } from '@/components/canvas/eendraad/canvasSymbols'
import type { Endpoint } from '@/types/schema'

const DEFAULT_CARD_WIDTH = 54
const PREVIEW_PADDING_X = 14
const PREVIEW_PADDING_Y = 10

export interface QuickPlacerPreviewMetrics {
  cardWidth: number
  stageWidth: number
  stageHeight: number
  symbolX: number
  symbolY: number
}

export function getQuickPlacerPreviewMetrics(endpoint: Endpoint): QuickPlacerPreviewMetrics {
  const socketCount = endpoint.type === 'socket' ? (endpoint.socketProps?.socketCount ?? 1) : 1
  const socketExtraWidth = getSocketExtraWidth(socketCount)
  const onWallExtraWidth =
    endpoint.type === 'light_point' &&
    endpoint.symbol === 'light_point' &&
    endpoint.lightPointProps?.onWall
      ? 6
      : 0
  const totalExtraWidth = socketExtraWidth + onWallExtraWidth
  const stageWidth = ENDPOINT_OUTLINE_SIZE + totalExtraWidth + 8
  const stageHeight = ENDPOINT_OUTLINE_SIZE + PREVIEW_PADDING_Y

  return {
    cardWidth: Math.max(DEFAULT_CARD_WIDTH, stageWidth + PREVIEW_PADDING_X),
    stageWidth,
    stageHeight,
    symbolX: stageWidth / 2 - totalExtraWidth / 2,
    symbolY: stageHeight / 2,
  }
}

interface QuickPlacerSymbolPreviewProps {
  endpoint: Endpoint
}

export function QuickPlacerSymbolPreview({ endpoint }: QuickPlacerSymbolPreviewProps) {
  const metrics = getQuickPlacerPreviewMetrics(endpoint)

  return (
    <div
      className="pointer-events-none flex items-center justify-center"
      style={{ width: metrics.stageWidth, height: metrics.stageHeight }}
      aria-hidden="true"
    >
      <Stage
        width={metrics.stageWidth}
        height={metrics.stageHeight}
        listening={false}
        style={{ pointerEvents: 'none' }}
      >
        <Layer listening={false}>
          <EndpointSymbol
            endpoint={endpoint}
            position={{ x: metrics.symbolX, y: metrics.symbolY }}
            onDragEnd={() => undefined}
            draggable={false}
          />
        </Layer>
      </Stage>
    </div>
  )
}
