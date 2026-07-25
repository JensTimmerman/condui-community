import type { Endpoint } from '@/types/schema'

export type SharedValue<T> = { mixed: false; value: T } | { mixed: true; value: undefined }

export function resolveSharedValue<T>(values: T[]): SharedValue<T> {
  if (values.length === 0) return { mixed: true, value: undefined }
  const first = JSON.stringify(values[0])
  return values.every((value) => JSON.stringify(value) === first)
    ? { mixed: false, value: values[0]! }
    : { mixed: true, value: undefined }
}

export function getEndpointMultiEditFamily(endpoint: Endpoint): string | null {
  if (endpoint.type === 'socket') return 'endpoint:socket'
  if (endpoint.type === 'light_point') return `endpoint:light:${endpoint.symbol ?? 'light_point'}`
  if (endpoint.type === 'fixed_appliance') {
    return `endpoint:appliance:${endpoint.symbol ?? 'fixed_appliance_generic'}`
  }
  if (endpoint.type === 'switch') return `endpoint:switch:${endpoint.symbol ?? 'switch'}`
  return null
}
