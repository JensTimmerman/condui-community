import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  editProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { getInstallationPhases } from '@/lib/wires/phaseAssignment'
import type { AcPhase, Panel } from '@/types/schema'
import type {
  OffGridSupplyAssembly,
  SupplyConnection,
  SupplyNode,
  SupplyPort,
} from '@/types/supplyAssembly'
import { enableDirectInverterPanelBackup } from './directInverterPanelBackup'
import {
  reconcileDirectConverterCommonLoadPath,
  reconcileSupplyAssemblyAcConductorFlow,
} from './editorIntegration'
import {
  panelHasModularChangeover,
  panelRequiresSplitFeed,
  setPanelFeedOrganizationInProject,
} from '@/lib/panel/panelFeedOrganization'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { resolveAssemblyPanelInput, resolveCommonLoadTail } from './electricalTopology'

function rootFeedTargetsPanel(
  project: ProjectWithOptionalV2Electrical,
  rootFeedId: string,
  panelId: string
): boolean {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return false
  return ensureInstallationFeedTopology(
    installation,
    getProjectElectricalPanels(project)
  ).rootFeeds.some((feed) => feed.id === rootFeedId && feed.panelId === panelId)
}

function attachmentTargetsPanel(
  project: ProjectWithOptionalV2Electrical,
  attachment:
    | OffGridSupplyAssembly['incomingAttachment']
    | OffGridSupplyAssembly['loadHandoffs'][number]['target'],
  panelId: string
): boolean {
  if (
    (attachment.kind === 'panel-input' || attachment.kind === 'panel-bus-input') &&
    attachment.panelId === panelId
  ) {
    return true
  }
  return (
    attachment.kind === 'root-feed' && rootFeedTargetsPanel(project, attachment.rootFeedId, panelId)
  )
}

function panelIsReferencedByAssembly(
  project: ProjectWithOptionalV2Electrical,
  assembly: OffGridSupplyAssembly,
  panelId: string
): boolean {
  if (attachmentTargetsPanel(project, assembly.incomingAttachment, panelId)) {
    return true
  }
  return assembly.loadHandoffs.some((handoff) =>
    attachmentTargetsPanel(project, handoff.target, panelId)
  )
}

function panelHandoffForAssembly(
  project: ProjectWithOptionalV2Electrical,
  assembly: OffGridSupplyAssembly,
  panelId: string
) {
  return assembly.loadHandoffs.find((handoff) =>
    attachmentTargetsPanel(project, handoff.target, panelId)
  )
}

function acConductors(project: ProjectWithOptionalV2Electrical): AcPhase[] {
  const system = getProjectElectricalInstallation(project)?.nominalVoltage.system
  const phases = getInstallationPhases(system ?? '1N~')
  return phases.length > 0 ? phases : ['L1', 'N']
}

function acPort(node: SupplyNode | undefined, portId: string): SupplyPort | undefined {
  return node?.ports.find((port) => port.id === portId && port.domain === 'AC')
}

function addPanelHandoff(
  project: ProjectWithOptionalV2Electrical,
  assembly: OffGridSupplyAssembly,
  panel: Panel,
  source: {
    nodeId: string
    portId: string
    pathRole: Extract<SupplyConnection['pathRole'], 'load-ac' | 'grid-only-bypass-ac'>
  },
  conductors: AcPhase[]
): boolean {
  const handoffNodeId = `${assembly.id}-panel-handoff-${panel.id}`
  const handoffId = `${assembly.id}-panel-load-${panel.id}`
  const connectionId = `${assembly.id}-to-${handoffNodeId}`
  const existingHandoff = assembly.loadHandoffs.find((handoff) => handoff.id === handoffId)
  if (existingHandoff || panelHandoffForAssembly(project, assembly, panel.id)) return false

  if (!assembly.nodes.some((node) => node.id === handoffNodeId)) {
    assembly.nodes.push({
      id: handoffNodeId,
      kind: 'panel-handoff',
      symbol: 'panel_distribution',
      label: panel.name,
      properties: {},
      ports: [
        {
          id: 'in',
          role: 'panel-handoff',
          domain: 'AC',
          behavior: 'sink',
          conductors: [...conductors],
          maxConnections: 1,
        },
      ],
    })
  }

  const sourceNode = assembly.nodes.find((node) => node.id === source.nodeId)
  const sourcePort = acPort(sourceNode, source.portId)
  if (!sourceNode || !sourcePort) return false
  sourcePort.maxConnections = 'many'
  const handoffNode = assembly.nodes.find((node) => node.id === handoffNodeId)
  const handoffPort = acPort(handoffNode, 'in')
  if (!handoffPort) return false
  handoffPort.conductors = [...conductors]

  if (!assembly.connections.some((connection) => connection.id === connectionId)) {
    assembly.connections.push({
      id: connectionId,
      endpoints: [
        { nodeId: source.nodeId, portId: source.portId },
        { nodeId: handoffNodeId, portId: 'in' },
      ],
      domain: 'AC',
      conductors: [...conductors],
      pathRole: source.pathRole,
    })
  }
  assembly.loadHandoffs.push({
    id: handoffId,
    handoffNodeId,
    target: { kind: 'panel-input', panelId: panel.id },
    conductors: [...conductors],
  })
  return true
}

