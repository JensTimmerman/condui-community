import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { getMainBusOrder } from '@/lib/eendraad/mainBusOrder'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  getMutableSupplyAssembliesForProject,
  getSupplyAssembliesFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import type { Panel, PanelBusSection, TrunkDevice } from '@/types/schema'
import type { OffGridSupplyAssembly } from '@/types/supplyAssembly'
import { deriveHandoffPhaseSupplyPaths } from '@/lib/supplyAssembly/phasePaths'
import { getInstallationPhases } from '@/lib/wires/phaseAssignment'
import {
  canEnableDirectInverterPanelBackup,
  disableDirectInverterPanelBackup,
  enableDirectInverterPanelBackup,
} from '@/lib/supplyAssembly/directInverterPanelBackup'
import { buildDirectConverterSupplyAssembly } from '@/lib/supplyAssembly/editorIntegration'
import { getDefaultSupplyConverterAcPhaseAssignment } from '@/lib/supplyAssembly/supplyConverterPhases'
import { generateId } from '@/utils'
import {
  getCircuitBusSectionId,
  getPrimaryPanelBusSectionId,
  getProtectionBusSectionId,
  hasExplicitPanelBusSections,
} from './panelBusSections'

export type PanelFeedOrganization = 'single' | 'split-switchable' | 'split-backup'
export type PanelBusFeedKind = 'grid' | 'backup'

export function gridBusSectionId(panelId: string): string {
  return `bus-grid-${panelId}`
}

export function backupBusSectionId(panelId: string): string {
  return `bus-backup-${panelId}`
}

function assemblyTargetsPanel(assembly: OffGridSupplyAssembly, panelId: string): boolean {
  if (
    (assembly.incomingAttachment.kind === 'panel-input' ||
      assembly.incomingAttachment.kind === 'panel-bus-input') &&
    assembly.incomingAttachment.panelId === panelId
  ) {
    return true
  }
  return assembly.loadHandoffs.some(
    (handoff) =>
      (handoff.target.kind === 'panel-input' ||
        handoff.target.kind === 'panel-bus-input' ||
        handoff.target.kind === 'circuit-input') &&
      handoff.target.panelId === panelId
  )
}

export function findPanelSupplyAssembly(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): OffGridSupplyAssembly | undefined {
  return getSupplyAssembliesFromProject(project).find((assembly) =>
    assemblyTargetsPanel(assembly, panelId)
  )
}

export function panelHasModularChangeover(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): boolean {
  return Boolean(
    findPanelSupplyAssembly(project, panelId)?.nodes.some(
      (node) => node.kind === 'changeover-switch'
    )
  )
}

export function panelHasBackupOutput(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): boolean {
  const installation = getElectricalInstallationFromProject(project)
  const assembly = findPanelSupplyAssembly(project, panelId)
  if (!installation || !assembly) return false
  const panelHandoffIds = new Set(
    assembly.loadHandoffs
      .filter(
        (handoff) =>
          (handoff.target.kind === 'panel-input' ||
            handoff.target.kind === 'panel-bus-input') &&
          handoff.target.panelId === panelId
      )
      .map((handoff) => handoff.id)
  )
  if (panelHandoffIds.size === 0) return false
  const presentLinePhases = getInstallationPhases(installation.nominalVoltage.system).filter(
    (phase): phase is 'L1' | 'L2' | 'L3' =>
      phase === 'L1' || phase === 'L2' || phase === 'L3'
  )
  return deriveHandoffPhaseSupplyPaths(assembly, presentLinePhases).some(
    (path) => panelHandoffIds.has(path.handoffId) && path.backupConnectionIds.length > 0
  )
}

/** True when split mode already works or a direct inverter can gain a panel backup handoff. */
export function panelCanConfigureBackupOutput(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): boolean {
  return (
    panelHasBackupOutput(project, panelId) ||
    canEnableDirectInverterPanelBackup(findPanelSupplyAssembly(project, panelId))
  )
}

