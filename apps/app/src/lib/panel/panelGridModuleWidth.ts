import { findTrunkDeviceInProject } from '@/lib/eendraad/findTrunkDeviceInProject'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { Panel, PanelGridModuleRef, ProtectionDevice } from '@/types/schema'

function polesFromPolesConfig(config: string | undefined): number {
  if (!config) return 1
  if (config === '4P' || config === '3P+N') return 4
  if (config === '3P') return 3
  if (config === '2P' || config === '1P+N') return 2
  return 1
}

function findProtectionRecursive(panels: Panel[], id: string): ProtectionDevice | null {
  for (const panel of panels) {
    const protection = panel.protections.find((candidate) => candidate.id === id)
    if (protection) return protection
    const nested = findProtectionRecursive(panel.subPanels ?? [], id)
    if (nested) return nested
  }
  return null
}

/** Return a panel module's natural physical width without importing canvas code. */
export function getModuleWidthInCols(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical | null
): number {
  if (!project) return 1
  if (ref.kind === 'protection') {
    const protection = findProtectionRecursive(getProjectElectricalPanels(project), ref.id)
    if (protection) {
      return Math.max(1, protection.poles ?? polesFromPolesConfig(protection.polesConfig))
    }
  }
  if (ref.kind === 'trunkDevice') {
    const device = findTrunkDeviceInProject(project, ref.id)
    if (device) {
      if (device.symbol === 'terminal_strip' || device.type === 'terminal_strip') return 1 / 3
      if (device.poles != null) return Math.max(1, device.poles)
      if (device.polesConfig) return Math.max(1, polesFromPolesConfig(device.polesConfig))
      if (device.energyMeterProps?.poles != null) return Math.max(1, device.energyMeterProps.poles)
      if (device.energyMeterProps?.polesConfig) {
        return Math.max(1, polesFromPolesConfig(device.energyMeterProps.polesConfig))
      }
    }
  }
  if (ref.kind === 'domotica') return 2
  return 1
}
