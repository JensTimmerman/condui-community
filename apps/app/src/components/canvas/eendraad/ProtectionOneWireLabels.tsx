import { Text } from 'react-konva'
import { SymbolTextLabels } from './SymbolTextLabels'
import {
  getProtectionOneWireAnchorLineIndex,
  getProtectionOneWireLabelLines,
} from '@/lib/protectionLabels'
import type {
  ProtectionDevice,
  SymbolLabelDisplayConfig,
  SymbolLabelPosition,
  TrunkDevice,
} from '@/types/schema'
import { SYMBOL_SIZE } from './canvasSymbols'

type ProtectionLike = ProtectionDevice | TrunkDevice

function mergeProtectionLabelConfig(
  device: ProtectionLike,
  defaults: { position: SymbolLabelPosition }
): SymbolLabelDisplayConfig {
  const d = device.symbolLabelDisplay
  return {
    ...d,
    position: d?.position ?? defaults.position,
    layout: 'stack',
  }
}

export interface ProtectionOneWireLabelsProps {
  source: ProtectionLike
  /** When `source.symbolLabelDisplay.position` is unset */
  defaultPosition: SymbolLabelPosition
  /** Split type and residual-current details when the combined line would collide. */
  splitResidualLine?: boolean
  textColor: string
  fontFamily: string
  fontSize?: number
  /** Explicit narrowed circuit phase, rendered low on the symbol's left side. */
  phaseLabel?: string
  symbolSize?: number
  symbolWidth?: number
  symbolHeight?: number
  /** Same handler as clicking the protection / trunk device symbol (technical label as extra hit target). */
  onLabelClick?: (e: unknown) => void
}

/** One-wire technical labels (poles, curve, A, mA, kA) for protection devices on bus or trunk. */
export function ProtectionOneWireLabels({
  source,
  defaultPosition,
  textColor,
  fontFamily,
  fontSize = 10,
  phaseLabel,
  symbolSize = SYMBOL_SIZE,
  symbolWidth,
  symbolHeight,
  splitResidualLine = false,
  onLabelClick,
}: ProtectionOneWireLabelsProps) {
  const wireLines = getProtectionOneWireLabelLines(source, { splitResidualLine })
  if (wireLines.length === 0 && !phaseLabel) return null

  const resolvedSymbolWidth = symbolWidth ?? symbolSize
  const resolvedSymbolHeight = symbolHeight ?? symbolSize
  const phaseLabelFontSize = Math.max(7, fontSize - 2)
  const phaseLabelWidth = Math.max(
    resolvedSymbolWidth * 1.5,
    (phaseLabel?.length ?? 0) * phaseLabelFontSize * 0.65
  )

  return (
    <>
      {wireLines.length > 0 && (
        <SymbolTextLabels
          items={[]}
          lines={wireLines.map((line) => line.text)}
          lineFrames={wireLines.map((line) => line.frame ?? false)}
          anchorLineIndex={getProtectionOneWireAnchorLineIndex(wireLines)}
          config={mergeProtectionLabelConfig(source, { position: defaultPosition })}
          textColor={textColor}
          fontFamily={fontFamily}
          fontSize={fontSize}
          symbolSize={symbolSize}
          symbolWidth={symbolWidth}
          symbolHeight={symbolHeight}
          onLabelClick={onLabelClick}
        />
      )}
      {phaseLabel && (
        <Text
          x={-resolvedSymbolWidth / 2 - phaseLabelWidth - 2}
          y={resolvedSymbolHeight / 2 + 1}
          width={phaseLabelWidth}
          text={phaseLabel}
          fontSize={phaseLabelFontSize}
          fontFamily={fontFamily}
          fill={textColor}
          align="right"
          wrap="none"
          listening={false}
        />
      )}
    </>
  )
}
