import type { TrunkDevice } from '@/types/schema'

export const TERMINAL_STRIP_PROTECTION_CENTER_GAP = 56
export const TERMINAL_STRIP_FIRST_BRANCH_EXTRA_GAP = 16
export const TERMINAL_STRIP_WIRE_LABEL_SPAN = 56

/** Leaves room for wire metadata between a terminal strip and its protection. */
export function getProtectionToTrunkDeviceCenterGap(
  device: Pick<TrunkDevice, 'symbol'>,
  defaultGap: number
): number {
  return device.symbol === 'terminal_strip' ? TERMINAL_STRIP_PROTECTION_CENTER_GAP : defaultGap
}

/** Extra upstream wire reserved for the repeated cable/routing label after a terminal strip. */
export function getTrunkDeviceToFirstBranchExtraGap(
  device: Pick<TrunkDevice, 'symbol'> | undefined
): number {
  return device?.symbol === 'terminal_strip' ? TERMINAL_STRIP_FIRST_BRANCH_EXTRA_GAP : 0
}
