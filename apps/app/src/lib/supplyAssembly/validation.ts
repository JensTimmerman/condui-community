import type {
  ChangeoverSwitchProperties,
  OffGridSupplyAssembly,
  SupplyConductor,
  SupplyConnectionPathRole,
  SupplyElectricalDomain,
  SupplyNode,
  SupplyPort,
} from './types'
import { SUPPLY_ASSEMBLY_GRAPH_VERSION } from './types'

export type SupplyAssemblyValidationSeverity = 'error' | 'warning' | 'unsupported'

export type SupplyAssemblyValidationCode =
  | 'unsupported-graph-version'
  | 'unsupported-node-kind'
  | 'unsupported-inverter-coordination'
  | 'duplicate-node-id'
  | 'duplicate-port-id'
  | 'duplicate-connection-id'
  | 'duplicate-handoff-id'
  | 'invalid-port-conductors'
  | 'invalid-connection-conductors'
  | 'invalid-path-role-domain'
  | 'dangling-connection-node'
  | 'dangling-connection-port'
  | 'self-connected-port'
  | 'port-cardinality-exceeded'
  | 'missing-changeover'
  | 'invalid-changeover-port-shape'
  | 'invalid-changeover-conductors'
  | 'invalid-changeover-properties'
  | 'invalid-changeover-neutral'
  | 'invalid-inverter-group-count'
  | 'duplicate-inverter-group-id'
  | 'dangling-inverter-unit'
  | 'duplicate-inverter-membership'
  | 'ungrouped-inverter-unit'
  | 'duplicate-inverter-phase'
  | 'dangling-handoff-node'
  | 'invalid-handoff-node-kind'
  | 'invalid-handoff-conductors'

export interface SupplyAssemblyValidationIssue {
  code: SupplyAssemblyValidationCode
  severity: SupplyAssemblyValidationSeverity
  message: string
  entityId?: string
}

export interface SupplyAssemblyValidationResult {
  status: 'valid' | 'invalid' | 'unsupported'
  issues: SupplyAssemblyValidationIssue[]
}

const AC_CONDUCTORS = new Set<SupplyConductor>(['L1', 'L2', 'L3', 'N'])
const DC_CONDUCTORS = new Set<SupplyConductor>(['DC+', 'DC-'])
const PE_CONDUCTORS = new Set<SupplyConductor>(['PE'])

const PATH_ROLE_DOMAINS: Record<SupplyConnectionPathRole, SupplyElectricalDomain> = {
  'grid-ac': 'AC',
  'grid-only-bypass-ac': 'AC',
  'inverter-grid-ac': 'AC',
  'inverter-backup-ac': 'AC',
  'generator-backup-ac': 'AC',
  'battery-dc': 'DC',
  'dc-bus': 'DC',
  'solar-dc': 'DC',
  'protective-earth': 'PE',
  'load-ac': 'AC',
}

function pushIssue(
  issues: SupplyAssemblyValidationIssue[],
  code: SupplyAssemblyValidationCode,
  severity: SupplyAssemblyValidationSeverity,
  message: string,
  entityId?: string
): void {
  issues.push({ code, severity, message, ...(entityId ? { entityId } : {}) })
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length
}

function conductorsForDomain(domain: SupplyElectricalDomain): ReadonlySet<SupplyConductor> {
  if (domain === 'AC') return AC_CONDUCTORS
  if (domain === 'DC') return DC_CONDUCTORS
  return PE_CONDUCTORS
}

function hasValidDomainConductors(
  domain: SupplyElectricalDomain,
  conductors: readonly SupplyConductor[]
): boolean {
  if (conductors.length === 0 || hasDuplicates(conductors)) return false
  const allowed = conductorsForDomain(domain)
  if (!conductors.every((conductor) => allowed.has(conductor))) return false
  return domain !== 'PE' || (conductors.length === 1 && conductors[0] === 'PE')
}

function portKey(nodeId: string, portId: string): string {
  return `${nodeId}:${portId}`
}

