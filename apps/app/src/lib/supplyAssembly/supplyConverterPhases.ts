import { normalizeNominalVoltageSystem } from '@/constants/nominalVoltage'
import { getFullInstallationPhaseAssignment, getInstallationPhases } from '@/lib/wires/phaseAssignment'
import type { AcPhase, CircuitPhaseAssignment, Installation, TrunkDevice } from '@/types/schema'
import { getSupplyInverterMultiplier } from '@/utils/inverterMultipliers'

export function getDefaultSupplyConverterAcPhaseAssignment(
  system: Installation['nominalVoltage']['system']
): CircuitPhaseAssignment {
  const explicit = getFullInstallationPhaseAssignment(system)
  if (explicit) return explicit

  const normalized = normalizeNominalVoltageSystem(system ?? '1N~')
  if (normalized === '2~') {
    return {
      kind: 'phase_to_phase',
      phases: ['L1', 'L2'],
      neutral: 'not_present',
      source: 'derived_from_voltage',
    }
  }
  if (normalized === '1~') {
    return {
      kind: 'single_phase',
      phases: ['L1'],
      neutral: 'not_present',
      source: 'derived_from_voltage',
    }
  }
  return {
    kind: 'single_phase',
    phases: ['L1', 'N'],
    neutral: 'used',
    source: 'derived_from_voltage',
  }
}

export function getSupplyConverterAcPhaseAssignment(
  device: Pick<TrunkDevice, 'symbol' | 'placements' | 'conversionProps'>,
  system: Installation['nominalVoltage']['system']
): CircuitPhaseAssignment {
  if (device.symbol === 'inverter') {
    const count = getSupplyInverterMultiplier(device)
    if (count >= 3) return getDefaultSupplyConverterAcPhaseAssignment(system)
    if (count === 2) {
      const phaseOrder: AcPhase[] = ['L1', 'L2', 'L3', 'N', 'PE']
      const phases = (Array.from(
        new Set(
          getSupplyInverterUnitPhaseAssignments(device, system, count).flatMap(
            (item) => item.phases
          )
        )
      ) as AcPhase[]).sort((left, right) => phaseOrder.indexOf(left) - phaseOrder.indexOf(right))
      const linePhaseCount = phases.filter((phase) => phase !== 'N' && phase !== 'PE').length
      return {
        kind: linePhaseCount >= 3 ? 'three_phase' : 'phase_to_phase',
        phases,
        neutral: phases.includes('N') ? 'used' : 'not_present',
        source: 'manual',
      }
    }
  }
  return device.conversionProps?.acPhaseAssignment ?? getDefaultSupplyConverterAcPhaseAssignment(system)
}

export function getDefaultSupplyInverterUnitPhaseAssignments(
  system: Installation['nominalVoltage']['system'],
  count: number
): CircuitPhaseAssignment[] {
  const phases = getInstallationPhases(system ?? '1N~')
  const hasNeutral = phases.includes('N')
  const linePhases = phases.filter(
    (phase): phase is Extract<AcPhase, 'L1' | 'L2' | 'L3'> =>
      phase === 'L1' || phase === 'L2' || phase === 'L3'
  )
  if (linePhases.length < 3) {
    return Array.from({ length: count }, () => getDefaultSupplyConverterAcPhaseAssignment(system))
  }
  return Array.from({ length: count }, (_, index) => {
    if (hasNeutral) {
      return {
        kind: 'single_phase',
        phases: [linePhases[index % linePhases.length]!, 'N'],
        neutral: 'used',
        source: 'derived_from_voltage',
      }
    }
    return {
      kind: 'phase_to_phase',
      phases: [
        linePhases[index % linePhases.length]!,
        linePhases[(index + 1) % linePhases.length]!,
      ],
      neutral: 'not_present',
      source: 'derived_from_voltage',
    }
  })
}

export function getSupplyInverterUnitPhaseAssignments(
  device: Pick<TrunkDevice, 'conversionProps'>,
  system: Installation['nominalVoltage']['system'],
  count: number
): CircuitPhaseAssignment[] {
  const defaults = getDefaultSupplyInverterUnitPhaseAssignments(system, count)
  const stored = device.conversionProps?.acPhaseAssignments ?? []
  const shared = device.conversionProps?.acPhaseAssignment
  const reducedShared =
    shared?.kind === 'single_phase' || shared?.kind === 'phase_to_phase' ? shared : undefined
  return defaults.map((fallback, index) =>
    index === 0
      ? stored[index] ?? reducedShared ?? fallback
      : stored[index] ?? fallback
  )
}

export function getSupplyConverterAcConductors(
  device: Pick<TrunkDevice, 'symbol' | 'placements' | 'conversionProps'>,
  system: Installation['nominalVoltage']['system']
) {
  const assignment = getSupplyConverterAcPhaseAssignment(device, system)
  const phases = assignment.phases.filter(
    (phase) => phase === 'L1' || phase === 'L2' || phase === 'L3' || phase === 'N'
  )
  return phases.length > 0 ? phases : getInstallationPhases(system ?? '1N~')
}
