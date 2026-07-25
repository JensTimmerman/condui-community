import type { Circuit, Panel, TrunkDevice } from '@/types/schema'

function orderCircuitTrunkDevices(circuit: Circuit | null | undefined): TrunkDevice[] {
  const devices = circuit?.trunkDevices ?? []
  if (devices.length <= 1) return [...devices]
  return [...devices].sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
}

export interface SubPanelFeedDevice {
  circuit: Circuit
  device: TrunkDevice
  orderedDevices: TrunkDevice[]
}

/**
 * Incoming PANEL-circuit device that feeds the DIN rail main bus (any panel that
 * has a local `code === 'PANEL'` circuit with trunk devices).
 *
 * Used for sub-panels and for extra main boards fed from another panel instead of
 * (or before) the installation supply chain.
 */
export function getPanelIncomingMainBusFeedDevice(panel: Panel): SubPanelFeedDevice | null {
  const circuit = panel.circuits.find((candidate) => candidate.code === 'PANEL')
  if (!circuit) return null
  const orderedDevices = orderCircuitTrunkDevices(circuit)
  if (orderedDevices.length === 0) return null
  const device =
    orderedDevices.find((candidate) => candidate.type === 'protection') ?? orderedDevices[0]!
  return { circuit, device, orderedDevices }
}

/**
 * Resolve the local device on a secondary panel's incoming PANEL wire that should
 * be treated as the feeder into the panel main bus.
 *
 * The one-line view only exposes a single local feeder on the incoming wire.
 * Prefer the first protection device in trunk order; otherwise fall back to the
 * first local PANEL trunk device.
 */
export function getSubPanelMainBusFeedDevice(panel: Panel): SubPanelFeedDevice | null {
  if (panel.isMain) return null
  return getPanelIncomingMainBusFeedDevice(panel)
}
