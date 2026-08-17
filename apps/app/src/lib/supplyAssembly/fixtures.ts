import type { OffGridSupplyAssembly, SupplyConnection, SupplyNode, SupplyPort } from './types'

function createPort(
  id: string,
  role: SupplyPort['role'],
  domain: SupplyPort['domain'],
  conductors: SupplyPort['conductors'],
  behavior: SupplyPort['behavior'],
  maxConnections: SupplyPort['maxConnections'] = 1
): SupplyPort {
  return { id, role, domain, conductors, behavior, maxConnections }
}

function createConnection(
  id: string,
  first: [string, string],
  second: [string, string],
  pathRole: SupplyConnection['pathRole'],
  domain: SupplyConnection['domain'],
  conductors: SupplyConnection['conductors']
): SupplyConnection {
  return {
    id,
    endpoints: [
      { nodeId: first[0], portId: first[1] },
      { nodeId: second[0], portId: second[1] },
    ],
    pathRole,
    domain,
    conductors,
  }
}

/**
 * Development/test fixture for the first supported V1 topology:
 * grid distribution + single inverter + battery + external manual changeover.
 */
export function createV1SinglePhaseSupplyAssemblyFixture(): OffGridSupplyAssembly {
  return {
    id: 'assembly-main',
    graphVersion: 1,
    presetIntent: 'single_phase_installation',
    incomingAttachment: { kind: 'root-feed', rootFeedId: 'root-main' },
    loadHandoffs: [
      {
        id: 'handoff-record-main',
        handoffNodeId: 'handoff-main',
        target: { kind: 'root-feed', rootFeedId: 'root-main' },
        conductors: ['L1', 'N'],
      },
    ],
    nodes: [
      {
        id: 'utility',
        kind: 'utility-source',
        symbol: 'mains',
        label: 'Grid',
        properties: { origin: 'grid' },
        ports: [createPort('out', 'utility-ac', 'AC', ['L1', 'N'], 'source')],
      },
      {
        id: 'grid-distribution',
        kind: 'ac-distribution',
        symbol: 'junction_box',
        label: 'Grid distribution',
        properties: { ratedCurrentA: 63 },
        ports: [
          createPort('in', 'grid-distribution-ac', 'AC', ['L1', 'N'], 'sink'),
          createPort('out', 'grid-distribution-ac', 'AC', ['L1', 'N'], 'source', 'many'),
        ],
      },
      {
        id: 'battery',
        kind: 'battery',
        symbol: 'battery',
        label: 'Battery 48 V',
        properties: { voltageV: 48, capacityKWh: 10 },
        ports: [createPort('dc', 'battery-dc', 'DC', ['DC+', 'DC-'], 'source')],
      },
      {
        id: 'inverter-l1',
        kind: 'inverter-unit',
        symbol: 'inverter',
        label: 'Inverter L1',
        properties: { serialNumber: 'INV-L1' },
        ports: [
          createPort('grid', 'inverter-grid-ac', 'AC', ['L1', 'N'], 'bidirectional'),
          createPort('backup', 'inverter-backup-ac', 'AC', ['L1', 'N'], 'source'),
          createPort('dc', 'battery-dc', 'DC', ['DC+', 'DC-'], 'sink'),
        ],
      },
      {
        id: 'changeover-l1',
        kind: 'changeover-switch',
        symbol: 'source_changeover',
        label: 'Manual changeover',
        properties: {
          switchingMode: 'manual',
          transition: 'break-before-make',
          poles: 2,
          switchedConductors: ['L1', 'N'],
          neutralTreatment: 'switched',
        },
        ports: [
          createPort('grid', 'source-grid-ac', 'AC', ['L1', 'N'], 'sink'),
          createPort('backup', 'source-backup-ac', 'AC', ['L1', 'N'], 'sink'),
          createPort('load', 'load-ac', 'AC', ['L1', 'N'], 'source'),
        ],
      },
      {
        id: 'handoff-main',
        kind: 'panel-handoff',
        symbol: 'panel_distribution',
        label: 'Main panel',
        properties: {},
        ports: [createPort('in', 'panel-handoff', 'AC', ['L1', 'N'], 'sink')],
      },
    ],
    connections: [
      createConnection(
        'grid-entry',
        ['utility', 'out'],
        ['grid-distribution', 'in'],
        'grid-ac',
        'AC',
        ['L1', 'N']
      ),
      createConnection(
        'grid-to-inverter',
        ['grid-distribution', 'out'],
        ['inverter-l1', 'grid'],
        'inverter-grid-ac',
        'AC',
        ['L1', 'N']
      ),
      createConnection(
        'grid-to-changeover',
        ['grid-distribution', 'out'],
        ['changeover-l1', 'grid'],
        'grid-ac',
        'AC',
        ['L1', 'N']
      ),
      createConnection(
        'battery-to-inverter',
        ['battery', 'dc'],
        ['inverter-l1', 'dc'],
        'battery-dc',
        'DC',
        ['DC+', 'DC-']
      ),
      createConnection(
        'inverter-to-changeover',
        ['inverter-l1', 'backup'],
        ['changeover-l1', 'backup'],
        'inverter-backup-ac',
        'AC',
        ['L1', 'N']
      ),
      createConnection(
        'changeover-to-handoff',
        ['changeover-l1', 'load'],
        ['handoff-main', 'in'],
        'load-ac',
        'AC',
        ['L1', 'N']
      ),
    ],
    inverterGroups: [
      {
        id: 'inverter-group-main',
        shared: {
          brand: 'Fixture',
          model: 'Single phase',
          capabilities: {
            supportsBackupSupply: true,
            supportsIslandMode: true,
            hasBidirectionalGridPort: true,
            hasDedicatedBackupAcOutput: true,
            hasBatteryDcPort: true,
            requiresExternalChangeover: true,
            supportedNeutralTreatments: ['switched'],
            supportedVoltageSystems: ['1N~'],
            evidence: { source: 'manual' },
          },
        },
        use: { enabledForBackup: true, enabledForIslandMode: true },
        coordination: 'independent-per-phase',
        unitNodeIds: ['inverter-l1'],
      },
    ],
  }
}