/**
 * A root-panel handoff is not complete until the panel's own incoming buses
 * reflect the source graph.  In particular, a changeover load carries both
 * the utility and backup paths, so the receiving panel must expose the same
 * grid/backup split as an existing main panel.  Keeping this here makes all
 * entry points (new panel drops and panel promotion through rewire) converge
 * on the same persisted representation.
 */
function configureRootPanelFeedOrganization(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): boolean {
  return setPanelFeedOrganizationInProject(
    project,
    panelId,
    panelHasModularChangeover(project, panelId)
      ? 'split-switchable'
      : panelRequiresSplitFeed(project, panelId)
        ? 'split-backup'
        : 'single'
  )
}

/**
 * Attach a newly-created/promoted root panel to the existing supply assembly.
 *
 * Root panels are normally added to the legacy feed topology first. When an
 * off-grid assembly is already present, that would otherwise leave the new
 * panel connected directly to the meter. This adds a graph handoff instead,
 * preserving the assembly as the electrical source for every main panel.
 */
export function attachRootPanelToExistingSupplyAssembly(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): boolean {
  const panel = getProjectElectricalPanels(project).find((candidate) => candidate.id === panelId)
  if (!panel || panel.isMain === false) return false

  const panels = getProjectElectricalPanels(project)
  const assemblies = editProjectSupplyAssemblies(project)
  const eligibleAssemblies = assemblies.filter((candidate) => {
    if (panelIsReferencedByAssembly(project, candidate, panelId)) return false
    return panels.some(
      (candidatePanel) =>
        candidatePanel.id !== panelId &&
        candidatePanel.isMain !== false &&
        panelIsReferencedByAssembly(project, candidate, candidatePanel.id)
    )
  })
  if (eligibleAssemblies.length !== 1) return false
  const assembly = eligibleAssemblies[0]!

  const phases = acConductors(project)
  const changeover = assembly.nodes.find((node) => node.kind === 'changeover-switch')
  if (changeover) {
    const tail = resolveCommonLoadTail(assembly, project)
    const load =
      tail &&
      acPort(
        assembly.nodes.find((node) => node.id === tail.nodeId),
        tail.portId
      )
    if (!load || !tail) return false
    const changed = addPanelHandoff(
      project,
      assembly,
      panel,
      { ...tail, pathRole: 'load-ac' },
      load.conductors.length > 0 ? (load.conductors as AcPhase[]) : phases
    )
    const flowChanged = reconcileSupplyAssemblyAcConductorFlow(project)
    const organizationChanged = configureRootPanelFeedOrganization(project, panel.id)
    return changed || flowChanged || organizationChanged
  }

  const inverter = assembly.nodes.find((node) => node.kind === 'inverter-unit')
  if (!inverter) return false
  const hasGridConnection = assembly.connections.some(
    (connection) =>
      connection.pathRole === 'inverter-grid-ac' &&
      connection.endpoints.some((endpoint) => endpoint.nodeId === inverter.id)
  )
  if (!hasGridConnection) {
    // A grid-isolated inverter can only feed the new root from its backup port.
    const changed = enableDirectInverterPanelBackup(assembly, panel.id)
    if (changed) reconcileSupplyAssemblyAcConductorFlow(project)
    const organizationChanged = configureRootPanelFeedOrganization(project, panel.id)
    return changed || organizationChanged
  }

  const owner = resolveAssemblyPanelInput(project, assembly.incomingAttachment)
  const commonChanged = owner
    ? reconcileDirectConverterCommonLoadPath(project, owner.panelId)
    : false
  const tail = resolveCommonLoadTail(assembly, project)
  const loadPort =
    tail &&
    acPort(
      assembly.nodes.find((node) => node.id === tail.nodeId),
      tail.portId
    )
  if (!tail || !loadPort) return false
  const changed = addPanelHandoff(
    project,
    assembly,
    panel,
    { ...tail, pathRole: 'grid-only-bypass-ac' },
    loadPort.conductors.length > 0 ? (loadPort.conductors as AcPhase[]) : phases
  )
  const flowChanged = reconcileSupplyAssemblyAcConductorFlow(project)
  const organizationChanged = configureRootPanelFeedOrganization(project, panel.id)
  return commonChanged || changed || flowChanged || organizationChanged
}
