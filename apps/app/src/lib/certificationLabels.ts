import i18n from '@/i18n'
import type {
  Endpoint,
  EnergyConversionDeviceProps,
  SymbolLabelDisplayConfig,
  TrunkDevice,
} from '@/types/schema'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'

export const CERTIFICATION_LISTING_VISIBILITY_KEY = 'certificationListing'

export type CertificationLabelKey =
  | 'certificationBrand'
  | 'certificationModel'
  | 'certificationSerial'
  | 'certificationPower'

export interface CertificationLabelPart {
  key: CertificationLabelKey
  text: string
}

export type CertificationLabelSource =
  | Pick<
      Endpoint,
      | 'symbol'
      | 'symbolLabelDisplay'
      | 'energyConversionProps'
      | 'evChargerProps'
      | 'batteryProps'
      | 'solarPanelProps'
    >
  | Pick<TrunkDevice, 'symbol' | 'symbolLabelDisplay' | 'conversionProps' | 'solarPanelProps'>

const CERT_FIELD_LABEL_KEYS = {
  brand: 'endpoints.certification.brand',
  model: 'endpoints.certification.model',
} as const

const DIAGRAM_POWER_PREFIX = 'P'

function conversionPropsFromSource(
  source: CertificationLabelSource
): EnergyConversionDeviceProps | undefined {
  const props = source as {
    conversionProps?: EnergyConversionDeviceProps
    energyConversionProps?: EnergyConversionDeviceProps
  }
  return props.conversionProps ?? props.energyConversionProps
}

export function isCertificationListingVisible(
  config: SymbolLabelDisplayConfig | undefined
): boolean {
  return isSymbolLabelVisible(config, CERTIFICATION_LISTING_VISIBILITY_KEY, true)
}

function certificationLine(
  key: CertificationLabelKey,
  labelKey: string,
  value: string | number | undefined
): CertificationLabelPart {
  const label = i18n.t(labelKey)
  if (value === undefined || value === null) {
    return { key, text: `${label}:` }
  }
  const text = typeof value === 'number' ? String(value) : value.trim()
  return { key, text: text ? `${label}: ${text}` : `${label}:` }
}

/** Serial number: value only (no long localized prefix on the one-wire). Omitted when empty. */
function serialNumberLine(value: string | undefined): CertificationLabelPart | null {
  const text = (value ?? '').trim()
  if (!text) return null
  return { key: 'certificationSerial', text }
}

/** Power: short `P:` prefix on the one-wire (all languages). */
function powerLine(value: string | undefined): CertificationLabelPart {
  const text = (value ?? '').trim()
  return {
    key: 'certificationPower',
    text: text ? `${DIAGRAM_POWER_PREFIX}: ${text}` : `${DIAGRAM_POWER_PREFIX}:`,
  }
}

function inverterRectifierParts(
  props: Endpoint['energyConversionProps'] | TrunkDevice['conversionProps'] | undefined
): CertificationLabelPart[] {
  return [
    certificationLine('certificationBrand', CERT_FIELD_LABEL_KEYS.brand, props?.brand),
    certificationLine('certificationModel', CERT_FIELD_LABEL_KEYS.model, props?.model),
    serialNumberLine(props?.serialNumber),
    powerLine(props?.power),
  ].filter((part): part is CertificationLabelPart => part != null)
}

function evChargerParts(props: Endpoint['evChargerProps'] | undefined): CertificationLabelPart[] {
  return [
    certificationLine('certificationBrand', CERT_FIELD_LABEL_KEYS.brand, props?.brand),
    certificationLine('certificationModel', CERT_FIELD_LABEL_KEYS.model, props?.model),
    serialNumberLine(props?.serialNumber),
  ].filter((part): part is CertificationLabelPart => part != null)
}

function batteryParts(props: Endpoint['batteryProps'] | undefined): CertificationLabelPart[] {
  const powerValue =
    props?.powerKw != null && Number.isFinite(props.powerKw) ? `${props.powerKw}kW` : undefined
  return [
    certificationLine('certificationBrand', CERT_FIELD_LABEL_KEYS.brand, props?.brand),
    certificationLine('certificationModel', CERT_FIELD_LABEL_KEYS.model, props?.model),
    serialNumberLine(props?.serialNumber),
    powerLine(powerValue),
  ].filter((part): part is CertificationLabelPart => part != null)
}

function solarPanelParts(
  props: Endpoint['solarPanelProps'] | TrunkDevice['solarPanelProps'] | undefined
): CertificationLabelPart[] {
  return [
    certificationLine('certificationBrand', CERT_FIELD_LABEL_KEYS.brand, props?.brand),
    certificationLine('certificationModel', CERT_FIELD_LABEL_KEYS.model, props?.model),
    serialNumberLine(props?.serialNumber),
  ].filter((part): part is CertificationLabelPart => part != null)
}

export function getVisibleCertificationLabelParts(
  source: CertificationLabelSource
): CertificationLabelPart[] {
  if (!isCertificationListingVisible(source.symbolLabelDisplay)) return []

  const symbol = source.symbol

  if (symbol === 'inverter' || symbol === 'rectifier') {
    return inverterRectifierParts(conversionPropsFromSource(source))
  }

  if (symbol === 'ev' && 'evChargerProps' in source) {
    return evChargerParts(source.evChargerProps)
  }

  if (symbol === 'battery' && 'batteryProps' in source) {
    return batteryParts(source.batteryProps)
  }

  if (symbol === 'solar_panel' && 'solarPanelProps' in source) {
    return solarPanelParts(source.solarPanelProps)
  }

  return []
}