const THREE_PHASE_WITH_NEUTRAL = ['L1', 'L2', 'L3', 'N'] as const

function nodeById(assembly: OffGridSupplyAssembly, nodeId: string): SupplyNode {
  const node = assembly.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`Fixture is missing node ${nodeId}.`)
  return node
}

function portById(assembly: OffGridSupplyAssembly, nodeId: string, portId: string): SupplyPort {
  const port = nodeById(assembly, nodeId).ports.find((candidate) => candidate.id === portId)
  if (!port) throw new Error(`Fixture is missing port ${nodeId}:${portId}.`)
  return port
}

function connectionById(assembly: OffGridSupplyAssembly, connectionId: string): SupplyConnection {
  const connection = assembly.connections.find((candidate) => candidate.id === connectionId)
  if (!connection) throw new Error(`Fixture is missing connection ${connectionId}.`)
  return connection
}

function renameNode(
  assembly: OffGridSupplyAssembly,
  previousNodeId: string,
  nextNodeId: string
): void {
  nodeById(assembly, previousNodeId).id = nextNodeId
  for (const connection of assembly.connections) {
    for (const endpoint of connection.endpoints) {
      if (endpoint.nodeId === previousNodeId) endpoint.nodeId = nextNodeId
    }
  }
  for (const handoff of assembly.loadHandoffs) {
    if (handoff.handoffNodeId === previousNodeId) handoff.handoffNodeId = nextNodeId
  }
  for (const group of assembly.inverterGroups) {
    group.unitNodeIds = group.unitNodeIds.map((nodeId) =>
      nodeId === previousNodeId ? nextNodeId : nodeId
    )
  }
}

function applyThreePhaseGridEnvelope(assembly: OffGridSupplyAssembly): void {
  portById(assembly, 'utility', 'out').conductors = [...THREE_PHASE_WITH_NEUTRAL]
  portById(assembly, 'grid-distribution', 'in').conductors = [...THREE_PHASE_WITH_NEUTRAL]
  portById(assembly, 'grid-distribution', 'out').conductors = [...THREE_PHASE_WITH_NEUTRAL]
  portById(assembly, 'handoff-main', 'in').conductors = [...THREE_PHASE_WITH_NEUTRAL]
  assembly.loadHandoffs[0]!.conductors = [...THREE_PHASE_WITH_NEUTRAL]

  connectionById(assembly, 'grid-entry').conductors = [...THREE_PHASE_WITH_NEUTRAL]
  connectionById(assembly, 'grid-to-changeover').conductors = [...THREE_PHASE_WITH_NEUTRAL]
  connectionById(assembly, 'changeover-to-handoff').conductors = [...THREE_PHASE_WITH_NEUTRAL]

  const changeover = nodeById(assembly, 'changeover-l1')
  if (changeover.kind !== 'changeover-switch') throw new Error('Fixture changeover has wrong kind.')
  changeover.label = '4P manual changeover'
  changeover.properties.poles = 4
  changeover.properties.switchedConductors = [...THREE_PHASE_WITH_NEUTRAL]
  portById(assembly, changeover.id, 'grid').conductors = [...THREE_PHASE_WITH_NEUTRAL]
  portById(assembly, changeover.id, 'load').conductors = [...THREE_PHASE_WITH_NEUTRAL]

  const group = assembly.inverterGroups[0]!
  group.shared.capabilities.supportedVoltageSystems = ['3N~']
}

