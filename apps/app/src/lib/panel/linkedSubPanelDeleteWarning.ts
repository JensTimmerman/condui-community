import type { Panel, ProtectionDevice } from '@/types/schema'
import { findParentCircuitInfo } from '@/lib/eendraad/findParentCircuitInfo'
import { getPanelDisplayName } from '@/utils/panelNames'
import {
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

type LinkedSubPanelProject = ProjectWithOptionalV2Electrical & {
  project?: {
    locale?: string
  }
}

function collectAllProtections(panels: Panel[], out: ProtectionDevice[]): void {
  for (const p of panels) {
    out.push(...(p.protections ?? []))
    for (const sp of p.subPanels ?? []) collectAllProtections([sp], out)
  }
}

/**
 * Sub-panel ids that would have no `protection.subPanelId` feeder after removing the
 * given protections, matching {@link migrateSubCircuitContentToParent} transferring
 * `subPanelId` to a surviving parent protection when applicable.
 *
 * These boards are the ones the store cascade-deletes to avoid `panelMissingOneWireSymbol` orphans.
 */
export function getSubPanelIdsOrphanedAfterRemovingFeederProtections(
  project: ProjectWithOptionalV2Electrical,
  protectionIdsToRemove: ReadonlySet<string>,
): string[] {
  const all: ProtectionDevice[] = []
  const panels = getElectricalPanelsFromProject(project)
  collectAllProtections(panels, all)

  const fedAfter = new Set<string>()
  for (const pr of all) {
    if (!protectionIdsToRemove.has(pr.id) && pr.subPanelId) {
      fedAfter.add(pr.subPanelId)
    }
  }

  for (const pr of all) {
    if (!protectionIdsToRemove.has(pr.id)) continue
    const sid = pr.subPanelId
    if (!sid || !pr.circuits?.length) continue
    for (const c of pr.circuits) {
      const parentInfo = findParentCircuitInfo(c.id, panels)
      const q = parentInfo?.parentProtection
      if (q && !protectionIdsToRemove.has(q.id)) {
        fedAfter.add(sid)
        break
      }
    }
  }

  const candidates = new Set<string>()
  for (const pr of all) {
    if (protectionIdsToRemove.has(pr.id) && pr.subPanelId) {
      candidates.add(pr.subPanelId)
    }
  }

  return [...candidates].filter((sid) => !fedAfter.has(sid))
}

/**
 * Display names of distribution boards that would be cascade-deleted when removing
 * the given feeder protection ids (non-main panels with no remaining feeder).
 */
export function linkedSubPanelDisplayNamesForProtectionIds(
  project: LinkedSubPanelProject | null | undefined,
  getPanelById: (id: string) => Panel | undefined,
  protectionIds: readonly string[],
): string[] {
  if (!project || protectionIds.length === 0) return []
  const doomed = getSubPanelIdsOrphanedAfterRemovingFeederProtections(project, new Set(protectionIds))
  const names: string[] = []
  const seen = new Set<string>()
  for (const sid of doomed) {
    if (seen.has(sid)) continue
    seen.add(sid)
    const panel = getPanelById(sid)
    names.push(panel ? getPanelDisplayName(panel, project) : sid)
  }
  return names
}