/** Create the smallest editable topology that can feed a dedicated backup bus. */
function ensureMinimalDirectInverterAssembly(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): OffGridSupplyAssembly | undefined {
  const existing = findPanelSupplyAssembly(project, panelId)
  if (existing) return existing
  const installation = getElectricalInstallationFromProject(project)
  const panels = getElectricalPanelsFromProject(project)
  const panel = findPanelById(panels, panelId)
  if (!installation || !panel || panel.isMain === false) return undefined

  const topology = ensureInstallationFeedTopology(installation, panels)
  const rootFeed = topology.rootFeeds.find((feed) => feed.panelId === panelId)
  if (!rootFeed) return undefined
  const devices = rootFeed.trunkDevices ?? (rootFeed.trunkDevices = [])
  let inverter = devices.find(
    (device) => device.symbol === 'inverter' && device.supplyPath === 'converter-branch'
  )
  if (!inverter) {
    inverter = {
      id: generateId(),
      type: 'conversion',
      symbol: 'inverter',
      label: '',
      trunkPosition: 0,
      supplyPath: 'converter-branch',
      conversionProps: {
        acPhaseAssignment: getDefaultSupplyConverterAcPhaseAssignment(
          installation.nominalVoltage.system
        ),
      },
    } satisfies TrunkDevice
    devices.unshift(inverter)
    devices.forEach((device, index) => {
      device.trunkPosition = index
    })
  }

  const assembly = buildDirectConverterSupplyAssembly(project, panelId, inverter)
  getMutableSupplyAssembliesForProject(project).push(assembly)
  return assembly
}

/** Collapse impossible split-bus state after destructive supply-assembly edits. */
export function reconcileInvalidPanelFeedOrganizationsInProject(
  project: ProjectWithOptionalV2Electrical
): boolean {
  let changed = false
  const installation = getElectricalInstallationFromProject(project)
  const presentLinePhases = installation
    ? getInstallationPhases(installation.nominalVoltage.system).filter(
        (phase): phase is 'L1' | 'L2' | 'L3' =>
          phase === 'L1' || phase === 'L2' || phase === 'L3'
      )
    : []
  for (const panel of getElectricalPanelsFromProject(project)) {
    let repairedPanelHandoff = false
    if (panel.isMain !== false && hasExplicitPanelBusSections(panel)) {
      const backupSection = panel.busSections?.find((section) => section.role === 'backup')
      if (backupSection && presentLinePhases.length > 0) {
        for (const assembly of getMutableSupplyAssembliesForProject(project)) {
          const backedUpHandoffIds = new Set(
            deriveHandoffPhaseSupplyPaths(assembly, presentLinePhases)
              .filter((path) => path.backupConnectionIds.length > 0)
              .map((path) => path.handoffId)
          )
          assembly.loadHandoffs = assembly.loadHandoffs.map((handoff) => {
            if (
              !backedUpHandoffIds.has(handoff.id) ||
              handoff.target.kind !== 'panel-input' ||
              handoff.target.panelId !== panel.id
            ) {
              return handoff
            }
            repairedPanelHandoff = true
            return {
              ...handoff,
              target: {
                kind: 'panel-bus-input' as const,
                panelId: panel.id,
                busSectionId: backupSection.id,
              },
            }
          })
        }
      }
    }
    changed = repairedPanelHandoff || changed
    if (
      panel.isMain !== false &&
      hasExplicitPanelBusSections(panel) &&
      !panelHasBackupOutput(project, panel.id)
    ) {
      changed = setPanelFeedOrganizationInProject(project, panel.id, 'single') || changed
    }
    if (repairedPanelHandoff && panel.isMain !== false && hasExplicitPanelBusSections(panel)) {
      syncPanelBackupBusPhaseOrderInProject(project, panel.id)
    }
  }
  return changed
}

export function getPanelFeedOrganization(
  project: ProjectWithOptionalV2Electrical,
  panel: Panel
): PanelFeedOrganization {
  if (!hasExplicitPanelBusSections(panel) || panel.busSections!.length < 2) return 'single'
  return panelHasModularChangeover(project, panel.id) ? 'split-switchable' : 'split-backup'
}

function ensureFeedSections(panel: Panel): {
  grid: PanelBusSection
  backup: PanelBusSection
} {
  const gridId = gridBusSectionId(panel.id)
  const backupId = backupBusSectionId(panel.id)
  const existing = panel.busSections ?? []
  const grid = existing.find((section) => section.id === gridId) ?? {
    id: gridId,
    label: 'Grid',
    role: 'normal' as const,
  }
  const backup = existing.find((section) => section.id === backupId) ?? {
    id: backupId,
    label: 'Backup',
    role: 'backup' as const,
  }
  panel.busSections = [grid, backup]
  panel.primaryBusSectionId = gridId
  return { grid, backup }
}

