import { panelGridModuleRefKey } from '@/lib/eendraad/projectElectricalDomain'
import { resolveSupplyDeviceMounting } from '@/lib/panel/auxiliarySupplyEnclosures'
import { getSupplyDeviceVisibilitySurface } from '@/lib/panel/supplyPanelVisibility'
import { walkPanels } from '@/lib/panel/panelTree'
import {
  getProjectElectricalPanels,
  selectProjectAuxiliaryElectricalEnclosures,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { PanelGridModuleRef } from '@/types/schema'

export interface PanelHiddenDialogTarget {
  panelId: string
  panelName: string
}

export function getGlobalPanelHiddenDialogTargets(project: ProjectWithOptionalV2Electrical): PanelHiddenDialogTarget[] {
  return [
    ...[...walkPanels(getProjectElectricalPanels(project))].map((panel) => ({ panelId: panel.id, panelName: panel.name })),
    ...selectProjectAuxiliaryElectricalEnclosures(project).map((enclosure) => ({ panelId: enclosure.id, panelName: enclosure.name })),
  ]
}

/** One hidden device per entry, restoring supply devices to their physical surface. */
export function collectPanelHiddenModuleEntries(
  project: ProjectWithOptionalV2Electrical,
  targets: PanelHiddenDialogTarget[],
  getHiddenRefs: (panelId: string) => PanelGridModuleRef[],
): Array<PanelHiddenDialogTarget & { ref: PanelGridModuleRef; isGridPanel: boolean }> {
  const allTargets = new Map(getGlobalPanelHiddenDialogTargets(project).map((target) => [target.panelId, target]))
  const seen = new Set<string>()
  const entries: Array<PanelHiddenDialogTarget & { ref: PanelGridModuleRef; isGridPanel: boolean }> = []
  for (const target of targets) {
    for (const ref of getHiddenRefs(target.panelId)) {
      const key = panelGridModuleRefKey(ref)
      if (seen.has(key)) continue
      seen.add(key)
      const supply = ref.kind === 'trunkDevice' && ref.scope === 'supply'
      const surface = supply ? getSupplyDeviceVisibilitySurface(project, ref.id) : undefined
      const destination = surface ? allTargets.get(surface.id) ?? target : target
      entries.push({ ...destination, ref, isGridPanel: supply && resolveSupplyDeviceMounting(project, ref.id)?.kind === 'grid' })
    }
  }
  return entries
}
