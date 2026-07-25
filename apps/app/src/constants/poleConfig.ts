/**
 * Shared pole configuration options and helpers.
 * Used by protection devices (MCB, RCD, RCBO) and energy meters (branch and trunk).
 * UI shows simplified 1P–4P; legacy values (1P+N, 3P+N) are mapped for display and validation can assume details from setup.
 */
import type { PolesConfig } from '@/types/schema'

/** Simplified pole options shown in UI (1–4 poles). Stored as PolesConfig; legacy 1P+N/3P+N map to 2P/4P for display. */
export const POLE_CONFIG_OPTIONS_SIMPLE = ['1P', '2P', '3P', '4P'] as const
export type PoleOptionSimple = (typeof POLE_CONFIG_OPTIONS_SIMPLE)[number]

/** Full list for dropdowns: 1P, 2P, 3P, 4P (same as simple). */
export const POLE_CONFIG_OPTIONS: PolesConfig[] = [...POLE_CONFIG_OPTIONS_SIMPLE]

/** Derive numeric pole count from polesConfig. */
export function polesFromConfig(config: string | undefined): number {
  switch (config) {
    case '1P':
      return 1
    case '1P+N':
    case '2P':
      return 2
    case '3P':
      return 3
    case '3P+N':
    case '4P':
      return 4
    default:
      return 2
  }
}

/** Map stored polesConfig to simplified display value (1P, 2P, 3P, 4P). Use for UI selects and labels. */
export function polesConfigToDisplay(config: string | undefined): PoleOptionSimple | '' {
  if (!config) return ''
  switch (config) {
    case '1P':
      return '1P'
    case '1P+N':
    case '2P':
      return '2P'
    case '3P':
      return '3P'
    case '3P+N':
    case '4P':
      return '4P'
    default:
      return ''
  }
}

/** Get polesConfig for display when only numeric poles exist (legacy data). Returns simplified 1P–4P. */
export function configFromPoles(poles: number | undefined): PolesConfig | '' {
  if (poles == null) return ''
  switch (poles) {
    case 1:
      return '1P'
    case 2:
      return '2P'
    case 3:
      return '3P'
    case 4:
      return '4P'
    default:
      return ''
  }
}

/** Pole options for RCD (subset): 2P, 4P. */
export const POLE_CONFIG_OPTIONS_RCD: PolesConfig[] = ['2P', '4P']

/** Pole options for RCBO: 1P–4P. */
export const POLE_CONFIG_OPTIONS_RCBO: PolesConfig[] = [...POLE_CONFIG_OPTIONS_SIMPLE]

/** Pole options for MCB: 1P–4P. */
export const POLE_CONFIG_OPTIONS_MCB: PolesConfig[] = [...POLE_CONFIG_OPTIONS_SIMPLE]

/** Poles config for supply devices (MCB, energy meter) from nominal voltage system. Uses simplified 2P, 3P, 4P. */
export function polesConfigFromVoltageSystem(
  system: '1~' | '2~' | '1N~' | '3~' | '3N~' | 'DC'
): PolesConfig {
  switch (system) {
    case '1~':
    case '2~':
    case '1N~':
    case 'DC':
      return '2P'
    case '3~':
      return '3P'
    case '3N~':
      return '4P'
    default:
      return '2P'
  }
}