/** Three-phase installation where backup energizes only L1 through a coordinated 4P switch. */
export function createV1SinglePhaseBackupOnThreePhaseFixture(): OffGridSupplyAssembly {
  const assembly = createV1SinglePhaseSupplyAssemblyFixture()
  assembly.id = 'assembly-single-phase-backup-on-three-phase'
  assembly.presetIntent = 'single_phase_backup_on_three_phase'
  applyThreePhaseGridEnvelope(assembly)
  assembly.inverterGroups[0]!.shared.model = 'Single-phase unit on three-phase supply'
  return assembly
}

/** One native three-phase inverter feeding all phases through one coordinated 4P switch. */
export function createV1NativeThreePhaseSupplyAssemblyFixture(): OffGridSupplyAssembly {
  const assembly = createV1SinglePhaseBackupOnThreePhaseFixture()
  assembly.id = 'assembly-native-three-phase'
  assembly.presetIntent = 'native_multi_phase_hybrid'
  renameNode(assembly, 'inverter-l1', 'inverter-3p')
  const inverter = nodeById(assembly, 'inverter-3p')
  if (inverter.kind !== 'inverter-unit') throw new Error('Fixture inverter has wrong kind.')
  inverter.label = 'Three-phase inverter'
  portById(assembly, inverter.id, 'grid').conductors = [...THREE_PHASE_WITH_NEUTRAL]
  portById(assembly, inverter.id, 'backup').conductors = [...THREE_PHASE_WITH_NEUTRAL]
  portById(assembly, 'changeover-l1', 'backup').conductors = [...THREE_PHASE_WITH_NEUTRAL]
  connectionById(assembly, 'grid-to-inverter').conductors = [...THREE_PHASE_WITH_NEUTRAL]
  connectionById(assembly, 'inverter-to-changeover').conductors = [...THREE_PHASE_WITH_NEUTRAL]
  const group = assembly.inverterGroups[0]!
  group.shared.model = 'Native three-phase hybrid'
  group.coordination = 'native-multiphase'
  return assembly
}

function createSinglePhaseInverterNode(
  phase: 'L1' | 'L2' | 'L3'
): Extract<SupplyNode, { kind: 'inverter-unit' }> {
  return {
    id: `inverter-${phase.toLowerCase()}`,
    kind: 'inverter-unit',
    symbol: 'inverter',
    label: `Inverter ${phase}`,
    properties: { serialNumber: `INV-${phase}` },
    ports: [
      createPort('grid', 'inverter-grid-ac', 'AC', [phase, 'N'], 'bidirectional'),
      createPort('backup', 'inverter-backup-ac', 'AC', [phase, 'N'], 'source'),
      createPort('dc', 'battery-dc', 'DC', ['DC+', 'DC-'], 'sink'),
    ],
  }
}