function validateNodeAndPortIdentity(
  assembly: OffGridSupplyAssembly,
  issues: SupplyAssemblyValidationIssue[]
): Map<string, SupplyNode> {
  const nodes = new Map<string, SupplyNode>()
  for (const node of assembly.nodes) {
    if (nodes.has(node.id)) {
      pushIssue(
        issues,
        'duplicate-node-id',
        'error',
        `Duplicate supply node id: ${node.id}`,
        node.id
      )
      continue
    }
    nodes.set(node.id, node)

    const portIds = new Set<string>()
    for (const port of node.ports) {
      if (portIds.has(port.id)) {
        pushIssue(
          issues,
          'duplicate-port-id',
          'error',
          `Duplicate port id ${port.id} on supply node ${node.id}.`,
          node.id
        )
      }
      portIds.add(port.id)
      if (!hasValidDomainConductors(port.domain, port.conductors)) {
        pushIssue(
          issues,
          'invalid-port-conductors',
          'error',
          `Port ${node.id}:${port.id} has conductors incompatible with domain ${port.domain}.`,
          node.id
        )
      }
    }
  }
  return nodes
}

function findPort(node: SupplyNode | undefined, portId: string): SupplyPort | undefined {
  return node?.ports.find((port) => port.id === portId)
}

function validateConnections(
  assembly: OffGridSupplyAssembly,
  nodes: ReadonlyMap<string, SupplyNode>,
  issues: SupplyAssemblyValidationIssue[]
): void {
  const connectionIds = new Set<string>()
  const connectionCountByPort = new Map<string, number>()

  for (const connection of assembly.connections) {
    const isInactiveAcConnection =
      connection.domain === 'AC' && connection.conductors.length === 0
    if (connectionIds.has(connection.id)) {
      pushIssue(
        issues,
        'duplicate-connection-id',
        'error',
        `Duplicate supply connection id: ${connection.id}`,
        connection.id
      )
    }
    connectionIds.add(connection.id)

    if (PATH_ROLE_DOMAINS[connection.pathRole] !== connection.domain) {
      pushIssue(
        issues,
        'invalid-path-role-domain',
        'error',
        `Connection ${connection.id} uses ${connection.pathRole} with domain ${connection.domain}.`,
        connection.id
      )
    }
    if (
      !isInactiveAcConnection &&
      !hasValidDomainConductors(connection.domain, connection.conductors)
    ) {
      pushIssue(
        issues,
        'invalid-connection-conductors',
        'error',
        `Connection ${connection.id} has conductors incompatible with domain ${connection.domain}.`,
        connection.id
      )
    }

    const [firstRef, secondRef] = connection.endpoints
    if (firstRef.nodeId === secondRef.nodeId && firstRef.portId === secondRef.portId) {
      pushIssue(
        issues,
        'self-connected-port',
        'error',
        `Connection ${connection.id} connects a port to itself.`,
        connection.id
      )
    }

    for (const ref of connection.endpoints) {
      const node = nodes.get(ref.nodeId)
      if (!node) {
        pushIssue(
          issues,
          'dangling-connection-node',
          'error',
          `Connection ${connection.id} references missing node ${ref.nodeId}.`,
          connection.id
        )
        continue
      }
      const port = findPort(node, ref.portId)
      if (!port) {
        pushIssue(
          issues,
          'dangling-connection-port',
          'error',
          `Connection ${connection.id} references missing port ${ref.nodeId}:${ref.portId}.`,
          connection.id
        )
        continue
      }

      const key = portKey(ref.nodeId, ref.portId)
      connectionCountByPort.set(key, (connectionCountByPort.get(key) ?? 0) + 1)
      const portSupportsConnection =
        port.domain === connection.domain &&
        (isInactiveAcConnection ||
          connection.conductors.every((conductor) => port.conductors.includes(conductor)))
      if (!portSupportsConnection) {
        pushIssue(
          issues,
          'invalid-connection-conductors',
          'error',
          `Connection ${connection.id} is incompatible with port ${key}.`,
          connection.id
        )
      }
    }
  }

  for (const node of assembly.nodes) {
    for (const port of node.ports) {
      if (port.maxConnections === 'many') continue
      const count = connectionCountByPort.get(portKey(node.id, port.id)) ?? 0
      if (count > port.maxConnections) {
        pushIssue(
          issues,
          'port-cardinality-exceeded',
          'error',
          `Port ${node.id}:${port.id} allows ${port.maxConnections} connection(s), found ${count}.`,
          node.id
        )
      }
    }
  }
}

