import type { CableSpec } from '@/types/schema'

export type WireConductorOption = {
  value: string
  label: string
  conductors: number
  hasPE: boolean
}

/** AC conductor dropdown values (2 / 3 / 4 without PE are distinct from 2G / 3G / 4G). */
export const AC_WIRE_CONDUCTOR_OPTIONS: WireConductorOption[] = [
  { value: '2', label: '2', conductors: 2, hasPE: false },
  { value: '2G', label: '2G', conductors: 2, hasPE: true },
  { value: '3', label: '3', conductors: 3, hasPE: false },
  { value: '3G', label: '3G', conductors: 3, hasPE: true },
  { value: '4', label: '4', conductors: 4, hasPE: false },
  { value: '4G', label: '4G', conductors: 4, hasPE: true },
  { value: '5G', label: '5G', conductors: 5, hasPE: true },
  { value: '6G', label: '6G', conductors: 6, hasPE: true },
  { value: '7G', label: '7G', conductors: 7, hasPE: true },
]

export const DC_WIRE_CONDUCTOR_OPTIONS: WireConductorOption[] = [
  { value: '2', label: '2', conductors: 2, hasPE: false },
  { value: '4', label: '4', conductors: 4, hasPE: false },
  { value: '6', label: '6', conductors: 6, hasPE: false },
  { value: '8', label: '8', conductors: 8, hasPE: false },
  { value: '10', label: '10', conductors: 10, hasPE: false },
  { value: '12', label: '12', conductors: 12, hasPE: false },
  { value: '14', label: '14', conductors: 14, hasPE: false },
  { value: '16', label: '16', conductors: 16, hasPE: false },
  { value: '2G', label: '2G', conductors: 2, hasPE: true },
  { value: '3G', label: '3G', conductors: 3, hasPE: true },
  { value: '4G', label: '4G', conductors: 4, hasPE: true },
  { value: '5G', label: '5G', conductors: 5, hasPE: true },
  { value: '6G', label: '6G', conductors: 6, hasPE: true },
  { value: '7G', label: '7G', conductors: 7, hasPE: true },
]

export function getWireConductorOptions(isDC: boolean): WireConductorOption[] {
  return isDC ? DC_WIRE_CONDUCTOR_OPTIONS : AC_WIRE_CONDUCTOR_OPTIONS
}

export function resolveConductorDropdownValue(
  cable: CableSpec,
  isDC: boolean,
): string {
  const conductorOptions = getWireConductorOptions(isDC)
  const conductors = isDC ? cable.conductors || 2 : cable.conductors
  const hasPE = cable.hasPE ?? false
  const display = hasPE ? `${conductors}G` : `${conductors}`
  return (
    conductorOptions.find((opt) => opt.value === display)?.value ??
    conductorOptions.find((opt) => opt.conductors === conductors && opt.hasPE === hasPE)?.value ??
    conductorOptions[0]!.value
  )
}
