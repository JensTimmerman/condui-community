import type { BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import {
  getAuxiliaryElectricalEnclosuresFromProject,
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { Panel } from '@/types/schema'
import {
  getAuxiliaryEnclosureSupplyDeviceIds,
  resolveSupplyDeviceMounting,
} from '@/lib/panel/auxiliarySupplyEnclosures'
import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import type { PanelSceneExportMode } from './sceneProviders/panelSceneProvider'

export interface PanelExportTarget {
  id: string
  mode: PanelSceneExportMode
  orientation: 'portrait' | 'landscape'
}

function collectAllPanels(panels: Panel[]): Panel[] {
  return panels.flatMap((panel) => [panel, ...collectAllPanels(panel.subPanels)])
}

export function countElectricalPanels(panels: Panel[]): number {
  return collectAllPanels(panels).length
}

function countMainPanels(panels: Panel[]): number {
  return panels.reduce(
    (count, panel) => count + (panel.isMain ? 1 : 0) + countMainPanels(panel.subPanels),
    0
  )
}

export function orderEendraadLayoutsForExport(
  layouts: BottomUpPanelLayout[]
): BottomUpPanelLayout[] {
  return [...layouts].sort(
    (left, right) => Number(right.frameRole === 'supply') - Number(left.frameRole === 'supply')
  )
}

export function buildPanelExportTargets(
  project: ProjectWithOptionalV2Electrical
): PanelExportTarget[] {
  const panelRoots = getElectricalPanelsFromProject(project)
  const panels = collectAllPanels(panelRoots)
  const auxiliaryEnclosures = getAuxiliaryElectricalEnclosuresFromProject(project).filter(
    (enclosure) => enclosure.hidden !== true
  )
  const nonEmptyAuxiliaryEnclosures = auxiliaryEnclosures.filter(
    (enclosure) => getAuxiliaryEnclosureSupplyDeviceIds(project, enclosure.id).length > 0
  )
  const hasSharedSupplySurfaceContent = getAllSupplyTrunkDevices(project).some(
    (device) => resolveSupplyDeviceMounting(project, device.id)?.kind === 'grid'
  )
  const hasMultipleMainPanels = countMainPanels(panelRoots) > 1
  const targets: PanelExportTarget[] = []

  const hierarchySurfaceCount =
    panels.length + auxiliaryEnclosures.length + (hasSharedSupplySurfaceContent ? 1 : 0)
  if (hierarchySurfaceCount > 3) {
    targets.push({ id: 'panel-overview', mode: { kind: 'overview' }, orientation: 'landscape' })
  }
  if (hasMultipleMainPanels) {
    targets.push({
      id: 'panel-shared-supply',
      mode: { kind: 'hierarchy-surface', surfaceId: 'shared-supply' },
      orientation: 'portrait',
    })
  }
  for (const panel of panels) {
    targets.push({
      id: `panel-${panel.id}`,
      mode: hasMultipleMainPanels
        ? { kind: 'hierarchy-surface', surfaceId: panel.id }
        : { kind: 'panel', panelId: panel.id },
      orientation: 'portrait',
    })
  }
  for (const enclosure of nonEmptyAuxiliaryEnclosures) {
    targets.push({
      id: `panel-${enclosure.id}`,
      mode: { kind: 'hierarchy-surface', surfaceId: enclosure.id },
      orientation: 'portrait',
    })
  }

  return targets
}
