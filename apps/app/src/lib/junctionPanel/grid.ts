import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { walkPanels } from '@/lib/panel/panelTree'
import { collectAllGroundTrunkDevices } from '@/lib/eendraad/panelGround'
import type {
  JunctionPanelTerminalComponent,
  PanelGridConfig,
  TrunkDevice,
} from '@/types/schema'
import { findTrunkDeviceInProject } from '@/utils/project'

export const DEFAULT_JUNCTION_PANEL_GRID: PanelGridConfig = {
  rows: 1,
  columns: 18,
  feedFromTop: true,
  slots: [],
}

export function getJunctionPanelGridView(device: TrunkDevice): PanelGridConfig {
  return {
    ...DEFAULT_JUNCTION_PANEL_GRID,
    ...(device.junctionPanelGridView ?? {}),
    slots: device.junctionPanelGridView?.slots ?? [],
  }
}

export function getJunctionPanelTerminal(
  device: TrunkDevice,
  fallbackIndex = 0
): JunctionPanelTerminalComponent {
  return (
    device.junctionPanelTerminal ?? {
      id: `junction-terminal:${device.id}`,
      label: `X${fallbackIndex + 1}`,
      pinCount: 2,
    }
  )
}

export function updateJunctionPanelTerminal(
  project: ProjectWithOptionalV2Electrical,
  ownerDeviceId: string,
  updates: Partial<JunctionPanelTerminalComponent>
): boolean {
  const owner = findTrunkDeviceInProject(project, ownerDeviceId)
  if (!owner || (owner.type !== 'junction_panel' && owner.symbol !== 'junction_panel')) return false
  const current = getJunctionPanelTerminal(owner)
  owner.junctionPanelTerminal = {
    ...current,
    ...updates,
    pinCount: Math.max(2, Math.round(updates.pinCount ?? current.pinCount)),
  }
  return true
}

export function updateSharedJunctionPanelGrid(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string,
  updates: Partial<PanelGridConfig>
): boolean {
  const target = findTrunkDeviceInProject(project, deviceId)
  if (!target || (target.type !== 'junction_panel' && target.symbol !== 'junction_panel')) {
    return false
  }
  const identity = (target.junctionIdentity ?? target.label ?? '').trim().toUpperCase()
  const devices: TrunkDevice[] = [
    ...getAllSupplyTrunkDevices(project),
    ...collectAllGroundTrunkDevices(
      getProjectElectricalPanels(project),
      getProjectElectricalInstallation(project)
    ),
  ]
  for (const panel of walkPanels(getProjectElectricalPanels(project))) {
    const circuits = [
      ...(panel.circuits ?? []),
      ...(panel.protections ?? []).flatMap((protection) => protection.circuits ?? []),
    ]
    for (const circuit of circuits) devices.push(...(circuit.trunkDevices ?? []))
  }
  let changed = false
  for (const device of devices) {
    if (device.type !== 'junction_panel' && device.symbol !== 'junction_panel') continue
    const candidateIdentity = (device.junctionIdentity ?? device.label ?? '').trim().toUpperCase()
    if (device.id !== deviceId && (!identity || candidateIdentity !== identity)) continue
    device.junctionPanelGridView = {
      ...getJunctionPanelGridView(device),
      ...updates,
      slots: updates.slots ?? device.junctionPanelGridView?.slots ?? [],
    }
    changed = true
  }
  return changed
}