/** Three independent single-phase units with a shared battery DC distribution node. */
export function createV1ThreeInverterStackSupplyAssemblyFixture(): OffGridSupplyAssembly {
  const assembly = createV1SinglePhaseBackupOnThreePhaseFixture()
  assembly.id = 'assembly-three-inverter-stack'
  assembly.presetIntent = 'three_phase_inverter_set'

  const inverterL1 = nodeById(assembly, 'inverter-l1')
  if (inverterL1.kind !== 'inverter-unit') throw new Error('Fixture inverter has wrong kind.')
  const inverterL2 = createSinglePhaseInverterNode('L2')
  const inverterL3 = createSinglePhaseInverterNode('L3')
  assembly.nodes.push(inverterL2, inverterL3, {
    id: 'battery-dc-junction',
    kind: 'dc-bus',
    symbol: 'junction_box',
    label: 'Battery DC junction',
    properties: { ratedVoltageV: 48, ratedCurrentA: 300 },
    ports: [
      createPort('battery-in', 'dc-bus', 'DC', ['DC+', 'DC-'], 'sink'),
      createPort('inverter-out', 'dc-bus', 'DC', ['DC+', 'DC-'], 'source', 'many'),
    ],
  })

  portById(assembly, 'changeover-l1', 'backup').conductors = [...THREE_PHASE_WITH_NEUTRAL]
  portById(assembly, 'changeover-l1', 'backup').maxConnections = 'many'
  assembly.connections = assembly.connections.filter(
    (connection) => connection.id !== 'battery-to-inverter'
  )
  assembly.connections.push(
    createConnection(
      'battery-to-dc-junction',
      ['battery', 'dc'],
      ['battery-dc-junction', 'battery-in'],
      'battery-dc',
      'DC',
      ['DC+', 'DC-']
    ),
    createConnection(
      'dc-junction-to-inverter-l1',
      ['battery-dc-junction', 'inverter-out'],
      ['inverter-l1', 'dc'],
      'dc-bus',
      'DC',
      ['DC+', 'DC-']
    )
  )

  for (const phase of ['L2', 'L3'] as const) {
    const inverterId = `inverter-${phase.toLowerCase()}`
    assembly.connections.push(
      createConnection(
        `grid-to-inverter-${phase.toLowerCase()}`,
        ['grid-distribution', 'out'],
        [inverterId, 'grid'],
        'inverter-grid-ac',
        'AC',
        [phase, 'N']
      ),
      createConnection(
        `inverter-${phase.toLowerCase()}-to-changeover`,
        [inverterId, 'backup'],
        ['changeover-l1', 'backup'],
        'inverter-backup-ac',
        'AC',
        [phase, 'N']
      ),
      createConnection(
        `dc-junction-to-inverter-${phase.toLowerCase()}`,
        ['battery-dc-junction', 'inverter-out'],
        [inverterId, 'dc'],
        'dc-bus',
        'DC',
        ['DC+', 'DC-']
      )
    )
  }

  const group = assembly.inverterGroups[0]!
  group.shared.model = 'Three-unit phase stack'
  group.coordination = 'independent-per-phase'
  group.unitNodeIds = ['inverter-l1', 'inverter-l2', 'inverter-l3']
  return assembly
}

/** Single-phase grid where a three-unit stack energizes all phases in backup mode. */
export function createV1ThreePhaseBackupOnSinglePhaseGridFixture(): OffGridSupplyAssembly {
  const assembly = createV1ThreeInverterStackSupplyAssemblyFixture()
  assembly.id = 'assembly-three-phase-backup-on-single-phase-grid'
  assembly.presetIntent = 'custom_phase_mapping'

  portById(assembly, 'utility', 'out').conductors = ['L1', 'N']
  portById(assembly, 'grid-distribution', 'in').conductors = ['L1', 'N']
  portById(assembly, 'grid-distribution', 'out').conductors = ['L1', 'N']
  portById(assembly, 'changeover-l1', 'grid').conductors = ['L1', 'N']
  connectionById(assembly, 'grid-entry').conductors = ['L1', 'N']
  connectionById(assembly, 'grid-to-changeover').conductors = ['L1', 'N']
  connectionById(assembly, 'grid-to-inverter').conductors = ['L1', 'N']
  connectionById(assembly, 'grid-to-inverter-l2').conductors = []
  connectionById(assembly, 'grid-to-inverter-l3').conductors = []

  return assembly
}

/** Native three-phase hybrid topology with a curated integrated solar DC input. */
export function createV1NativeThreePhaseSolarSupplyAssemblyFixture(): OffGridSupplyAssembly {
  const assembly = createV1NativeThreePhaseSupplyAssemblyFixture()
  assembly.id = 'assembly-native-three-phase-solar'
  assembly.nodes.push({
    id: 'solar-array',
    kind: 'solar-source',
    symbol: 'solar_panel',
    label: 'PV array',
    properties: { wattageW: 6000, voltageV: 400 },
    ports: [createPort('dc', 'solar-dc', 'DC', ['DC+', 'DC-'], 'source')],
  })
  const inverter = nodeById(assembly, 'inverter-3p')
  portById(assembly, inverter.id, 'dc').maxConnections = 'many'
  assembly.connections.push(
    createConnection(
      'solar-to-inverter',
      ['solar-array', 'dc'],
      ['inverter-3p', 'dc'],
      'solar-dc',
      'DC',
      ['DC+', 'DC-']
    )
  )
  assembly.inverterGroups[0]!.shared.capabilities.hasIntegratedSolarDcInput = true
  return assembly
}
