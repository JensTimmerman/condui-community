import { useEffect, useState } from 'react'
import { Group, Image, Text as KonvaText } from 'react-konva'
import { useCanvasFontFamily } from '@/editions/community/communityHooks'
import { loadProcessedSymbol } from '@/lib/symbolImage'
import { useSettingsStore } from '@/stores/settingsStore'

export const DOMAIN_MARKER_ICON_SIZE = 8.25
export const DOMAIN_MARKER_FONT_SIZE = 4.5

interface DomainMarkerProps {
  domain: 'AC' | 'DC'
  x: number
  y: number
  color: string
}

/** Shared AC/DC text-and-symbol marker used by ordinary and supply conversion wires. */
export function DomainMarker({ domain, x, y, color }: DomainMarkerProps) {
  const theme = useSettingsStore((state) => state.theme)
  const fontFamily = useCanvasFontFamily()
  const [symbolImage, setSymbolImage] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    loadProcessedSymbol(`/symbols/energy-conversion/symbol_${domain}.svg`, theme?.mode === 'dark')
      .then(setSymbolImage)
      .catch(() => setSymbolImage(null))
  }, [domain, theme?.mode])

  if (!symbolImage) return null

  return (
    <Group x={x} y={y} listening={false}>
      <KonvaText
        x={-DOMAIN_MARKER_ICON_SIZE / 2}
        y={-DOMAIN_MARKER_ICON_SIZE / 2 - DOMAIN_MARKER_FONT_SIZE + 1}
        width={DOMAIN_MARKER_ICON_SIZE}
        text={domain}
        fontSize={DOMAIN_MARKER_FONT_SIZE}
        fontFamily={fontFamily}
        fill={color}
        align="center"
        listening={false}
      />
      <Image
        image={symbolImage}
        width={DOMAIN_MARKER_ICON_SIZE}
        height={DOMAIN_MARKER_ICON_SIZE}
        offsetX={DOMAIN_MARKER_ICON_SIZE / 2}
        offsetY={DOMAIN_MARKER_ICON_SIZE / 2}
        listening={false}
      />
    </Group>
  )
}
