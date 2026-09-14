import type { Panel, PanelGridModuleRef, ProtectionDevice } from '@/types/schema'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

export interface ConverterBackupPanelFeed {
  panelId: string
  sourcePanelId: string
  converterId: string
  protectionId: string
  converterRef: PanelGridModuleRef
  protectionRef: PanelGridModuleRef
}

function visitPanels(
  panels: Panel[],
  visit: (panel: Panel, protection: ProtectionDevice) => ConverterBackupPanelFeed | null
): ConverterBackupPanelFeed | null {
  for (const panel of panels) {
    for (const protection of panel.protections) {
      const result = visit(panel, protection)
      if (result) return result
    }
    const nested = visitPanels(panel.subPanels ?? [], visit)
    if (nested) return nested
  }
  return null
}

/**
 * A standalone converter backup board is a root/sibling panel whose incoming
 * protection is still electrically owned by the converter circuit's source panel.
 * Panel-grid placement may live on the fed board without changing that ownership.
 */
export function findConverterBackupPanelFeed(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): ConverterBackupPanelFeed | null {
  return visitPanels(getProjectElectricalPanels(project), (sourcePanel, protection) => {
    if (protection.subPanelId !== panelId) return null
    const circuit = (protection.circuits ?? []).find(
      (candidate) => candidate.supplySource?.kind === 'converter-backup'
    )
    const converterId = circuit?.supplySource?.converterId
    if (!converterId) return null
    return {
      panelId,
      sourcePanelId: sourcePanel.id,
      converterId,
      protectionId: protection.id,
      converterRef: { kind: 'trunkDevice', id: converterId, scope: 'supply' },
      protectionRef: { kind: 'protection', id: protection.id },
    }
  })
}

export function findConverterBackupProtectionRefs(
  project: ProjectWithOptionalV2Electrical,
  converterId: string
): PanelGridModuleRef[] {
  const refs: PanelGridModuleRef[] = []
  const walk = (panels: Panel[]): void => {
    for (const panel of panels) {
      for (const protection of panel.protections) {
        if (
          (protection.circuits ?? []).some(
            (circuit) =>
              circuit.supplySource?.kind === 'converter-backup' &&
              circuit.supplySource.converterId === converterId
          )
        ) {
          refs.push({ kind: 'protection', id: protection.id })
        }
      }
      walk(panel.subPanels ?? [])
    }
  }
  walk(getProjectElectricalPanels(project))
  return refs
}

export function findConverterBackupPanelFeedsFromSource(
  project: ProjectWithOptionalV2Electrical,
  sourcePanelId: string,
): ConverterBackupPanelFeed[] {
  const feeds: ConverterBackupPanelFeed[] = []
  const collectTargets = (panels: Panel[]): void => {
    for (const panel of panels) {
      const feed = findConverterBackupPanelFeed(project, panel.id)
      if (feed?.sourcePanelId === sourcePanelId) feeds.push(feed)
      collectTargets(panel.subPanels ?? [])
    }
  }
  collectTargets(getProjectElectricalPanels(project))
  return feeds
}
