/**
 * Format project nominal voltage as a short summary label for the supply symbol.
 * Examples: 2×230V, 3×230V, 3N400V, 1N400V
 */

import { normalizeNominalVoltageSystem } from '@/constants/nominalVoltage'
import type { Installation } from '@/types/schema'

export function getVoltageSummaryLabel(nominalVoltage: Installation['nominalVoltage']): string {
  const system = normalizeNominalVoltageSystem(nominalVoltage.system)
  switch (system) {
    case '1~':
      return '1×230V'
    case '2~':
      return '2×230V'
    case '1N~':
      return '1N400V'
    case '3~':
      return '3×230V'
    case '3N~':
      return '3N400V'
    case 'DC':
      return 'DC'
    default:
      return `${nominalVoltage.uLineToLine}V`
  }
}
