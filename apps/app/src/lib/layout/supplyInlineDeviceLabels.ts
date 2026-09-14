import type { TrunkDevice } from '@/types/schema'
import { getProtectionOneWireLabelLines, type ProtectionOneWireLabelLine } from '@/lib/protectionLabels'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'

/** Relays share inline label geometry with protections, but never their ratings or topology. */
export function hasSupplyInlineLabels(device: TrunkDevice): boolean {
  return device.type === 'protection' || device.symbol === 'relay'
}

export function getSupplyInlineLabelLines(device: TrunkDevice): ProtectionOneWireLabelLine[] {
  if (device.symbol !== 'relay') return getProtectionOneWireLabelLines(device)
  const { poles, maxCurrentRatingA } = device.relayProps ?? {}
  const text = [
    poles != null && poles > 0 && isSymbolLabelVisible(device.symbolLabelDisplay, 'protectionPoles', true) ? `${poles}P` : '',
    maxCurrentRatingA != null && maxCurrentRatingA > 0 && isSymbolLabelVisible(device.symbolLabelDisplay, 'protectionCurrent', true) ? `${maxCurrentRatingA}A` : '',
  ].filter(Boolean).join(' ')
  return text ? [{ text, role: 'specs' }] : []
}