function assignAllTopLevelItems(panel: Panel, busSectionId: string): void {
  for (const protection of panel.protections) protection.busSectionId = busSectionId
  for (const circuit of panel.circuits) {
    if (circuit.code !== 'PANEL') circuit.busSectionId = busSectionId
  }
}

function retargetPanelAssemblyHandoffs(
  assemblies: OffGridSupplyAssembly[],
  panelId: string,
  busSectionId: string | undefined
): void {
  for (const assembly of assemblies) {
    if (!assemblyTargetsPanel(assembly, panelId)) continue
    assembly.loadHandoffs = assembly.loadHandoffs.map((handoff) => {
      if (
        (handoff.target.kind !== 'panel-input' &&
          handoff.target.kind !== 'panel-bus-input' &&
          handoff.target.kind !== 'circuit-input') ||
        handoff.target.panelId !== panelId
      ) {
        return handoff
      }
      return {
        ...handoff,
        target: busSectionId
          ? { kind: 'panel-bus-input' as const, panelId, busSectionId }
          : { kind: 'panel-input' as const, panelId },
      }
    })
  }
}

/** Keep the busbar rotation hint aligned with the actual inverter-backed handoff. */
export function syncPanelBackupBusPhaseOrderInProject(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): boolean {
  const installation = getElectricalInstallationFromProject(project)
  const panel = findPanelById(getElectricalPanelsFromProject(project), panelId)
  const backupSection = panel?.busSections?.find((section) => section.role === 'backup')
  const assembly = panel ? findPanelSupplyAssembly(project, panelId) : undefined
  const handoff = assembly?.loadHandoffs.find(
    (candidate) =>
      candidate.target.kind === 'panel-bus-input' &&
      candidate.target.panelId === panelId &&
      candidate.target.busSectionId === backupSection?.id
  )
  if (!installation || !panel || !backupSection || !assembly || !handoff) return false
  const presentLinePhases = getInstallationPhases(installation.nominalVoltage.system).filter(
    (phase): phase is 'L1' | 'L2' | 'L3' =>
      phase === 'L1' || phase === 'L2' || phase === 'L3'
  )
  const nextOrder = deriveHandoffPhaseSupplyPaths(assembly, presentLinePhases)
    .filter(
      (path) => path.handoffId === handoff.id && path.backupConnectionIds.length > 0
    )
    .map((path) => path.phase)
  if (nextOrder.length === 0) return false
  if (
    backupSection.phaseOrder?.length === nextOrder.length &&
    backupSection.phaseOrder.every((phase, index) => phase === nextOrder[index])
  ) {
    return false
  }
  backupSection.phaseOrder = nextOrder
  return true
}

