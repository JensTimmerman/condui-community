import type { Installation } from '@/types/schema'
import type { SiteGeocodingV2, GeoPointV2 } from '@/types/projectV2'

const GEOAPIFY_AUTOCOMPLETE_URL = 'https://api.geoapify.com/v1/geocode/autocomplete'

export interface GeoapifyAddressSuggestion {
  id: string
  formatted: string
  address: Installation['address']
  location: GeoPointV2
  geocoding: SiteGeocodingV2
}

interface GeoapifyFeature {
  properties?: {
    place_id?: string
    formatted?: string
    address_line1?: string
    street?: string
    housenumber?: string
    postcode?: string
    city?: string
    town?: string
    village?: string
    municipality?: string
    country_code?: string
    country?: string
    lat?: number
    lon?: number
    rank?: {
      confidence?: number
      confidence_street_level?: number
      confidence_city_level?: number
    }
    result_type?: string
  }
}

interface GeoapifyAutocompleteResponse {
  features?: GeoapifyFeature[]
}

export function getGeoapifyApiKey(): string {
  return import.meta.env.VITE_GEOAPIFY_API_KEY?.trim() ?? ''
}

export function isGeoapifyConfigured(): boolean {
  return getGeoapifyApiKey().length > 0
}

function toAccuracy(resultType: string | undefined): SiteGeocodingV2['accuracy'] {
  if (resultType === 'building' || resultType === 'amenity') return 'rooftop'
  if (resultType === 'postcode' || resultType === 'street') return 'street'
  if (resultType === 'city' || resultType === 'county' || resultType === 'state') return 'city'
  return undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toStreetWithNumber(properties: NonNullable<GeoapifyFeature['properties']>): string {
  if (properties.street) {
    return properties.housenumber ? `${properties.street} ${properties.housenumber}` : properties.street
  }

  const addressLineStreet = properties.address_line1?.split(',')[0]?.trim()
  if (!addressLineStreet) return ''

  const city = properties.city ?? properties.town ?? properties.village ?? properties.municipality
  const withoutPostcode = properties.postcode
    ? addressLineStreet.replace(new RegExp(`\\b${escapeRegExp(properties.postcode)}\\b`, 'i'), '').trim()
    : addressLineStreet
  return city
    ? withoutPostcode.replace(new RegExp(`\\b${escapeRegExp(city)}\\b`, 'i'), '').trim()
    : withoutPostcode
}

function toSuggestion(feature: GeoapifyFeature, index: number): GeoapifyAddressSuggestion | null {
  const p = feature.properties
  if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number') return null

  const city = p.city ?? p.town ?? p.village ?? p.municipality ?? ''
  const streetWithNumber = toStreetWithNumber(p)
  const country = (p.country_code ?? p.country ?? 'BE').toUpperCase()
  const formatted = p.formatted ?? [streetWithNumber, p.postcode, city, country].filter(Boolean).join(', ')
  const confidence =
    p.rank?.confidence ?? p.rank?.confidence_street_level ?? p.rank?.confidence_city_level

  return {
    id: p.place_id ?? `${p.lat},${p.lon}-${index}`,
    formatted,
    address: {
      street: streetWithNumber,
      postalCode: p.postcode ?? '',
      city,
      country,
    },
    location: {
      latitude: p.lat,
      longitude: p.lon,
      crs: 'EPSG:4326',
    },
    geocoding: {
      provider: 'geoapify',
      providerPlaceId: p.place_id,
      resolvedAt: new Date().toISOString(),
      formattedAddress: formatted,
      confidence,
      accuracy: toAccuracy(p.result_type),
    },
  }
}

export async function searchGeoapifyAddresses(
  text: string,
  options: { signal?: AbortSignal; limit?: number; countryCode?: string } = {}
): Promise<GeoapifyAddressSuggestion[]> {
  const apiKey = getGeoapifyApiKey()
  const query = text.trim()
  if (!apiKey || query.length < 3) return []

  const url = new URL(GEOAPIFY_AUTOCOMPLETE_URL)
  url.searchParams.set('text', query)
  url.searchParams.set('apiKey', apiKey)
  url.searchParams.set('limit', String(options.limit ?? 5))
  url.searchParams.set('format', 'geojson')
  url.searchParams.set('lang', 'nl')
  if (options.countryCode) {
    url.searchParams.set('filter', `countrycode:${options.countryCode.toLowerCase()}`)
  }

  const response = await fetch(url.toString(), { signal: options.signal })
  if (!response.ok) {
    throw new Error(`Geoapify autocomplete failed (${response.status})`)
  }

  const data = (await response.json()) as GeoapifyAutocompleteResponse
  return (data.features ?? [])
    .map((feature, index) => toSuggestion(feature, index))
    .filter((suggestion): suggestion is GeoapifyAddressSuggestion => suggestion != null)
}
