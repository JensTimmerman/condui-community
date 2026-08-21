import type { CableSpec, Circuit, ElectricalDomain } from '@/types/schema'

/** Default fire class for new AC installation wires on the main board (not supply, not DC). */
export const DEFAULT_AC_FIRE_CLASS: NonNullable<CableSpec['fireClass']> = 'Cca'

export type DefaultAcCircuitCableOptions = {
  sectionMm2?: number
  kind?: CableSpec['kind']
  conductors?: number
  hasPE?: boolean
}

/** Default cable for a new AC circuit (includes fire class). */
export function createDefaultAcCircuitCable(
  options: DefaultAcCircuitCableOptions = {},
): CableSpec {
  return {
    kind: options.kind ?? 'XVB',
    conductors: options.conductors ?? 3,
    sectionMm2: options.sectionMm2 ?? 2.5,
    hasPE: options.hasPE ?? true,
    fireClass: DEFAULT_AC_FIRE_CLASS,
  }
}

/**
 * Internal panel-bus links are distribution conductors, not final circuit wiring.
 * Keep their rendered cable at least 6 mm² while preserving the selected cable
 * type, conductor count, PE flag, and any larger section already present.
 */
export function ensurePanelBusCableMinimum(cable?: CableSpec): CableSpec {
  const base = cable ?? createDefaultAcCircuitCable({ sectionMm2: 6 })
  return {
    ...base,
    sectionMm2: Math.max(base.sectionMm2 ?? 0, 6),
  }
}

/** Default one-wire label flags for a new AC circuit. */
export const DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS: Pick<Circuit, 'showFireClassLabel'> = {
  showFireClassLabel: true,
}

export function resolveShowFireClassLabel(
  value: boolean | undefined,
  domain: ElectricalDomain,
): boolean {
  if (domain === 'DC') return value === true
  return value !== false
}

/** Wire length labels are opt-in on all domains. */
export function resolveShowWireLengthLabel(value: boolean | undefined): boolean {
  return value === true
}