function validateChangeover(
  node: Extract<SupplyNode, { kind: 'changeover-switch' }>,
  issues: SupplyAssemblyValidationIssue[]
): void {
  const countRole = (role: SupplyPort['role']) =>
    node.ports.filter((port) => port.role === role).length
  if (
    countRole('source-grid-ac') !== 1 ||
    countRole('source-backup-ac') !== 1 ||
    countRole('load-ac') !== 1
  ) {
    pushIssue(
      issues,
      'invalid-changeover-port-shape',
      'error',
      `Changeover ${node.id} must have one grid input, one backup input, and one load output.`,
      node.id
    )
  }

  const gridPort = node.ports.find((port) => port.role === 'source-grid-ac')
  const backupPort = node.ports.find((port) => port.role === 'source-backup-ac')
  const loadPort = node.ports.find((port) => port.role === 'load-ac')

  const properties: ChangeoverSwitchProperties = node.properties
  if (properties.switchingMode !== 'manual' || properties.transition !== 'break-before-make') {
    pushIssue(
      issues,
      'invalid-changeover-properties',
      'unsupported',
      `Changeover ${node.id} is outside the V1 manual break-before-make boundary.`,
      node.id
    )
  }
  if (
    properties.switchedConductors.length !== properties.poles ||
    hasDuplicates(properties.switchedConductors) ||
    properties.switchedConductors.includes('PE')
  ) {
    pushIssue(
      issues,
      'invalid-changeover-properties',
      'error',
      `Changeover ${node.id} has an invalid pole/conductor configuration.`,
      node.id
    )
  }

  const switchedConductors = new Set<SupplyConductor>(properties.switchedConductors)
  const loadCoversEveryPole = properties.switchedConductors.every((conductor) =>
    loadPort?.conductors.includes(conductor)
  )
  const sourcePortsUseOnlySwitchedPoles = [gridPort, backupPort].every(
    (port) => port && port.conductors.every((conductor) => switchedConductors.has(conductor))
  )
  const sourcePortsHaveLivePhase = [gridPort, backupPort].every((port) =>
    port?.conductors.some(
      (conductor) => conductor === 'L1' || conductor === 'L2' || conductor === 'L3'
    )
  )
  if (!loadCoversEveryPole || !sourcePortsUseOnlySwitchedPoles || !sourcePortsHaveLivePhase) {
    pushIssue(
      issues,
      'invalid-changeover-conductors',
      'error',
      `Changeover ${node.id} ports do not match its switched conductor set.`,
      node.id
    )
  }

  const switchesNeutral = properties.switchedConductors.includes('N')
  if (
    (properties.neutralTreatment === 'switched' && !switchesNeutral) ||
    (properties.neutralTreatment !== 'switched' && switchesNeutral)
  ) {
    pushIssue(
      issues,
      'invalid-changeover-neutral',
      'error',
      `Changeover ${node.id} neutral treatment disagrees with its switched conductors.`,
      node.id
    )
  }
}

function validateV1Equipment(
  assembly: OffGridSupplyAssembly,
  nodes: ReadonlyMap<string, SupplyNode>,
  issues: SupplyAssemblyValidationIssue[]
): void {
  const changeovers = assembly.nodes.filter(
    (node): node is Extract<SupplyNode, { kind: 'changeover-switch' }> =>
      node.kind === 'changeover-switch'
  )
  if (changeovers.length === 0 && assembly.presetIntent !== 'grid_connected_storage_branch') {
    pushIssue(
      issues,
      'missing-changeover',
      'error',
      'A V1 supply assembly requires at least one changeover switch.',
      assembly.id
    )
  }
  changeovers.forEach((node) => validateChangeover(node, issues))

  for (const node of assembly.nodes) {
    if (node.kind === 'generator-source' || node.kind === 'integrated-transfer') {
      pushIssue(
        issues,
        'unsupported-node-kind',
        'unsupported',
        `Supply node ${node.id} (${node.kind}) is reserved for a future graph consumer.`,
        node.id
      )
    }
  }

  const groupIds = assembly.inverterGroups.map((group) => group.id)
  if (hasDuplicates(groupIds)) {
    pushIssue(
      issues,
      'duplicate-inverter-group-id',
      'error',
      'Inverter group ids must be unique within an assembly.',
      assembly.id
    )
  }
  if (assembly.inverterGroups.length !== 1) {
    pushIssue(
      issues,
      'invalid-inverter-group-count',
      'error',
      `V1 requires exactly one inverter group, found ${assembly.inverterGroups.length}.`,
      assembly.id
    )
  }

  const membership = new Map<string, number>()
  for (const group of assembly.inverterGroups) {
    if (group.coordination === 'parallel-cluster') {
      pushIssue(
        issues,
        'unsupported-inverter-coordination',
        'unsupported',
        `Inverter group ${group.id} uses reserved parallel-cluster coordination.`,
        group.id
      )
    }
    for (const unitNodeId of group.unitNodeIds) {
      membership.set(unitNodeId, (membership.get(unitNodeId) ?? 0) + 1)
      if (nodes.get(unitNodeId)?.kind !== 'inverter-unit') {
        pushIssue(
          issues,
          'dangling-inverter-unit',
          'error',
          `Inverter group ${group.id} references missing or incompatible node ${unitNodeId}.`,
          group.id
        )
      }
    }
  }

  for (const [unitNodeId, count] of membership) {
    if (count > 1) {
      pushIssue(
        issues,
        'duplicate-inverter-membership',
        'error',
        `Inverter unit ${unitNodeId} belongs to more than one group.`,
        unitNodeId
      )
    }
  }
  for (const node of assembly.nodes) {
    if (node.kind === 'inverter-unit' && !membership.has(node.id)) {
      pushIssue(
        issues,
        'ungrouped-inverter-unit',
        'error',
        `Inverter unit ${node.id} does not belong to an inverter group.`,
        node.id
      )
    }
  }

  for (const group of assembly.inverterGroups) {
    if (group.coordination !== 'independent-per-phase') continue
    const seenLivePhases = new Set<SupplyConductor>()
    for (const unitNodeId of group.unitNodeIds) {
      const unit = nodes.get(unitNodeId)
      if (unit?.kind !== 'inverter-unit') continue
      const backupPort = unit.ports.find((port) => port.role === 'inverter-backup-ac')
      for (const conductor of backupPort?.conductors ?? []) {
        if (conductor !== 'L1' && conductor !== 'L2' && conductor !== 'L3') continue
        if (seenLivePhases.has(conductor)) {
          pushIssue(
            issues,
            'duplicate-inverter-phase',
            'error',
            `Independent inverter group ${group.id} assigns ${conductor} more than once.`,
            group.id
          )
        }
        seenLivePhases.add(conductor)
      }
    }
  }
}