/** Mutates one project draft; callers provide history/dirty-state handling. */
export function setPanelFeedOrganizationInProject(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  organization: PanelFeedOrganization
): boolean {
  const panels = getElectricalPanelsFromProject(project)
  const panel = findPanelById(panels, panelId)
  const installation = getElectricalInstallationFromProject(project)
  if (!panel || !installation || panel.isMain === false) return false
  const assemblies = getMutableSupplyAssembliesForProject(project)

  if (organization === 'single') {
    const primaryId = getPrimaryPanelBusSectionId(panel)
    for (const protection of panel.protections) delete protection.busSectionId
    for (const circuit of panel.circuits) delete circuit.busSectionId
    delete panel.busSections
    delete panel.primaryBusSectionId
    const topology = ensureInstallationFeedTopology(installation, panels)
    const panelFeeds = topology.rootFeeds.filter((feed) => feed.panelId === panelId)
    const keep = panelFeeds.find((feed) => feed.busSectionId === primaryId) ?? panelFeeds[0]
    if (keep) delete keep.busSectionId
    topology.rootFeeds = topology.rootFeeds.filter(
      (feed) => feed.panelId !== panelId || feed === keep
    )
    retargetPanelAssemblyHandoffs(assemblies, panelId, undefined)
    disableDirectInverterPanelBackup(assemblies, panelId)
    return true
  }

  const expected = panelHasModularChangeover(project, panelId) ? 'split-switchable' : 'split-backup'
  let directAssembly = findPanelSupplyAssembly(project, panelId)
  if (organization === 'split-backup' && !directAssembly) {
    directAssembly = ensureMinimalDirectInverterAssembly(project, panelId)
  }
  if (
    organization !== expected ||
    (!panelHasBackupOutput(project, panelId) &&
      (!directAssembly || !enableDirectInverterPanelBackup(directAssembly, panelId)))
  ) {
    return false
  }

  const { grid, backup } = ensureFeedSections(panel)
  const panelAssembly = findPanelSupplyAssembly(project, panelId)
  const backupHandoff = panelAssembly?.loadHandoffs.find(
    (handoff) =>
      (handoff.target.kind === 'panel-input' || handoff.target.kind === 'panel-bus-input') &&
      handoff.target.panelId === panelId
  )
  const backupLinePhases = backupHandoff?.conductors.filter(
    (conductor): conductor is 'L1' | 'L2' | 'L3' =>
      conductor === 'L1' || conductor === 'L2' || conductor === 'L3'
  )
  if (backupLinePhases?.length) backup.phaseOrder = [...new Set(backupLinePhases)]
  assignAllTopLevelItems(panel, backup.id)
  const topology = ensureInstallationFeedTopology(installation, panels)
  const panelFeeds = topology.rootFeeds.filter((feed) => feed.panelId === panelId)
  const gridFeed = panelFeeds[0]
  if (gridFeed) gridFeed.busSectionId = grid.id
  retargetPanelAssemblyHandoffs(assemblies, panelId, backup.id)
  syncPanelBackupBusPhaseOrderInProject(project, panelId)
  return true
}

export function getPanelBusFeedKind(panel: Panel, busSectionId: string): PanelBusFeedKind {
  const section = panel.busSections?.find((candidate) => candidate.id === busSectionId)
  return section?.role === 'backup' ? 'backup' : 'grid'
}

/** Assign the dropped bus feed from the insertion boundary through the next boundary/end. */
export function applyPanelBusFeedBoundary(
  panel: Panel,
  kind: PanelBusFeedKind,
  mainBusInsertIndex: number
): boolean {
  if (!hasExplicitPanelBusSections(panel)) return false
  const sectionId = kind === 'backup' ? backupBusSectionId(panel.id) : gridBusSectionId(panel.id)
  if (!panel.busSections!.some((section) => section.id === sectionId)) return false
  const order = getMainBusOrder(panel)
  const start = Math.max(0, Math.min(order.length, mainBusInsertIndex))
  if (start >= order.length) return false
  let changed = false
  for (const item of order.slice(start)) {
    if (item.type === 'protection') {
      const protection = panel.protections.find((candidate) => candidate.id === item.id)
      if (protection && getProtectionBusSectionId(panel, protection) !== sectionId) {
        protection.busSectionId = sectionId
        changed = true
      }
    } else {
      const circuit = panel.circuits.find((candidate) => candidate.id === item.id)
      if (circuit && getCircuitBusSectionId(panel, circuit) !== sectionId) {
        circuit.busSectionId = sectionId
        changed = true
      }
    }
  }
  return changed
}

/** Enable the topology-compatible split mode on first use, then assign the boundary. */
export function applyPanelBusFeedBoundaryInProject(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  kind: PanelBusFeedKind,
  mainBusInsertIndex: number,
): boolean {
  const panel = findPanelById(getElectricalPanelsFromProject(project), panelId)
  if (!panel) return false
  let changed = false
  if (!hasExplicitPanelBusSections(panel)) {
    // An unsplit panel is already entirely grid-fed. A grid marker is therefore a no-op;
    // the first backup marker is the action that creates and splits a minimal backup setup.
    if (kind === 'grid') return false
    changed = setPanelFeedOrganizationInProject(
      project,
      panelId,
      panelHasModularChangeover(project, panelId) ? 'split-switchable' : 'split-backup',
    )
    if (!changed) return false
    assignAllTopLevelItems(
      panel,
      droppedKindToOppositeSectionId(panel.id, kind),
    )
  }
  return applyPanelBusFeedBoundary(panel, kind, mainBusInsertIndex) || changed
}

function droppedKindToOppositeSectionId(panelId: string, kind: PanelBusFeedKind): string {
  return kind === 'backup' ? gridBusSectionId(panelId) : backupBusSectionId(panelId)
}
