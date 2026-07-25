import type { Endpoint, EnergyConversionDeviceProps, TrunkDevice } from '@/types/schema'

type ConversionSource =
  | Pick<
      Endpoint,
      'symbolLabelDisplay' | 'energyConversionProps' | 'solarPanelProps' | 'batteryProps' | 'symbol'
    >
  | Pick<TrunkDevice, 'symbolLabelDisplay' | 'conversionProps' | 'symbol'>

export type ConversionLabelKey =
  | 'conversionTransformerLabel'
  | 'conversionPmaxPrimary'
  | 'conversionPmaxSecondary'
  | 'solarPower'
  | 'batteryVoltage'
  | 'batteryCapacity'

export interface ConversionLabelPart {
  key: ConversionLabelKey
  text: string
}

const DEFAULT_VISIBILITY: Record<ConversionLabelKey, boolean> = {
  conversionTransformerLabel: true,
  conversionPmaxPrimary: true,
  conversionPmaxSecondary: true,
  solarPower: true,
  batteryVoltage: true,
  batteryCapacity: true,
}

export function isConversionLabelVisible(source: ConversionSource, key: ConversionLabelKey): boolean {
  const configured = source.symbolLabelDisplay?.visibility?.[key]
  if (typeof configured === 'boolean') return configured
  return DEFAULT_VISIBILITY[key]
}

export function getVisibleEndpointNoteText(
  endpoint: Pick<Endpoint, 'notes' | 'notesVisible'>,
): string {
  if (endpoint.notesVisible === false) return ''
  return (endpoint.notes ?? '').trim()
}

export function getVisibleConversionLabelParts(source: ConversionSource): ConversionLabelPart[] {
  const props = source as {
    conversionProps?: EnergyConversionDeviceProps
    energyConversionProps?: EnergyConversionDeviceProps
  }
  const conversionProps = props.conversionProps ?? props.energyConversionProps

  const transformerLabel = (source.symbol === 'transformer'
    ? conversionProps?.transformerOverlayLabel
    : '')?.trim()
  const pMaxPrimary = (conversionProps?.pMaxPrimaryW ?? '').trim()
  const pMaxSecondary = (conversionProps?.pMaxSecondaryW ?? '').trim()
  const solarPower =
    'solarPanelProps' in source && source.solarPanelProps?.wattageW != null
      ? `${source.solarPanelProps.wattageW}W`
      : ''
  const batteryVoltage =
    'batteryProps' in source && source.batteryProps?.voltageV != null
      ? `${source.batteryProps.voltageV}V`
      : ''
  const batteryCapacity =
    'batteryProps' in source && source.batteryProps?.capacityKWh != null
      ? `${source.batteryProps.capacityKWh}kWh`
      : ''

  const parts: ConversionLabelPart[] = []
  if (transformerLabel && isConversionLabelVisible(source, 'conversionTransformerLabel')) {
    parts.push({ key: 'conversionTransformerLabel', text: transformerLabel })
  }
  if (pMaxPrimary && isConversionLabelVisible(source, 'conversionPmaxPrimary')) {
    parts.push({ key: 'conversionPmaxPrimary', text: `Uprim: ${pMaxPrimary}` })
  }
  if (pMaxSecondary && isConversionLabelVisible(source, 'conversionPmaxSecondary')) {
    parts.push({ key: 'conversionPmaxSecondary', text: `Usec: ${pMaxSecondary}` })
  }
  if (solarPower && isConversionLabelVisible(source, 'solarPower')) {
    parts.push({ key: 'solarPower', text: `P: ${solarPower}` })
  }
  if (batteryVoltage && isConversionLabelVisible(source, 'batteryVoltage')) {
    parts.push({ key: 'batteryVoltage', text: `U: ${batteryVoltage}` })
  }
  if (batteryCapacity && isConversionLabelVisible(source, 'batteryCapacity')) {
    parts.push({ key: 'batteryCapacity', text: `C: ${batteryCapacity}` })
  }
  return parts
}