function validateHandoffs(
  assembly: OffGridSupplyAssembly,
  nodes: ReadonlyMap<string, SupplyNode>,
  issues: SupplyAssemblyValidationIssue[]
): void {
  const handoffIds = new Set<string>()
  for (const handoff of assembly.loadHandoffs) {
    if (handoffIds.has(handoff.id)) {
      pushIssue(
        issues,
        'duplicate-handoff-id',
        'error',
        `Duplicate supply handoff id: ${handoff.id}`,
        handoff.id
      )
    }
    handoffIds.add(handoff.id)

    const node = nodes.get(handoff.handoffNodeId)
    if (!node) {
      pushIssue(
        issues,
        'dangling-handoff-node',
        'error',
        `Handoff ${handoff.id} references missing node ${handoff.handoffNodeId}.`,
        handoff.id
      )
    } else if (node.kind !== 'panel-handoff') {
      pushIssue(
        issues,
        'invalid-handoff-node-kind',
        'error',
        `Handoff ${handoff.id} must reference a panel-handoff node.`,
        handoff.id
      )
    }

    if (
      handoff.conductors.length === 0 ||
      hasDuplicates(handoff.conductors) ||
      handoff.conductors.some(
        (conductor) =>
          conductor !== 'L1' &&
          conductor !== 'L2' &&
          conductor !== 'L3' &&
          conductor !== 'N' &&
          conductor !== 'PE'
      )
    ) {
      pushIssue(
        issues,
        'invalid-handoff-conductors',
        'error',
        `Handoff ${handoff.id} has an invalid conductor set.`,
        handoff.id
      )
    }
  }
}

export function validateOffGridSupplyAssembly(
  assembly: OffGridSupplyAssembly
): SupplyAssemblyValidationResult {
  const issues: SupplyAssemblyValidationIssue[] = []
  if (assembly.graphVersion !== SUPPLY_ASSEMBLY_GRAPH_VERSION) {
    pushIssue(
      issues,
      'unsupported-graph-version',
      'unsupported',
      `Supply assembly ${assembly.id} uses unsupported graph version ${String(assembly.graphVersion)}.`,
      assembly.id
    )
  }

  const nodes = validateNodeAndPortIdentity(assembly, issues)
  validateConnections(assembly, nodes, issues)
  validateV1Equipment(assembly, nodes, issues)
  validateHandoffs(assembly, nodes, issues)

  const status = issues.some((issue) => issue.severity === 'error')
    ? 'invalid'
    : issues.some((issue) => issue.severity === 'unsupported')
      ? 'unsupported'
      : 'valid'
  return { status, issues }
}
