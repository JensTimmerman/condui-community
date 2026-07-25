import type { Endpoint } from '@/types/schema'

export function endpointSupportsMultiplier(endpoint: Endpoint): boolean {
  if (endpoint.type === 'light_point') return true
  if (endpoint.type === 'switch' && endpoint.symbol === 'switch_impulse') return true
  // Allow multipliers for DC energy endpoints on sitplan
  if (endpoint.type === 'fixed_appliance' && (endpoint.symbol === 'solar_panel' || endpoint.symbol === 'battery')) {
    return true
  }
  return false
}

/**
 * Canonical multiplier is derived from sitplan placement count.
 */
export function getEndpointMultiplier(endpoint: Endpoint): number {
  if (!endpointSupportsMultiplier(endpoint)) return 1
  return Math.max(1, endpoint.placements.length)
}
