import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  getMutableSupplyAssembliesForProject,
  getSupplyAssembliesFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { collectRootPanels, ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { getInstallationPhases } from '@/lib/wires/phaseAssignment'
import { getSymbolById } from '@/lib/symbols'
import type { AcPhase, Circuit, ProtectionDevice, TrunkDevice } from '@/types/schema'
import type {
  BackupSourceCapabilities,
  OffGridSupplyAssembly,
  SupplyConnection,
  SupplyConductor,
  SupplyNode,
  SupplyPort,
  SupplyProtectionProperties,
} from '@/types/supplyAssembly'
import {
  getSupplyConverterAcConductors,
  getSupplyInverterUnitPhaseAssignments,
} from './supplyConverterPhases'
import { logger } from '@/lib/logger'
import { supplyNodeReferencesDevice } from './deviceReferences'
import { enableDirectInverterPanelBackup } from './directInverterPanelBackup'

const BACKUP_CONVERSION_SYMBOLS = new Set([
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
])

const SUPPLY_ASSEMBLY_BRANCH_PATHS = new Set<TrunkDevice['supplyPath']>([
  'backup',
  'backup-output',
  'changeover-grid',
  'converter-grid',
  'converter-branch',
  'converter-dc',
  'converter-dc-top',
])

function isInverterUnitNode(
  node: SupplyNode
): node is Extract<SupplyNode, { kind: 'inverter-unit' }> {
  return node.kind === 'inverter-unit'
}

function isAssemblyOnlySupplyDevice(device: TrunkDevice): boolean {
  return (
    device.symbol === 'source_changeover' || SUPPLY_ASSEMBLY_BRANCH_PATHS.has(device.supplyPath)
  )
}

function acConductors(project: ProjectWithOptionalV2Electrical): AcPhase[] {
  const system = getElectricalInstallationFromProject(project)?.nominalVoltage.system
  const phases = getInstallationPhases(system ?? '1N~')
  return phases.length > 0 ? phases : ['L1', 'N']
}

function port(
  id: string,
  role: SupplyPort['role'],
  conductors: AcPhase[],
  behavior: SupplyPort['behavior'],
  maxConnections: number | 'many' = 1
): SupplyPort {
  return { id, role, domain: 'AC', behavior, conductors: [...conductors], maxConnections }
}

function connection(
  id: string,
  first: [string, string],
  second: [string, string],
  pathRole: SupplyConnection['pathRole'],
  conductors: AcPhase[]
): SupplyConnection {
  return {
    id,
    endpoints: [
      { nodeId: first[0], portId: first[1] },
      { nodeId: second[0], portId: second[1] },
    ],
    domain: 'AC',
    conductors: [...conductors],
    pathRole,
  }
}

function dcPort(
  id: string,
  role: Extract<SupplyPort['role'], 'battery-dc' | 'dc-bus' | 'solar-dc'>,
  behavior: SupplyPort['behavior'],
  maxConnections: number | 'many' = 1
): SupplyPort {
  return {
    id,
    role,
    domain: 'DC',
    behavior,
    conductors: ['DC+', 'DC-'],
    maxConnections,
  }
}

function dcConnection(
  id: string,
  first: [string, string],
  second: [string, string],
  pathRole: Extract<SupplyConnection['pathRole'], 'battery-dc' | 'solar-dc' | 'dc-bus'>
): SupplyConnection {
  return {
    id,
    endpoints: [
      { nodeId: first[0], portId: first[1] },
      { nodeId: second[0], portId: second[1] },
    ],
    domain: 'DC',
    conductors: ['DC+', 'DC-'],
    pathRole,
  }
}

function assemblyIds(changeoverId: string) {
  return {
    assembly: `supply-assembly-${changeoverId}`,
    utility: `utility-${changeoverId}`,
    handoff: `handoff-${changeoverId}`,
    handoffRecord: `handoff-record-${changeoverId}`,
    gridToChangeover: `grid-to-${changeoverId}`,
    changeoverToHandoff: `${changeoverId}-to-handoff`,
  }
}

/**
 * Canonical graph counterpart for the modular switch shown in the ordinary one-wire supply path.
 * Trunk devices remain the editor's placeable symbols; this graph records their electrical roles.
 */
export function buildChangeoverSupplyAssembly(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  changeover: TrunkDevice
): OffGridSupplyAssembly {
  const conductors = acConductors(project)
  const liveConductors = conductors.filter((conductor) => conductor !== 'N' && conductor !== 'PE')
  const switchedConductors = conductors.filter((conductor) => conductor !== 'PE')
  const ids = assemblyIds(changeover.id)
  const neutralPresent = conductors.includes('N')
  const nodes: SupplyNode[] = [
    {
      id: ids.utility,
      kind: 'utility-source',
      symbol: 'mains',
      label: 'Grid',
      properties: { origin: 'grid' },
      ports: [port('out', 'utility-ac', conductors, 'source', 'many')],
    },
    {
      id: changeover.id,
      deviceId: changeover.id,
      kind: 'changeover-switch',
      symbol: 'source_changeover',
      label: changeover.label,
      properties: {
        switchingMode: 'manual',
        transition: 'break-before-make',
        poles: Math.min(4, Math.max(1, switchedConductors.length)) as 1 | 2 | 3 | 4,
        switchedConductors,
        neutralTreatment: neutralPresent ? 'switched' : 'not-present',
        port1Label: changeover.changeoverProps?.port1Label ?? '1',
        port2Label: changeover.changeoverProps?.port2Label ?? '2',
      },
      ports: [
        port('grid', 'source-grid-ac', conductors, 'sink'),
        port('backup', 'source-backup-ac', conductors, 'sink'),
        // A supply assembly can feed more than one parallel main panel. Each
        // panel gets its own handoff from this common switched load output.
        port('load', 'load-ac', conductors, 'source', 'many'),
      ],
    },
    {
      id: ids.handoff,
      kind: 'panel-handoff',
      symbol: 'panel_distribution',
      label: 'Main panel',
      properties: {},
      ports: [port('in', 'panel-handoff', conductors, 'sink')],
    },
  ]

  return {
    id: ids.assembly,
    graphVersion: 1,
    presetIntent: liveConductors.length >= 3 ? 'custom_phase_mapping' : 'single_phase_installation',
    incomingAttachment: { kind: 'panel-input', panelId },
    loadHandoffs: [
      {
        id: ids.handoffRecord,
        handoffNodeId: ids.handoff,
        target: { kind: 'panel-input', panelId },
        conductors: [...conductors],
      },
    ],
    nodes,
    connections: [
      connection(
        ids.gridToChangeover,
        [ids.utility, 'out'],
        [changeover.id, 'grid'],
        'grid-ac',
        conductors
      ),
      connection(
        ids.changeoverToHandoff,
        [changeover.id, 'load'],
        [ids.handoff, 'in'],
        'load-ac',
        conductors
      ),
    ],
    inverterGroups: [],
  }
}

export function findAssemblyForChangeover(
  project: ProjectWithOptionalV2Electrical,
  changeoverId: string
): OffGridSupplyAssembly | undefined {
  return getSupplyAssembliesFromProject(project).find((assembly) =>
    assembly.nodes.some(
      (node) => node.kind === 'changeover-switch' && supplyNodeReferencesDevice(node, changeoverId)
    )
  )
}

function changeoverConductors(device: TrunkDevice, available: AcPhase[]): AcPhase[] {
  const config = device.polesConfig
  if (!config && device.poles == null) return [...available]
  const linePhases = available.filter(
    (phase): phase is Extract<AcPhase, 'L1' | 'L2' | 'L3'> =>
      phase === 'L1' || phase === 'L2' || phase === 'L3'
  )
  const hasNeutral = available.includes('N')
  if (config === '1P') return linePhases.slice(0, 1)
  if (config === '1P+N' || (config === '2P' && hasNeutral)) {
    return [...linePhases.slice(0, 1), ...(hasNeutral ? (['N'] as const) : [])]
  }
  if (config === '2P') return linePhases.slice(0, 2)
  if (config === '3P') return linePhases.slice(0, 3)
  if (config === '3P+N' || config === '4P') return [...available]
  const poles = Math.max(1, Math.min(4, device.poles ?? available.length))
  if (hasNeutral && poles === 2) return [...linePhases.slice(0, 1), 'N']
  if (hasNeutral && poles >= 4) return [...available]
  return linePhases.slice(0, poles)
}

const AC_CONDUCTOR_ORDER: AcPhase[] = ['L1', 'L2', 'L3', 'N', 'PE']

function orderedAcConductors(conductors: Iterable<SupplyConductor>): AcPhase[] {
  return Array.from(
    new Set(
      Array.from(conductors).filter(
        (conductor): conductor is AcPhase => conductor !== 'DC+' && conductor !== 'DC-'
      )
    )
  ).sort((left, right) => AC_CONDUCTOR_ORDER.indexOf(left) - AC_CONDUCTOR_ORDER.indexOf(right))
}

function intersectAcConductors(available: AcPhase[], capability: AcPhase[]): AcPhase[] {
  const intersection = available.filter((conductor) => capability.includes(conductor))
  // A neutral on its own is not an energized AC path.
  return intersection.some(
    (conductor) => conductor === 'L1' || conductor === 'L2' || conductor === 'L3'
  )
    ? orderedAcConductors(intersection)
    : []
}

function applyProtectionConductorLimit(
  available: AcPhase[],
  protection: Pick<TrunkDevice, 'polesConfig' | 'poles'>
): AcPhase[] {
  return changeoverConductors(protection as TrunkDevice, available)
}

function getAssemblyPanelId(assembly: OffGridSupplyAssembly): string | undefined {
  if (
    assembly.incomingAttachment.kind === 'panel-input' ||
    assembly.incomingAttachment.kind === 'panel-bus-input'
  ) {
    return assembly.incomingAttachment.panelId
  }
  const panelHandoff = assembly.loadHandoffs.find(
    (handoff) => handoff.target.kind === 'panel-input' || handoff.target.kind === 'panel-bus-input'
  )
  return panelHandoff?.target.kind === 'panel-input' ||
    panelHandoff?.target.kind === 'panel-bus-input'
    ? panelHandoff.target.panelId
    : undefined
}

/**
 * Conductors available at the utility node after every serial shared/root protection.
 * Branch protections are deliberately excluded: they narrow only their own path below.
 */
function getAssemblyUtilityConductors(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): AcPhase[] {
  const installation = getElectricalInstallationFromProject(project)
  if (!installation) return acConductors(project)
  const topology = ensureInstallationFeedTopology(
    installation,
    getElectricalPanelsFromProject(project)
  )
  const root = topology.rootFeeds.find((feed) => feed.panelId === panelId)
  const serialProtections = [
    ...(topology.sharedFeed.trunkDevices ?? []),
    ...(root?.trunkDevices ?? []),
  ].filter(
    (device) =>
      device.type === 'protection' && (device.supplyPath == null || device.supplyPath === 'serial')
  )
  return serialProtections.reduce(
    (available, device) => applyProtectionConductorLimit(available, device),
    acConductors(project)
  )
}

/**
 * Recompute every AC connection from its real upstream source. This is intentionally a
 * monotonic flow pass: a later wider protection can never restore phases removed earlier.
 * Grid and backup inputs remain independent until the changeover load port combines them.
 */
export function reconcileSupplyAssemblyAcConductorFlow(
  project: ProjectWithOptionalV2Electrical,
  panelId?: string
): boolean {
  const assemblies = getMutableSupplyAssembliesForProject(project).filter(
    (assembly) => !panelId || getAssemblyPanelId(assembly) === panelId
  )
  if (assemblies.length === 0) return false
  const installation = getElectricalInstallationFromProject(project)
  const topology = installation
    ? ensureInstallationFeedTopology(installation, getElectricalPanelsFromProject(project))
    : undefined
  let changed = false

  for (const assembly of assemblies) {
    const ownerPanelId = getAssemblyPanelId(assembly)
    if (!ownerPanelId) continue
    const previous = JSON.stringify(assembly)
    const nodesById = new Map(assembly.nodes.map((node) => [node.id, node]))
    const state = new Map<string, AcPhase[]>()
    const key = (nodeId: string, portId: string) => `${nodeId}\u0000${portId}`
    const endpointFlowScore = (
      endpoint: SupplyConnection['endpoints'][number],
      pathRole: SupplyConnection['pathRole']
    ): number => {
      const node = nodesById.get(endpoint.nodeId)
      const candidate = node?.ports.find((portCandidate) => portCandidate.id === endpoint.portId)
      if (!node || !candidate) return 0
      if (pathRole === 'inverter-backup-ac' && candidate.role === 'inverter-backup-ac') return 20
      if (pathRole === 'load-ac' && candidate.role === 'load-ac') return 20
      if (
        (pathRole === 'grid-ac' || pathRole === 'inverter-grid-ac') &&
        candidate.role === 'utility-ac'
      ) {
        return 20
      }
      if (candidate.role === 'serial-load-side') return 10
      if (candidate.role === 'serial-source-side') return -10
      if (
        candidate.role === 'source-grid-ac' ||
        candidate.role === 'source-backup-ac' ||
        candidate.role === 'panel-handoff' ||
        candidate.role === 'inverter-grid-ac'
      ) {
        return -20
      }
      return candidate.behavior === 'source' ? 5 : candidate.behavior === 'sink' ? -5 : 0
    }
    const setState = (nodeId: string, portId: string, conductors: AcPhase[]): boolean => {
      const stateKey = key(nodeId, portId)
      const next = orderedAcConductors([...(state.get(stateKey) ?? []), ...conductors])
      const current = state.get(stateKey) ?? []
      if (next.join('|') === current.join('|')) return false
      state.set(stateKey, next)
      return true
    }

    const inverterCapabilities = new Map<string, AcPhase[]>()
    for (const group of assembly.inverterGroups) {
      const baseNode = assembly.nodes.find((node) => node.id === group.unitNodeIds[0])
      const deviceId = baseNode?.deviceId ?? baseNode?.id
      const converter = topology?.rootFeeds
        .flatMap((feed) => feed.trunkDevices ?? [])
        .find((device) => device.id === deviceId)
      if (!converter) continue
      const assignments = getSupplyInverterUnitPhaseAssignments(
        converter,
        installation?.nominalVoltage.system ?? '1N~',
        group.unitNodeIds.length
      )
      group.unitNodeIds.forEach((nodeId, index) => {
        inverterCapabilities.set(nodeId, orderedAcConductors(assignments[index]?.phases ?? []))
      })
    }

    const utilityConductors = getAssemblyUtilityConductors(project, ownerPanelId)
    for (const utility of assembly.nodes.filter((node) => node.kind === 'utility-source')) {
      for (const utilityPort of utility.ports.filter((candidate) => candidate.domain === 'AC')) {
        utilityPort.conductors = [...utilityConductors]
        setState(utility.id, utilityPort.id, utilityConductors)
      }
    }
    for (const inverter of assembly.nodes.filter(isInverterUnitNode)) {
      const capability = inverterCapabilities.get(inverter.id)
      if (!capability) continue
      const backupPort = inverter.ports.find((candidate) => candidate.role === 'inverter-backup-ac')
      if (backupPort) {
        backupPort.conductors = [...capability]
        setState(inverter.id, backupPort.id, capability)
      }
    }

    // Connections are persisted in source-to-load order. Iterate to a fixed point so
    // parallel inverter units can merge before a shared protection narrows their union.
    for (
      let iteration = 0;
      iteration < assembly.nodes.length + assembly.connections.length + 4;
      iteration++
    ) {
      let progressed = false

      for (const node of assembly.nodes) {
        if (node.kind === 'protection') {
          const sourcePort = node.ports.find((candidate) => candidate.id === 'source')
          const loadPort = node.ports.find((candidate) => candidate.id === 'load')
          const incoming = sourcePort ? state.get(key(node.id, sourcePort.id)) : undefined
          if (!sourcePort || !loadPort || !incoming?.length) continue
          sourcePort.conductors = [...incoming]
          const outgoing = applyProtectionConductorLimit(incoming, node.properties)
          loadPort.conductors = [...outgoing]
          progressed = setState(node.id, loadPort.id, outgoing) || progressed
        } else if (node.kind === 'ac-distribution') {
          // Serial branch devices (meters, junctions, and legacy protection snapshots)
          // are often persisted with `passive` behavior on both ports. Their roles are
          // the authoritative direction in that case: source-side receives the feed and
          // load-side passes it onward. Without this fallback, a stale empty load port
          // breaks the entire backup route and makes the feed organization appear
          // unavailable after reload.
          const inputPorts = node.ports.filter(
            (candidate) =>
              candidate.domain === 'AC' &&
              (candidate.behavior === 'sink' || candidate.role === 'serial-source-side')
          )
          const outputPorts = node.ports.filter(
            (candidate) =>
              candidate.domain === 'AC' &&
              candidate.role !== 'serial-source-side' &&
              (candidate.role === 'serial-load-side' || candidate.behavior !== 'sink')
          )
          const incoming = orderedAcConductors(
            inputPorts.flatMap((candidate) => state.get(key(node.id, candidate.id)) ?? [])
          )
          for (const outputPort of outputPorts) {
            outputPort.conductors = [...incoming]
            progressed = setState(node.id, outputPort.id, incoming) || progressed
          }
        } else if (node.kind === 'changeover-switch') {
          const gridPort = node.ports.find((candidate) => candidate.id === 'grid')
          const backupPort = node.ports.find((candidate) => candidate.id === 'backup')
          const loadPort = node.ports.find((candidate) => candidate.id === 'load')
          if (!loadPort) continue
          const switched = orderedAcConductors(node.properties.switchedConductors)
          const available = orderedAcConductors([
            ...(gridPort ? (state.get(key(node.id, gridPort.id)) ?? []) : []),
            ...(backupPort ? (state.get(key(node.id, backupPort.id)) ?? []) : []),
          ])
          const outgoing = intersectAcConductors(available, switched)
          loadPort.conductors = [...outgoing]
          progressed = setState(node.id, loadPort.id, outgoing) || progressed
        }
      }

      for (const candidate of assembly.connections.filter(
        (connection) => connection.domain === 'AC'
      )) {
        const [first, second] = candidate.endpoints
        const [from, to] =
          endpointFlowScore(first, candidate.pathRole) >=
          endpointFlowScore(second, candidate.pathRole)
            ? [first, second]
            : [second, first]
        const available = state.get(key(from.nodeId, from.portId))
        if (!available?.length) continue
        const targetNode = nodesById.get(to.nodeId)
        let delivered = available
        if (targetNode?.kind === 'inverter-unit') {
          const capability = inverterCapabilities.get(targetNode.id)
          if (capability) delivered = intersectAcConductors(available, capability)
        } else if (targetNode?.kind === 'changeover-switch') {
          delivered = intersectAcConductors(
            available,
            orderedAcConductors(targetNode.properties.switchedConductors)
          )
        }
        candidate.conductors = [...delivered]
        progressed = setState(to.nodeId, to.portId, delivered) || progressed
      }
      if (!progressed) break
    }

    for (const node of assembly.nodes) {
      for (const candidate of node.ports.filter((portCandidate) => portCandidate.domain === 'AC')) {
        const resolved = state.get(key(node.id, candidate.id))
        candidate.conductors = resolved ? [...resolved] : orderedAcConductors(candidate.conductors)
      }
    }
    for (const handoff of assembly.loadHandoffs) {
      const handoffNode = nodesById.get(handoff.handoffNodeId)
      const conductors = orderedAcConductors(
        handoffNode?.ports
          .filter((candidate) => candidate.domain === 'AC')
          .flatMap((candidate) => state.get(key(handoffNode.id, candidate.id)) ?? []) ?? []
      )
      if (conductors.length > 0) handoff.conductors = conductors
    }
    changed ||= JSON.stringify(assembly) !== previous
  }
  return changed
}

/** Keep a persisted modular-switch graph aligned with its live voltage system and pole setting. */
export function reconcileChangeoverSupplyAssembly(
  project: ProjectWithOptionalV2Electrical,
  changeover: TrunkDevice
): boolean {
  if (changeover.symbol !== 'source_changeover') return false
  const assembly = findAssemblyForChangeover(project, changeover.id)
  const node = assembly?.nodes.find(
    (candidate): candidate is Extract<SupplyNode, { kind: 'changeover-switch' }> =>
      candidate.kind === 'changeover-switch' && supplyNodeReferencesDevice(candidate, changeover.id)
  )
  if (!assembly || !node) return false
  const previous = JSON.stringify(assembly)
  const available = acConductors(project)
  const switched = changeoverConductors(changeover, available)
  node.label = changeover.label
  node.properties = {
    ...node.properties,
    poles: Math.min(4, Math.max(1, switched.length)) as 1 | 2 | 3 | 4,
    switchedConductors: [...switched],
    neutralTreatment: switched.includes('N') ? 'switched' : 'not-present',
    port1Label: changeover.changeoverProps?.port1Label ?? node.properties.port1Label,
    port2Label: changeover.changeoverProps?.port2Label ?? node.properties.port2Label,
  }
  const loadPort = node.ports.find((candidate) => candidate.id === 'load')
  if (loadPort) loadPort.maxConnections = 'many'
  for (const candidate of node.ports) candidate.conductors = [...switched]
  for (const handoff of assembly.loadHandoffs) {
    handoff.conductors = [...switched]
    const handoffNode = assembly.nodes.find((candidate) => candidate.id === handoff.handoffNodeId)
    for (const handoffPort of handoffNode?.ports.filter((candidate) => candidate.domain === 'AC') ??
      []) {
      handoffPort.conductors = [...switched]
    }
  }
  for (const candidate of assembly.connections.filter(
    (connection) => connection.domain === 'AC' && connection.pathRole === 'load-ac'
  )) {
    candidate.conductors = [...switched]
  }
  reconcileSupplyAssemblyAcConductorFlow(project, getAssemblyPanelId(assembly))
  return JSON.stringify(assembly) !== previous
}

export function buildDirectConverterSupplyAssembly(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  converter: TrunkDevice
): OffGridSupplyAssembly {
  const conductors = acConductors(project)
  const system = getElectricalInstallationFromProject(project)?.nominalVoltage.system ?? '1N~'
  const converterConductors = getSupplyConverterAcConductors(converter, system)
  const utilityId = `utility-${converter.id}`
  const capabilities: BackupSourceCapabilities = {
    supportsBackupSupply: false,
    supportsIslandMode: false,
    hasBidirectionalGridPort: converter.symbol === 'inverter',
    hasBatteryDcPort: true,
    hasIntegratedSolarDcInput: true,
    evidence: { source: 'manual' },
  }
  const gridInputConnected = converter.converterGridInputConnected !== false
  return {
    id: `supply-assembly-${converter.id}`,
    graphVersion: 1,
    presetIntent: 'grid_connected_storage_branch',
    incomingAttachment: { kind: 'panel-input', panelId },
    loadHandoffs: [],
    nodes: [
      {
        id: utilityId,
        kind: 'utility-source',
        symbol: 'mains',
        label: 'Grid',
        properties: { origin: 'grid' },
        ports: [port('out', 'utility-ac', conductors, 'source', 'many')],
      },
      {
        id: converter.id,
        deviceId: converter.id,
        kind: 'inverter-unit',
        symbol: converter.symbol,
        label: converter.label,
        properties: {
          serialNumber: converter.conversionProps?.serialNumber,
          ...(gridInputConnected ? {} : { gridInputConnected: false }),
        },
        ports: [
          port(
            'grid',
            'inverter-grid-ac',
            converterConductors,
            converter.symbol === 'rectifier' ? 'sink' : 'bidirectional'
          ),
          dcPort(
            'dc',
            'dc-bus',
            converter.symbol === 'rectifier' ? 'source' : 'bidirectional',
            'many'
          ),
        ],
      },
    ],
    connections: gridInputConnected
      ? [
          connection(
            `${utilityId}-to-${converter.id}`,
            [utilityId, 'out'],
            [converter.id, 'grid'],
            'inverter-grid-ac',
            converterConductors
          ),
        ]
      : [],
    inverterGroups: [
      {
        id: `grid-storage-group-${converter.id}`,
        shared: {
          brand: converter.conversionProps?.brand,
          model: converter.conversionProps?.model,
          capabilities,
        },
        use: { enabledForBackup: false, enabledForIslandMode: false },
        coordination: 'native-multiphase',
        unitNodeIds: [converter.id],
      },
    ],
  }
}

export function findAssemblyForDirectConverter(
  project: ProjectWithOptionalV2Electrical,
  converterId: string
): OffGridSupplyAssembly | undefined {
  return getSupplyAssembliesFromProject(project).find(
    (assembly) =>
      assembly.presetIntent === 'grid_connected_storage_branch' &&
      assembly.nodes.some(
        (node) => node.kind === 'inverter-unit' && supplyNodeReferencesDevice(node, converterId)
      )
  )
}

/** Adds the one optional protected load circuit fed by a standalone converter's backup AC port. */
export function attachDirectConverterBackupCircuit(
  assembly: OffGridSupplyAssembly,
  converter: TrunkDevice,
  protection: ProtectionDevice,
  circuit: Circuit,
  panelId: string
): OffGridSupplyAssembly {
  const converterNode = assembly.nodes.find(
    (node) => node.id === converter.id && node.kind === 'inverter-unit'
  )
  if (!converterNode) return assembly
  const gridPort = converterNode.ports.find((candidate) => candidate.domain === 'AC')
  const conductors = (gridPort?.conductors ?? ['L1', 'N']).filter(
    (candidate): candidate is AcPhase => candidate !== 'DC+' && candidate !== 'DC-'
  )
  const protectionNodeId = `converter-backup-protection-${protection.id}`
  const handoffNodeId = `converter-backup-handoff-${circuit.id}`
  const trunkDevices = [...(circuit.trunkDevices ?? [])].sort(
    (left, right) => left.trunkPosition - right.trunkPosition
  )
  const serialNodeIds = [protectionNodeId, ...trunkDevices.map((device) => device.id)]
  const nextNodes = assembly.nodes
    .filter((node) => !serialNodeIds.includes(node.id) && node.id !== handoffNodeId)
    .map((node) => ({
      ...node,
      properties: { ...node.properties },
      ports: node.ports.map((candidate) => ({
        ...candidate,
        conductors: [...candidate.conductors],
      })),
    })) as SupplyNode[]
  nextNodes.push(
    {
      id: protectionNodeId,
      kind: 'protection',
      symbol: protection.type === 'FUSE' ? 'fuse' : 'mcb',
      label: protection.label,
      properties: {
        type: protection.type,
        ratingA: protection.ratingA,
        curve: protection.curve,
        sensitivityMa: protection.sensitivityMa,
        residualCurrentType: protection.residualCurrentType,
        breakingCapacityKa: protection.breakingCapacityKa,
        breakingCapacityOption: protection.breakingCapacityOption,
        surgeProtectionKind: protection.surgeProtectionKind,
        polesConfig: protection.polesConfig,
        poles: protection.poles,
        notes: protection.notes,
      },
      ports: [
        port('source', 'serial-source-side', conductors, 'passive'),
        port('load', 'serial-load-side', conductors, 'passive'),
      ],
    },
    ...trunkDevices.map((device) => supplyAcBranchNode(device, conductors)),
    {
      id: handoffNodeId,
      kind: 'panel-handoff',
      symbol: 'panel_distribution',
      label: circuit.code,
      properties: {},
      ports: [port('in', 'panel-handoff', conductors, 'sink')],
    }
  )
  const nextConverterNode = nextNodes.find((node) => node.id === converter.id)
  if (
    nextConverterNode &&
    !nextConverterNode.ports.some((candidate) => candidate.id === 'backup')
  ) {
    nextConverterNode.ports.push(port('backup', 'inverter-backup-ac', conductors, 'source'))
  }
  const connectionIds = new Set<string>()
  let previousNodeId = converter.id
  let previousPortId = 'backup'
  for (const nodeId of serialNodeIds) {
    connectionIds.add(`${previousNodeId}-to-${nodeId}`)
    previousNodeId = nodeId
    previousPortId = 'load'
  }
  connectionIds.add(`${previousNodeId}-to-${handoffNodeId}`)
  const serialChainNodeIds = new Set([...serialNodeIds, handoffNodeId])
  const nextConnections = assembly.connections.filter(
    (candidate) =>
      !connectionIds.has(candidate.id) &&
      !candidate.endpoints.some((endpoint) => serialChainNodeIds.has(endpoint.nodeId))
  )
  previousNodeId = converter.id
  previousPortId = 'backup'
  serialNodeIds.forEach((nodeId, index) => {
    nextConnections.push(
      connection(
        `${previousNodeId}-to-${nodeId}`,
        [previousNodeId, previousPortId],
        [nodeId, 'source'],
        index === 0 ? 'inverter-backup-ac' : 'load-ac',
        conductors
      )
    )
    previousNodeId = nodeId
    previousPortId = 'load'
  })
  nextConnections.push(
    connection(
      `${previousNodeId}-to-${handoffNodeId}`,
      [previousNodeId, previousPortId],
      [handoffNodeId, 'in'],
      'load-ac',
      conductors
    )
  )
  return {
    ...assembly,
    nodes: nextNodes,
    connections: nextConnections,
    loadHandoffs: [
      ...assembly.loadHandoffs.filter((candidate) => candidate.handoffNodeId !== handoffNodeId),
      {
        id: `converter-backup-load-${circuit.id}`,
        handoffNodeId,
        target: { kind: 'circuit-input', panelId, circuitId: circuit.id },
        conductors,
      },
    ],
    inverterGroups: assembly.inverterGroups.map((group) =>
      group.unitNodeIds.includes(converter.id)
        ? {
            ...group,
            shared: {
              ...group.shared,
              capabilities: {
                ...group.shared.capabilities,
                supportsBackupSupply: true,
                hasDedicatedBackupAcOutput: true,
              },
            },
            use: { ...group.use, enabledForBackup: true },
          }
        : group
    ),
  }
}

export function retargetDirectConverterBackupPanel(
  assembly: OffGridSupplyAssembly,
  circuitId: string,
  panelId: string
): OffGridSupplyAssembly {
  return {
    ...assembly,
    loadHandoffs: assembly.loadHandoffs.map((candidate) =>
      candidate.target.kind === 'circuit-input' && candidate.target.circuitId === circuitId
        ? { ...candidate, target: { kind: 'panel-input' as const, panelId } }
        : candidate
    ),
  }
}

function preserveConnectionWireProperties(
  previous: SupplyConnection[],
  next: SupplyConnection[]
): SupplyConnection[] {
  const endpointKey = (candidate: SupplyConnection) =>
    `${candidate.pathRole}:${candidate.endpoints
      .map(({ nodeId, portId }) => `${nodeId}:${portId}`)
      .sort()
      .join('|')}`
  const byId = new Map(previous.map((candidate) => [candidate.id, candidate]))
  const byEndpoints = new Map(previous.map((candidate) => [endpointKey(candidate), candidate]))
  return next.map((candidate) => {
    const source = byId.get(candidate.id) ?? byEndpoints.get(endpointKey(candidate))
    if (!source?.wireProperties) return candidate
    return {
      ...candidate,
      wireProperties: {
        ...source.wireProperties,
        cable: { ...source.wireProperties.cable },
      },
    }
  })
}

/** Mirrors one multiplied trunk inverter into distinct physical inverter-unit graph nodes. */
export function reconcileInverterUnitMultiplier(
  project: ProjectWithOptionalV2Electrical,
  converter: TrunkDevice
): boolean {
  if (converter.symbol !== 'inverter') return false
  const assembly = getMutableSupplyAssembliesForProject(project).find((candidate) =>
    candidate.inverterGroups.some((group) => group.unitNodeIds.includes(converter.id))
  )
  if (!assembly) return false
  const group = assembly.inverterGroups.find((candidate) =>
    candidate.unitNodeIds.includes(converter.id)
  )
  const baseNode = assembly.nodes.find(
    (node) => node.id === converter.id && node.kind === 'inverter-unit'
  )
  if (!group || !baseNode || baseNode.kind !== 'inverter-unit') return false
  const previousAssemblyState = JSON.stringify(assembly)

  const desiredCount = Math.min(
    3,
    Math.max(
      1,
      converter.placements?.length ?? 0,
      converter.conversionProps?.serialNumbers?.length ?? 0
    )
  )
  const previousUnitIds = new Set(group.unitNodeIds.filter((id) => id !== converter.id))
  assembly.nodes = assembly.nodes.filter((node) => !previousUnitIds.has(node.id))
  assembly.connections = assembly.connections.filter(
    (candidate) => !candidate.endpoints.some((endpoint) => previousUnitIds.has(endpoint.nodeId))
  )
  baseNode.deviceId = converter.id

  const baseConnections = assembly.connections.filter((candidate) =>
    candidate.endpoints.some((endpoint) => endpoint.nodeId === converter.id)
  )
  const system = getElectricalInstallationFromProject(project)?.nominalVoltage.system ?? '1N~'
  const unitAssignments = getSupplyInverterUnitPhaseAssignments(converter, system, desiredCount)
  const conductorsForUnit = (conductors: SupplyConductor[], index: number): SupplyConductor[] =>
    conductors.some((conductor) => conductor === 'L1' || conductor === 'L2' || conductor === 'L3')
      ? ((unitAssignments[index]?.phases.filter((phase) => phase !== 'PE') as
          | SupplyConductor[]
          | undefined) ?? [...conductors])
      : [...conductors]

  baseNode.ports = baseNode.ports.map((candidate) =>
    candidate.domain === 'AC'
      ? { ...candidate, conductors: conductorsForUnit(candidate.conductors, 0) }
      : candidate
  )
  for (const template of baseConnections) {
    if (template.domain === 'AC') {
      template.conductors = conductorsForUnit(template.conductors, 0)
    }
  }
  const unitNodeIds = [converter.id]
  for (let index = 1; index < desiredCount; index++) {
    const unitId = `${converter.id}-unit-${index + 1}`
    unitNodeIds.push(unitId)
    const clonedNode: Extract<SupplyNode, { kind: 'inverter-unit' }> = {
      ...baseNode,
      id: unitId,
      deviceId: converter.id,
      label: converter.label ? `${converter.label} ${index + 1}` : `Inverter ${index + 1}`,
      properties: { ...baseNode.properties },
      ports: baseNode.ports.map((candidate) => ({
        ...candidate,
        conductors: [...candidate.conductors],
      })),
      mounting: baseNode.mounting ? { enclosure: { ...baseNode.mounting.enclosure } } : undefined,
    }
    clonedNode.ports = clonedNode.ports.map((candidate) =>
      candidate.domain === 'AC'
        ? { ...candidate, conductors: conductorsForUnit(candidate.conductors, index) }
        : candidate
    )
    assembly.nodes.push(clonedNode)
    for (const template of baseConnections) {
      const endpoints = template.endpoints.map((endpoint) =>
        endpoint.nodeId === converter.id ? { ...endpoint, nodeId: unitId } : endpoint
      ) as SupplyConnection['endpoints']
      const clonedConductors = conductorsForUnit(template.conductors, index)
      assembly.connections.push({
        ...template,
        id: `${template.id}-unit-${index + 1}`,
        endpoints,
        conductors: clonedConductors,
        wireProperties: template.wireProperties
          ? {
              ...template.wireProperties,
              cable: { ...template.wireProperties.cable },
            }
          : undefined,
        physicalRoute: template.physicalRoute?.map((enclosure) => ({ ...enclosure })),
      })
      const externalEndpoint = endpoints.find((endpoint) => endpoint.nodeId !== unitId)
      const externalNode = externalEndpoint
        ? assembly.nodes.find((node) => node.id === externalEndpoint.nodeId)
        : undefined
      const externalPort = externalNode?.ports.find(
        (portCandidate) => portCandidate.id === externalEndpoint?.portId
      )
      if (externalPort) {
        externalPort.maxConnections = 'many'
        externalPort.conductors = Array.from(
          new Set([...externalPort.conductors, ...clonedConductors])
        )
      }
    }
  }
  group.unitNodeIds = unitNodeIds
  group.coordination = desiredCount > 1 ? 'independent-per-phase' : 'native-multiphase'
  for (const handoff of assembly.loadHandoffs) {
    const connectedConductors = assembly.connections
      .filter(
        (connection) =>
          connection.domain === 'AC' &&
          connection.endpoints.some((endpoint) => endpoint.nodeId === handoff.handoffNodeId)
      )
      .flatMap((connection) => connection.conductors)
      .filter((conductor): conductor is AcPhase => conductor !== 'DC+' && conductor !== 'DC-')
    if (connectedConductors.length === 0) continue
    const conductorOrder: AcPhase[] = ['L1', 'L2', 'L3', 'N', 'PE']
    handoff.conductors = Array.from(new Set(connectedConductors)).sort(
      (left, right) => conductorOrder.indexOf(left) - conductorOrder.indexOf(right)
    )
  }
  return JSON.stringify(assembly) !== previousAssemblyState
}

/** Synchronizes both placeable converter DC branches into serial graph paths. */
export function reconcileDirectConverterDcDevices(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): boolean {
  const installation = getElectricalInstallationFromProject(project)
  if (!installation) return false
  const rootDevices =
    ensureInstallationFeedTopology(
      installation,
      getElectricalPanelsFromProject(project)
    ).rootFeeds.find((feed) => feed.panelId === panelId)?.trunkDevices ?? []
  const converter = rootDevices.find(
    (device) => device.supplyPath === 'converter-branch' || device.supplyPath === 'backup'
  )
  if (!converter) return false
  const assembly =
    findAssemblyForDirectConverter(project, converter.id) ??
    getSupplyAssembliesFromProject(project).find((candidate) =>
      candidate.nodes.some((node) => node.id === converter.id && node.kind === 'inverter-unit')
    )
  if (!assembly) return false
  const dcDevices = rootDevices.filter(
    (device) => device.supplyPath === 'converter-dc' || device.supplyPath === 'converter-dc-top'
  )
  const previousDcNodeIds = new Set(
    assembly.connections
      .filter(
        (candidate) =>
          candidate.pathRole === 'battery-dc' ||
          candidate.pathRole === 'solar-dc' ||
          candidate.pathRole === 'dc-bus'
      )
      .flatMap((candidate) => candidate.endpoints.map((endpoint) => endpoint.nodeId))
      .filter((nodeId) => nodeId !== converter.id)
  )
  assembly.nodes = [
    ...assembly.nodes.filter((node) => !previousDcNodeIds.has(node.id)),
    ...dcDevices.map<SupplyNode>((device) => {
      if (device.symbol === 'solar_panel') {
        return {
          id: device.id,
          deviceId: device.id,
          kind: 'solar-source',
          symbol: 'solar_panel',
          label: device.label,
          properties: device.solarPanelProps ?? { wattageW: 1000 },
          ports: [dcPort('dc', 'dc-bus', 'bidirectional', 2)],
        }
      }
      if (device.symbol === 'battery') {
        return {
          id: device.id,
          deviceId: device.id,
          kind: 'battery',
          symbol: 'battery',
          label: device.label,
          properties: device.batteryProps ?? { voltageV: 48, capacityKWh: 5 },
          ports: [dcPort('dc', 'dc-bus', 'bidirectional', 2)],
        }
      }
      if (device.type === 'protection') {
        return {
          id: device.id,
          deviceId: device.id,
          kind: 'protection',
          symbol: device.symbol,
          label: device.label,
          properties: protectionProperties(device),
          ports: [dcPort('dc', 'dc-bus', 'bidirectional', 2)],
        }
      }
      return {
        id: device.id,
        deviceId: device.id,
        kind: 'dc-bus',
        symbol: device.symbol,
        label: device.label,
        properties: {},
        ports: [dcPort('dc', 'dc-bus', 'bidirectional', 2)],
      }
    }),
  ]
  const dcConnections: SupplyConnection[] = []
  for (const supplyPath of ['converter-dc', 'converter-dc-top'] as const) {
    let previous: [string, string] = [converter.id, 'dc']
    dcDevices
      .filter((device) => device.supplyPath === supplyPath)
      .forEach((device, index) => {
        const pathRole =
          device.symbol === 'solar_panel'
            ? 'solar-dc'
            : device.symbol === 'battery'
              ? 'battery-dc'
              : 'dc-bus'
        dcConnections.push(
          dcConnection(
            `${converter.id}-${supplyPath}-${index}-${device.id}`,
            previous,
            [device.id, 'dc'],
            pathRole
          )
        )
        previous = [device.id, 'dc']
      })
  }
  const previousDcConnections = assembly.connections
  assembly.connections = preserveConnectionWireProperties(previousDcConnections, [
    ...previousDcConnections.filter(
      (candidate) =>
        candidate.pathRole !== 'battery-dc' &&
        candidate.pathRole !== 'solar-dc' &&
        candidate.pathRole !== 'dc-bus'
    ),
    ...dcConnections,
  ])
  const converterNode = assembly.nodes.find((node) => node.id === converter.id)
  const converterDcPort = converterNode?.ports.find((candidate) => candidate.id === 'dc')
  if (converterDcPort) converterDcPort.maxConnections = 'many'
  reconcileInverterUnitMultiplier(project, converter)
  reconcileSupplyAssemblyAcConductorFlow(project, panelId)
  return true
}

/** Adds the selected converter to both sides of the source loop and enables backup use. */
export function attachBackupConverterToAssembly(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  changeover: TrunkDevice,
  converter: TrunkDevice,
  backupDevicesOverride?: TrunkDevice[],
  changeoverGridDevicesOverride?: TrunkDevice[]
): OffGridSupplyAssembly {
  const existing = findAssemblyForChangeover(project, changeover.id)
  const assembly = structuredClone(
    existing ?? buildChangeoverSupplyAssembly(project, panelId, changeover)
  )
  const conductors = acConductors(project)
  const system = getElectricalInstallationFromProject(project)?.nominalVoltage.system ?? '1N~'
  const converterConductors = getSupplyConverterAcConductors(converter, system)
  const utility = assembly.nodes.find((node) => node.kind === 'utility-source')!
  const backupDevices =
    backupDevicesOverride ??
    ensureInstallationFeedTopology(
      getElectricalInstallationFromProject(project)!,
      getElectricalPanelsFromProject(project)
    )
      .rootFeeds.find((feed) => feed.panelId === panelId)
      ?.trunkDevices?.filter((device) => device.supplyPath === 'backup-output') ??
    []
  const changeoverGridDevices =
    changeoverGridDevicesOverride ??
    ensureInstallationFeedTopology(
      getElectricalInstallationFromProject(project)!,
      getElectricalPanelsFromProject(project)
    )
      .rootFeeds.find((feed) => feed.panelId === panelId)
      ?.trunkDevices?.filter((device) => device.supplyPath === 'changeover-grid') ??
    []
  const capabilities: BackupSourceCapabilities = {
    supportsBackupSupply: true,
    supportsIslandMode: true,
    hasBidirectionalGridPort: true,
    hasDedicatedBackupAcOutput: true,
    requiresExternalChangeover: true,
    evidence: { source: 'manual' },
  }
  const previousConverterNode = assembly.nodes
    .filter(isInverterUnitNode)
    .find((node) => node.id === converter.id)
  const gridInputConnected =
    converter.converterGridInputConnected !== false &&
    previousConverterNode?.properties.gridInputConnected !== false

  const converterNode: SupplyNode = {
    id: converter.id,
    deviceId: converter.id,
    kind: 'inverter-unit',
    symbol: converter.symbol,
    label: converter.label,
    properties: {
      serialNumber: converter.conversionProps?.serialNumber,
      ...(gridInputConnected ? {} : { gridInputConnected: false }),
    },
    ports: [
      port('grid', 'inverter-grid-ac', converterConductors, 'bidirectional'),
      port('backup', 'inverter-backup-ac', converterConductors, 'source'),
      dcPort('dc', 'dc-bus', 'bidirectional', 'many'),
    ],
  }
  assembly.nodes = [
    ...assembly.nodes.filter(
      (node) =>
        node.id !== converter.id &&
        !backupDevices.some((device) => device.id === node.id) &&
        !changeoverGridDevices.some((device) => device.id === node.id) &&
        !(node.kind === 'inverter-unit' && BACKUP_CONVERSION_SYMBOLS.has(node.symbol))
    ),
    converterNode,
    ...backupDevices.map((device) => supplyAcBranchNode(device, converterConductors)),
    ...changeoverGridDevices.map((device) => supplyAcBranchNode(device, conductors)),
  ]
  const backupConnections: SupplyConnection[] = []
  let previousBackupEndpoint: [string, string] = [converter.id, 'backup']
  backupDevices.forEach((device, index) => {
    backupConnections.push(
      connection(
        `${converter.id}-to-${changeover.id}-${index}-in`,
        previousBackupEndpoint,
        [device.id, 'source'],
        'inverter-backup-ac',
        converterConductors
      )
    )
    previousBackupEndpoint = [device.id, 'load']
  })
  backupConnections.push(
    connection(
      `${converter.id}-to-${changeover.id}-out`,
      previousBackupEndpoint,
      [changeover.id, 'backup'],
      'inverter-backup-ac',
      converterConductors
    )
  )
  const changeoverGridConnections: SupplyConnection[] = []
  let previousChangeoverGridEndpoint: [string, string] = [utility.id, 'out']
  changeoverGridDevices.forEach((device, index) => {
    changeoverGridConnections.push(
      connection(
        `${utility.id}-to-${changeover.id}-grid-${index}-in`,
        previousChangeoverGridEndpoint,
        [device.id, 'source'],
        'grid-ac',
        conductors
      )
    )
    previousChangeoverGridEndpoint = [device.id, 'load']
  })
  changeoverGridConnections.push(
    connection(
      `${utility.id}-to-${changeover.id}-grid-out`,
      previousChangeoverGridEndpoint,
      [changeover.id, 'grid'],
      'grid-ac',
      conductors
    )
  )
  const previousAcConnections = assembly.connections
  assembly.connections = preserveConnectionWireProperties(previousAcConnections, [
    ...previousAcConnections.filter(
      (candidate) =>
        candidate.pathRole !== 'grid-ac' &&
        candidate.pathRole !== 'inverter-grid-ac' &&
        candidate.pathRole !== 'inverter-backup-ac'
    ),
    ...changeoverGridConnections,
    ...(gridInputConnected
      ? [
          connection(
            `${utility.id}-to-${converter.id}`,
            [utility.id, 'out'],
            [converter.id, 'grid'],
            'inverter-grid-ac',
            converterConductors
          ),
        ]
      : []),
    ...backupConnections,
  ])
  const changeoverNode = assembly.nodes.find((node) => node.id === changeover.id)
  const backupPort = changeoverNode?.ports.find((candidate) => candidate.id === 'backup')
  if (backupPort) backupPort.conductors = [...converterConductors]
  assembly.inverterGroups = [
    {
      id: `backup-group-${converter.id}`,
      shared: {
        brand: converter.conversionProps?.brand,
        model: converter.conversionProps?.model,
        capabilities,
      },
      use: { enabledForBackup: true, enabledForIslandMode: true },
      coordination: 'native-multiphase',
      unitNodeIds: [converter.id],
    },
  ]
  return assembly
}

/** Converts an existing direct converter graph into the switched four-port topology. */
export function upgradeDirectConverterToChangeoverAssembly(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  changeover: TrunkDevice,
  converter: TrunkDevice,
  backupDevicesOverride?: TrunkDevice[],
  changeoverGridDevicesOverride?: TrunkDevice[]
): OffGridSupplyAssembly {
  const directAssembly = findAssemblyForDirectConverter(project, converter.id)
  const upgraded = attachBackupConverterToAssembly(
    project,
    panelId,
    changeover,
    {
      ...converter,
      supplyPath: 'backup',
    },
    backupDevicesOverride,
    changeoverGridDevicesOverride
  )
  if (!directAssembly) return upgraded

  const dcConnections = directAssembly.connections.filter(
    ({ pathRole }) => pathRole === 'battery-dc' || pathRole === 'solar-dc' || pathRole === 'dc-bus'
  )
  const dcNodeIds = new Set(
    dcConnections
      .flatMap(({ endpoints }) => endpoints.map(({ nodeId }) => nodeId))
      .filter((nodeId) => nodeId !== converter.id)
  )
  upgraded.nodes.push(
    ...directAssembly.nodes
      .filter(({ id }) => dcNodeIds.has(id))
      .map((node) => structuredClone(node))
  )
  upgraded.connections.push(...dcConnections.map((candidate) => structuredClone(candidate)))

  const previousGridConnections = directAssembly.connections.filter(
    ({ pathRole }) => pathRole === 'inverter-grid-ac'
  )
  const previousConverterNode = directAssembly.nodes
    .filter(isInverterUnitNode)
    .find((node) => node.id === converter.id)
  const upgradedConverterNode = upgraded.nodes
    .filter(isInverterUnitNode)
    .find((node) => node.id === converter.id)
  if (previousConverterNode?.properties.gridInputConnected === false && upgradedConverterNode) {
    upgradedConverterNode.properties.gridInputConnected = false
    upgraded.connections = upgraded.connections.filter(
      ({ pathRole }) => pathRole !== 'inverter-grid-ac'
    )
  }
  const upgradedGridConnections = upgraded.connections.filter(
    ({ pathRole }) => pathRole === 'inverter-grid-ac'
  )
  upgradedGridConnections.forEach((candidate, index) => {
    const wireProperties = previousGridConnections[index]?.wireProperties
    if (!wireProperties) return
    candidate.wireProperties = {
      ...wireProperties,
      cable: { ...wireProperties.cable },
    }
  })
  return upgraded
}

/**
 * Removes an external changeover from a switched assembly while retaining the inverter,
 * its DC graph and the panel's dedicated backup handoff.
 */
export function downgradeChangeoverToDirectConverterAssembly(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  changeoverId: string,
  converter: TrunkDevice
): OffGridSupplyAssembly | undefined {
  const switched = findAssemblyForChangeover(project, changeoverId)
  if (!switched || converter.symbol !== 'inverter') return undefined

  const direct = buildDirectConverterSupplyAssembly(project, panelId, {
    ...converter,
    supplyPath: 'converter-branch',
    converterGridInputConnected:
      switched.nodes.filter(isInverterUnitNode).find((node) => node.id === converter.id)?.properties
        .gridInputConnected !== false,
  })
  direct.id = switched.id

  const dcConnections = switched.connections.filter(
    ({ pathRole }) => pathRole === 'battery-dc' || pathRole === 'solar-dc' || pathRole === 'dc-bus'
  )
  const dcNodeIds = new Set(
    dcConnections
      .flatMap(({ endpoints }) => endpoints.map(({ nodeId }) => nodeId))
      .filter((nodeId) => nodeId !== converter.id)
  )
  direct.nodes.push(
    ...switched.nodes
      .filter(({ id }) => dcNodeIds.has(id))
      .map<SupplyNode>(
        (node) =>
          ({
            ...node,
            properties: { ...node.properties },
            ports: node.ports.map((candidate) => ({
              ...candidate,
              conductors: [...candidate.conductors],
            })),
            mounting: node.mounting ? { enclosure: { ...node.mounting.enclosure } } : undefined,
          }) as SupplyNode
      )
  )
  direct.connections.push(
    ...dcConnections.map<SupplyConnection>((candidate) => ({
      ...candidate,
      endpoints: candidate.endpoints.map((endpoint) => ({
        ...endpoint,
      })) as SupplyConnection['endpoints'],
      conductors: [...candidate.conductors],
      wireProperties: candidate.wireProperties
        ? {
            ...candidate.wireProperties,
            cable: { ...candidate.wireProperties.cable },
          }
        : undefined,
      physicalRoute: candidate.physicalRoute?.map((enclosure) => ({ ...enclosure })),
    }))
  )

  const previousGridConnections = switched.connections.filter(
    ({ pathRole }) => pathRole === 'inverter-grid-ac'
  )
  direct.connections = preserveConnectionWireProperties(previousGridConnections, direct.connections)

  const previousHandoff = switched.loadHandoffs.find(
    ({ target }) =>
      (target.kind === 'panel-input' || target.kind === 'panel-bus-input') &&
      target.panelId === panelId
  )
  if (!enableDirectInverterPanelBackup(direct, panelId)) return undefined
  if (previousHandoff) {
    const generatedHandoff = direct.loadHandoffs.find(
      ({ target }) =>
        (target.kind === 'panel-input' || target.kind === 'panel-bus-input') &&
        target.panelId === panelId
    )
    if (generatedHandoff) generatedHandoff.target = { ...previousHandoff.target }
  }
  return direct
}

function protectionProperties(device: TrunkDevice): SupplyProtectionProperties {
  return {
    type: device.protectionType ?? 'MCB',
    ratingA: device.ratingA,
    curve: device.curve,
    sensitivityMa: device.sensitivityMa,
    residualCurrentType: device.residualCurrentType,
    breakingCapacityKa: device.breakingCapacityKa,
    breakingCapacityOption: device.breakingCapacityOption,
    surgeProtectionKind: device.surgeProtectionKind,
    polesConfig: device.polesConfig,
    poles: device.poles,
    notes: device.notes,
  }
}

function supplyAcBranchNode(device: TrunkDevice, conductors: AcPhase[]): SupplyNode {
  const ports = [
    port('source', 'serial-source-side', conductors, 'passive'),
    port('load', 'serial-load-side', conductors, 'passive'),
  ]
  if (device.type === 'protection' && getSymbolById(device.symbol)?.category !== 'switches') {
    return {
      id: device.id,
      deviceId: device.id,
      kind: 'protection',
      symbol: device.symbol,
      label: device.label,
      properties: protectionProperties(device),
      ports,
    }
  }
  return {
    id: device.id,
    deviceId: device.id,
    kind: 'ac-distribution',
    symbol: device.symbol,
    label: device.label,
    properties: {},
    ports,
  }
}

export function reconcileDirectConverterGridProtections(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): boolean {
  const installation = getElectricalInstallationFromProject(project)
  if (!installation) return false
  const rootDevices =
    ensureInstallationFeedTopology(
      installation,
      getElectricalPanelsFromProject(project)
    ).rootFeeds.find((feed) => feed.panelId === panelId)?.trunkDevices ?? []
  const converter = rootDevices.find((device) => device.supplyPath === 'converter-branch')
  if (!converter) return false
  const assembly = findAssemblyForDirectConverter(project, converter.id)
  const utility = assembly?.nodes.find((node) => node.kind === 'utility-source')
  if (!assembly || !utility) return false
  const converterConductors = getSupplyConverterAcConductors(
    converter,
    installation.nominalVoltage.system
  )
  const converterNode = assembly.nodes
    .filter(isInverterUnitNode)
    .find((node) => node.id === converter.id)
  const gridInputConnected =
    converter.converterGridInputConnected !== false &&
    converterNode?.properties.gridInputConnected !== false
  converterNode?.ports
    .filter((candidate) => candidate.domain === 'AC')
    .forEach((candidate) => {
      candidate.conductors = [...converterConductors]
    })
  const protections = rootDevices.filter(
    (device) =>
      gridInputConnected && device.type === 'protection' && device.supplyPath === 'converter-grid'
  )
  const previousProtectionIds = new Set(
    assembly.nodes
      .filter(
        (node) =>
          node.kind === 'protection' &&
          assembly.connections.some(
            (candidate) =>
              candidate.pathRole === 'inverter-grid-ac' &&
              candidate.endpoints.some((endpoint) => endpoint.nodeId === node.id)
          )
      )
      .map((node) => node.id)
  )
  assembly.nodes = [
    ...assembly.nodes.filter((node) => !previousProtectionIds.has(node.id)),
    ...protections.map<SupplyNode>((device) => ({
      id: device.id,
      deviceId: device.id,
      kind: 'protection',
      symbol: device.symbol,
      label: device.label,
      properties: protectionProperties(device),
      ports: [
        port('source', 'serial-source-side', converterConductors, 'passive'),
        port('load', 'serial-load-side', converterConductors, 'passive'),
      ],
    })),
  ]
  const previousGridConnections = assembly.connections
  assembly.connections = assembly.connections.filter(
    (candidate) => candidate.pathRole !== 'inverter-grid-ac'
  )
  let previous: [string, string] = [utility.id, 'out']
  protections.forEach((device, index) => {
    assembly.connections.push(
      connection(
        `${utility.id}-grid-protection-${index}`,
        previous,
        [device.id, 'source'],
        'inverter-grid-ac',
        converterConductors
      )
    )
    previous = [device.id, 'load']
  })
  if (gridInputConnected) {
    assembly.connections.push(
      connection(
        `${utility.id}-to-${converter.id}`,
        previous,
        [converter.id, 'grid'],
        'inverter-grid-ac',
        converterConductors
      )
    )
  }
  assembly.connections = preserveConnectionWireProperties(
    previousGridConnections,
    assembly.connections
  )
  reconcileInverterUnitMultiplier(project, converter)
  reconcileSupplyAssemblyAcConductorFlow(project, panelId)
  return true
}

/** Rebuilds both converter AC paths from their ordered, placeable supply devices. */
export function reconcileSupplyAssemblyBranchProtections(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): boolean {
  const installation = getElectricalInstallationFromProject(project)
  if (!installation) return false
  const topology = ensureInstallationFeedTopology(
    installation,
    getElectricalPanelsFromProject(project)
  )
  const rootDevices =
    topology.rootFeeds.find((feed) => feed.panelId === panelId)?.trunkDevices ?? []
  const changeover = rootDevices.find((device) => device.symbol === 'source_changeover')
  const converter = rootDevices.find((device) => device.supplyPath === 'backup')
  if (!changeover || !converter) return false
  const assembly = findAssemblyForChangeover(project, changeover.id)
  if (!assembly) return false
  const utility = assembly.nodes.find((node) => node.kind === 'utility-source')
  const converterNode = assembly.nodes
    .filter(isInverterUnitNode)
    .find((node) => node.id === converter.id)
  if (!utility || !converterNode) return false
  const gridInputConnected =
    converter.converterGridInputConnected !== false &&
    converterNode.properties.gridInputConnected !== false

  const gridDevices = rootDevices.filter(
    (device) => gridInputConnected && device.supplyPath === 'converter-grid'
  )
  const backupDevices = rootDevices.filter((device) => device.supplyPath === 'backup-output')
  const changeoverGridDevices = rootDevices.filter(
    (device) => device.supplyPath === 'changeover-grid'
  )
  const branchDeviceIds = new Set(
    [...gridDevices, ...backupDevices, ...changeoverGridDevices].map((device) => device.id)
  )
  const acBranchNodeIds = new Set(
    assembly.connections
      .filter(
        (candidate) =>
          candidate.pathRole === 'grid-ac' ||
          candidate.pathRole === 'inverter-grid-ac' ||
          candidate.pathRole === 'inverter-backup-ac'
      )
      .flatMap((candidate) => candidate.endpoints.map((endpoint) => endpoint.nodeId))
  )
  const fixedNodeIds = new Set([utility.id, converter.id, changeover.id])
  const previousBranchDeviceIds = new Set(
    [...acBranchNodeIds].filter((nodeId) => !fixedNodeIds.has(nodeId))
  )
  const conductors = acConductors(project)
  const converterConductors = getSupplyConverterAcConductors(
    converter,
    installation.nominalVoltage.system
  )
  const branchNodes = [
    ...gridDevices.map((device) => supplyAcBranchNode(device, converterConductors)),
    ...backupDevices.map((device) => supplyAcBranchNode(device, converterConductors)),
    ...changeoverGridDevices.map((device) => supplyAcBranchNode(device, conductors)),
  ]
  converterNode.ports
    .filter((candidate) => candidate.domain === 'AC')
    .forEach((candidate) => {
      candidate.conductors = [...converterConductors]
    })
  const changeoverNode = assembly.nodes.find((node) => node.id === changeover.id)
  const backupPort = changeoverNode?.ports.find((candidate) => candidate.id === 'backup')
  if (backupPort) backupPort.conductors = [...converterConductors]
  assembly.nodes = [
    ...assembly.nodes.filter(
      (node) => !previousBranchDeviceIds.has(node.id) && !branchDeviceIds.has(node.id)
    ),
    ...branchNodes,
  ]
  const previousBranchConnections = assembly.connections
  assembly.connections = assembly.connections.filter(
    (candidate) =>
      candidate.pathRole !== 'grid-ac' &&
      candidate.pathRole !== 'inverter-grid-ac' &&
      candidate.pathRole !== 'inverter-backup-ac'
  )

  const appendSerialPath = (
    pathId: string,
    first: [string, string],
    devices: TrunkDevice[],
    last: [string, string],
    pathRole: 'grid-ac' | 'inverter-grid-ac' | 'inverter-backup-ac',
    pathConductors: AcPhase[]
  ) => {
    let previous = first
    devices.forEach((device, index) => {
      assembly.connections.push(
        connection(
          `${pathId}-${index}-in`,
          previous,
          [device.id, 'source'],
          pathRole,
          pathConductors
        )
      )
      previous = [device.id, 'load']
    })
    assembly.connections.push(connection(`${pathId}-out`, previous, last, pathRole, pathConductors))
  }
  appendSerialPath(
    `${utility.id}-to-${changeover.id}-grid`,
    [utility.id, 'out'],
    changeoverGridDevices,
    [changeover.id, 'grid'],
    'grid-ac',
    conductors
  )
  if (gridInputConnected) {
    appendSerialPath(
      `${utility.id}-to-${converter.id}`,
      [utility.id, 'out'],
      gridDevices,
      [converter.id, 'grid'],
      'inverter-grid-ac',
      converterConductors
    )
  }
  appendSerialPath(
    `${converter.id}-to-${changeover.id}`,
    [converter.id, 'backup'],
    backupDevices,
    [changeover.id, 'backup'],
    'inverter-backup-ac',
    converterConductors
  )
  assembly.connections = preserveConnectionWireProperties(
    previousBranchConnections,
    assembly.connections
  )
  reconcileInverterUnitMultiplier(project, converter)
  reconcileSupplyAssemblyAcConductorFlow(project, panelId)
  return true
}

/**
 * Repairs the early prototype state where a changeover assembly could be stored on
 * the shared/supply-panel side. With one main panel it can be moved losslessly to that
 * panel's root feed. With multiple roots the ownership is ambiguous, so the records
 * are preserved for validation or manual repair rather than guessed or deleted.
 */
export function healSourceChangeoverFeedScope(project: ProjectWithOptionalV2Electrical): boolean {
  const installation = getElectricalInstallationFromProject(project)
  const panels = getElectricalPanelsFromProject(project)
  if (!installation) return false
  const topology = ensureInstallationFeedTopology(installation, panels)
  const sharedDevices = topology.sharedFeed.trunkDevices ?? []
  const invalidDevices = sharedDevices.filter(isAssemblyOnlySupplyDevice)
  if (invalidDevices.length === 0) return false

  const roots = collectRootPanels(panels)
  if (roots.length !== 1) {
    logger.warn(
      '[SUPPLY-PERSIST] preserving ambiguous shared changeover topology during hydration',
      {
        rootPanelIds: roots.map((panel) => panel.id),
        deviceIds: invalidDevices.map((device) => device.id),
      }
    )
    return false
  }

  const invalidIds = new Set(invalidDevices.map((device) => device.id))
  const retainedShared = sharedDevices.filter((device) => !invalidIds.has(device.id))
  retainedShared.forEach((device, index) => {
    device.trunkPosition = index
  })
  topology.sharedFeed.trunkDevices = retainedShared
  installation.mainSupply.supplyTrunkDevices = [...retainedShared]

  const rootFeed = topology.rootFeeds.find((feed) => feed.panelId === roots[0]!.id)
  if (rootFeed) {
    const existingIds = new Set((rootFeed.trunkDevices ?? []).map((device) => device.id))
    rootFeed.trunkDevices = [
      ...(rootFeed.trunkDevices ?? []),
      ...invalidDevices.filter((device) => !existingIds.has(device.id)),
    ]
    rootFeed.trunkDevices.forEach((device, index) => {
      device.trunkPosition = index
    })
  }
  return true
}
