import type { OffGridSupplyAssembly } from '@/types/supplyAssembly'

const handoffId = (panelId: string): string => `direct-inverter-panel-backup-${panelId}`
const handoffNodeId = (panelId: string): string => `direct-inverter-panel-handoff-${panelId}`

function directInverter(assembly: OffGridSupplyAssembly) {
  if (
    assembly.presetIntent !== 'grid_connected_storage_branch' ||
    assembly.nodes.some((node) => node.kind === 'changeover-switch')
  ) {
    return undefined
  }
  return assembly.nodes.find(
    (node) => node.kind === 'inverter-unit' && node.symbol === 'inverter'
  )
}

export function canEnableDirectInverterPanelBackup(
  assembly: OffGridSupplyAssembly | undefined
): boolean {
  return Boolean(assembly && directInverter(assembly))
}

/** Materialize a direct inverter backup-output handoff to one main-panel bus. */
export function enableDirectInverterPanelBackup(
  assembly: OffGridSupplyAssembly,
  panelId: string
): boolean {
  const inverter = directInverter(assembly)
  const gridPort = inverter?.ports.find(
    (port) => port.domain === 'AC' && port.role === 'inverter-grid-ac'
  )
  if (!inverter || !gridPort) return false
  const conductors = gridPort.conductors.filter(
    (conductor): conductor is 'L1' | 'L2' | 'L3' | 'N' | 'PE' =>
      conductor !== 'DC+' && conductor !== 'DC-'
  )
  let backupPort = inverter.ports.find((port) => port.role === 'inverter-backup-ac')
  if (!backupPort) {
    backupPort = {
      id: 'backup',
      role: 'inverter-backup-ac',
      domain: 'AC',
      behavior: 'source',
      conductors,
      maxConnections: 'many',
    }
    inverter.ports.push(backupPort)
  }

  const targetNodeId = handoffNodeId(panelId)
  if (!assembly.nodes.some((node) => node.id === targetNodeId)) {
    assembly.nodes.push({
      id: targetNodeId,
      kind: 'panel-handoff',
      symbol: 'panel_distribution',
      label: '',
      properties: {},
      ports: [{
        id: 'in',
        role: 'panel-handoff',
        domain: 'AC',
        behavior: 'sink',
        conductors,
        maxConnections: 1,
      }],
    })
  }
  const connectionId = `${inverter.id}-to-${targetNodeId}`
  if (!assembly.connections.some((connection) => connection.id === connectionId)) {
    assembly.connections.push({
      id: connectionId,
      endpoints: [
        { nodeId: inverter.id, portId: backupPort.id },
        { nodeId: targetNodeId, portId: 'in' },
      ],
      domain: 'AC',
      conductors,
      pathRole: 'inverter-backup-ac',
    })
  }
  if (!assembly.loadHandoffs.some((handoff) => handoff.id === handoffId(panelId))) {
    assembly.loadHandoffs.push({
      id: handoffId(panelId),
      handoffNodeId: targetNodeId,
      target: { kind: 'panel-input', panelId },
      conductors,
    })
  }
  for (const group of assembly.inverterGroups) {
    if (!group.unitNodeIds.includes(inverter.id)) continue
    group.shared.capabilities.supportsBackupSupply = true
    group.shared.capabilities.hasDedicatedBackupAcOutput = true
    group.use.enabledForBackup = true
  }
  return true
}

/** Remove only the direct panel handoff generated when split mode was enabled. */
export function disableDirectInverterPanelBackup(
  assemblies: OffGridSupplyAssembly[],
  panelId: string
): void {
  const targetHandoffId = handoffId(panelId)
  const targetNodeId = handoffNodeId(panelId)
  for (const assembly of assemblies) {
    if (!assembly.loadHandoffs.some((handoff) => handoff.id === targetHandoffId)) continue
    assembly.loadHandoffs = assembly.loadHandoffs.filter(
      (handoff) => handoff.id !== targetHandoffId
    )
    assembly.connections = assembly.connections.filter(
      (connection) => !connection.endpoints.some((endpoint) => endpoint.nodeId === targetNodeId)
    )
    assembly.nodes = assembly.nodes.filter((node) => node.id !== targetNodeId)
    if (!assembly.connections.some((connection) => connection.pathRole === 'inverter-backup-ac')) {
      for (const node of assembly.nodes) {
        if (node.kind === 'inverter-unit') {
          node.ports = node.ports.filter((port) => port.role !== 'inverter-backup-ac')
        }
      }
      for (const group of assembly.inverterGroups) group.use.enabledForBackup = false
    }
  }
}
