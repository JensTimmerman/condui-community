import type { Panel } from '@/types/schema'
import type {
  OffGridSupplyAssembly,
  SupplyAttachmentRef,
  SupplyConnection,
  SupplyNode,
  SupplyPortRef,
} from '@/types/supplyAssembly'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { getPrimaryPanelBusSectionId } from '@/lib/panel/panelBusSections'

/** Legacy physical nodes used their own id before device references were introduced. */
export function getSupplyNodePhysicalDeviceId(node: SupplyNode): string | undefined {
  return (
    node.deviceId ??
    (['utility-source', 'panel-handoff', 'ac-distribution'].includes(node.kind)
      ? undefined
      : node.id)
  )
}

function isDirectedAcConnection(
  assembly: OffGridSupplyAssembly,
  connection: SupplyConnection
): boolean {
  if (connection.domain !== 'AC') return false
  const [from, to] = connection.endpoints
  const source = assembly.nodes
    .find((node) => node.id === from.nodeId)
    ?.ports.find((port) => port.id === from.portId)
  const target = assembly.nodes
    .find((node) => node.id === to.nodeId)
    ?.ports.find((port) => port.id === to.portId)
  return (
    source?.domain === 'AC' &&
    source.behavior !== 'sink' &&
    target?.domain === 'AC' &&
    target.behavior !== 'source'
  )
}

export function resolveAssemblyPanelInput(
  project: ProjectWithOptionalV2Electrical,
  target: SupplyAttachmentRef
): { panelId: string; busSectionId?: string } | undefined {
  if (target.kind === 'panel-input' || target.kind === 'panel-bus-input') return target
  if (target.kind === 'root-feed') {
    const feed = getProjectElectricalInstallation(project)?.feedTopology?.rootFeeds.find(
      (feed) => feed.id === target.rootFeedId
    )
    if (feed) return { panelId: feed.panelId, busSectionId: feed.busSectionId }
  }
  return undefined
}

export function assemblyOwnsPanelInput(
  project: ProjectWithOptionalV2Electrical,
  panel: Panel,
  busSectionId?: string
): boolean {
  const section = busSectionId ?? getPrimaryPanelBusSectionId(panel)
  return selectProjectSupplyAssemblies(project).some((assembly) =>
    assembly.loadHandoffs.some(({ target }) => {
      const input = resolveAssemblyPanelInput(project, target)
      return (
        input?.panelId === panel.id &&
        (input.busSectionId ?? getPrimaryPanelBusSectionId(panel)) === section
      )
    })
  )
}

/** A sibling panel-input enters its local feed before reaching the panel bus.
 * The assembly owner's feed is upstream; explicit bus inputs already target the bus.
 */
export function getAssemblyReceivingPanelInputDevices(
  project: ProjectWithOptionalV2Electrical,
  assembly: OffGridSupplyAssembly,
  target: SupplyAttachmentRef
) {
  if (target.kind !== 'panel-input' && target.kind !== 'root-feed') return []
  const input = resolveAssemblyPanelInput(project, target)
  if (!input || resolveAssemblyPanelInput(project, assembly.incomingAttachment)?.panelId === input.panelId)
    return []
  const feed = getProjectElectricalInstallation(project)?.feedTopology?.rootFeeds.find((feed) =>
    target.kind === 'root-feed' ? feed.id === target.rootFeedId : feed.panelId === input.panelId)
  const devices = feed?.trunkDevices ?? []
  const assemblyDeviceIds = new Set(selectProjectSupplyAssemblies(project).flatMap((candidate) =>
    candidate.nodes.map(getSupplyNodePhysicalDeviceId)))
  // Another assembly's input chain has its own graph ownership.
  if (devices.some((device) => assemblyDeviceIds.has(device.id))) return []
  return [...devices].sort((a, b) => a.trunkPosition - b.trunkPosition || a.id.localeCompare(b.id))
}

/** Generated main-panel fan-out, as opposed to an explicit circuit/backup takeoff. */
export function isGeneratedCommonPanelHandoff(
  assembly: OffGridSupplyAssembly,
  handoff: OffGridSupplyAssembly['loadHandoffs'][number]
): boolean {
  return (
    (handoff.target.kind === 'panel-input' || handoff.target.kind === 'panel-bus-input') &&
    handoff.id === `${assembly.id}-panel-load-${handoff.target.panelId}` &&
    handoff.handoffNodeId === `${assembly.id}-panel-handoff-${handoff.target.panelId}`
  )
}

/** Walk the complete common load path, stopping before the panel bus fan-out. */
export function resolveCommonLoadTail(
  assembly: OffGridSupplyAssembly,
  project?: ProjectWithOptionalV2Electrical
): SupplyPortRef | undefined {
  const changeover = assembly.nodes.find((node) => node.kind === 'changeover-switch')
  const inverter = assembly.nodes.find((node) => node.kind === 'inverter-unit')
  const directGridConnected = !changeover && inverter && assembly.connections.some(
    (connection) => connection.pathRole === 'inverter-grid-ac' &&
      connection.endpoints[1].nodeId === inverter.id
  )
  const start = changeover ?? (directGridConnected
    ? assembly.nodes.find((node) => node.kind === 'utility-source')
    : undefined)
  if (!start) return undefined
  const pathRole = changeover ? 'load-ac' : 'grid-only-bypass-ac'
  const startPort = changeover ? 'load' : 'out'
  let expectedTail: SupplyPortRef | undefined
  if (project) {
    const installation = getProjectElectricalInstallation(project)
    const input = resolveAssemblyPanelInput(project, assembly.incomingAttachment)
    const switchDeviceId = getSupplyNodePhysicalDeviceId(changeover ?? inverter!)
    const feedLists = [
      installation?.feedTopology?.sharedFeed.trunkDevices ??
        installation?.mainSupply.supplyTrunkDevices ??
        [],
      ...(installation?.feedTopology?.rootFeeds ?? [])
        .filter((feed) => !input || feed.panelId === input.panelId)
        .map((feed) => feed.trunkDevices ?? []),
    ].filter((devices) => devices.some((device) => device.id === switchDeviceId))
    const explicitRootBranch = assembly.loadHandoffs.some((handoff) => handoff.id === `${assembly.id}-root-input-${input?.panelId}`)
    if (feedLists.length === 1 && !explicitRootBranch) {
      const devices = feedLists[0]!
      const switchIndex = devices.findIndex((device) => device.id === switchDeviceId)
      const serial = devices
        .slice(switchIndex + 1)
        .filter((device) => device.supplyPath == null || device.supplyPath === 'serial')
      const candidate = serial.length
        ? assembly.nodes.find((node) => getSupplyNodePhysicalDeviceId(node) === serial.at(-1)!.id)
        : start
      const output = candidate?.ports.find(
        (port) =>
          port.domain === 'AC' && (port.role === 'serial-load-side' || port.role === 'load-ac' ||
            (candidate === start && port.id === startPort))
      )
      if (!candidate || !output) return undefined
      expectedTail = { nodeId: candidate.id, portId: output.id }
    }
  }
  // Terminal handoff fan-outs do not shorten the common path. Two continuing
  // device paths, however, are ambiguous: never select one by list order.
  let tail = { nodeId: start.id, portId: startPort }
  const visited = new Set<string>()
  while (!visited.has(tail.nodeId)) {
    visited.add(tail.nodeId)
    const outgoing = assembly.connections.filter(
      (connection) =>
        connection.pathRole === pathRole &&
        isDirectedAcConnection(assembly, connection) &&
        connection.endpoints[0].nodeId === tail.nodeId &&
        connection.endpoints[0].portId === tail.portId &&
        assembly.nodes.find((node) => node.id === connection.endpoints[1].nodeId)?.kind !== 'panel-handoff'
    )
    if (outgoing.length > 1) return undefined
    if (outgoing.length === 0) break
    const next = assembly.nodes.find((node) => node.id === outgoing[0]!.endpoints[1].nodeId)
    if (!next || visited.has(next.id)) return undefined
    if (next.kind === 'panel-handoff') break
    const output = next.ports.find(
      (port) =>
        port.domain === 'AC' &&
        (port.role === 'serial-load-side' || port.role === 'load-ac' || port.behavior === 'source')
    )
    if (!output) return undefined
    tail = { nodeId: next.id, portId: output.id }
  }
  return !expectedTail ||
    (tail.nodeId === expectedTail.nodeId && tail.portId === expectedTail.portId)
    ? tail
    : undefined
}

/** Structural reachability, independent of switch position or physical mounting. */
export function reachableSupplyNodes(assembly: OffGridSupplyAssembly): Set<string> {
  const reachable = new Set(
    assembly.nodes
      .filter(
        (node) =>
          node.kind === 'utility-source' ||
          node.kind === 'generator-source' ||
          node.kind === 'inverter-unit'
      )
      .map((node) => node.id)
  )
  const queue = [...reachable]
  for (let index = 0; index < queue.length; index++) {
    for (const connection of assembly.connections) {
      const [from, to] = connection.endpoints
      if (
        from.nodeId !== queue[index] ||
        reachable.has(to.nodeId) ||
        !isDirectedAcConnection(assembly, connection)
      )
        continue
      reachable.add(to.nodeId)
      queue.push(to.nodeId)
    }
  }
  return reachable
}

export type SupplyPhysicalTarget =
  | { kind: 'device'; deviceId: string }
  | { kind: 'bus'; panelId: string; busSectionId: string }
  | { kind: 'circuit'; circuitId: string }

/** Read-only topology projection. Enclosures and grid slots never create edges. */
export function buildSupplyElectricalTopology(project: ProjectWithOptionalV2Electrical) {
  const installation = getProjectElectricalInstallation(project)
  const assemblies = selectProjectSupplyAssemblies(project)
  const panels: Panel[] = []
  const collect = (items: Panel[]) =>
    items.forEach((panel) => {
      panels.push(panel)
      collect(panel.subPanels ?? [])
    })
  collect(getProjectElectricalPanels(project))
  const targets = new Map<string, SupplyPhysicalTarget>()
  const children = new Map<string, Set<string>>()
  const parents = new Map<string, Set<string>>()
  const link = (from: string | undefined, to: string | undefined) => {
    if (!from || !to || from === to) return
    if (!children.has(from)) children.set(from, new Set())
    if (!parents.has(to)) parents.set(to, new Set())
    children.get(from)!.add(to)
    parents.get(to)!.add(from)
  }
  const deviceKey = (deviceId: string) => {
    const key = `device:${deviceId}`
    targets.set(key, { kind: 'device', deviceId })
    return key
  }
  const busKey = (panelId: string, busSectionId?: string) => {
    const panel = panels.find((panel) => panel.id === panelId)
    if (!panel) return undefined
    const section = busSectionId ?? getPrimaryPanelBusSectionId(panel)
    const key = `bus:${panelId}:${section}`
    targets.set(key, { kind: 'bus', panelId, busSectionId: section })
    return key
  }
  const circuitKey = (circuitId: string) => {
    const key = `circuit:${circuitId}`
    targets.set(key, { kind: 'circuit', circuitId })
    return key
  }
  const assemblyDevices = new Set(
    assemblies.flatMap((assembly) =>
      assembly.nodes.flatMap((node) => {
        const deviceId = getSupplyNodePhysicalDeviceId(node)
        return deviceId ? [deviceId] : []
      })
    )
  )
  const handledDevices = new Set(assemblyDevices)
  const shared =
    installation?.feedTopology?.sharedFeed.trunkDevices ??
    installation?.mainSupply.supplyTrunkDevices ??
    []
  const sharedAssemblyUpstreamById = new Map<string, string | undefined>()
  const gridSourceKey = 'grid:source'
  let sharedTail: string | undefined = gridSourceKey
  for (const device of shared) {
    const key = deviceKey(device.id)
    handledDevices.add(device.id)
    if (assemblyDevices.has(device.id)) {
      for (const assembly of assemblies) {
        if (
          !sharedAssemblyUpstreamById.has(assembly.id) &&
          assembly.nodes.some((node) => getSupplyNodePhysicalDeviceId(node) === device.id)
        ) {
          sharedAssemblyUpstreamById.set(assembly.id, sharedTail)
        }
      }
    } else link(sharedTail, key)
    sharedTail = key
  }
  const upstreamByPanel = new Map<string, string | undefined>()
  for (const feed of installation?.feedTopology?.rootFeeds ?? []) {
    const receivingDevices = assemblies.flatMap((assembly) => assembly.loadHandoffs.flatMap((handoff) => {
      const input = resolveAssemblyPanelInput(project, handoff.target)
      return input?.panelId === feed.panelId
        ? getAssemblyReceivingPanelInputDevices(project, assembly, handoff.target) : []
    }))
    if (receivingDevices.length) {
      let previous: string | undefined
      for (const device of new Map(receivingDevices.map((device) => [device.id, device])).values()) {
        const current = deviceKey(device.id)
        handledDevices.add(device.id)
        link(previous, current)
        previous = current
      }
      link(previous, busKey(feed.panelId, feed.busSectionId))
      continue
    }
    const assemblyAssociated =
      (feed.trunkDevices ?? []).some((device) => assemblyDevices.has(device.id)) ||
      assemblies.some(
        (assembly) =>
          resolveAssemblyPanelInput(project, assembly.incomingAttachment)?.panelId === feed.panelId
      )
    let tail = sharedTail
    let fallbackBusTail = sharedTail
    const directConverterBranch =
      (feed.trunkDevices ?? []).some((device) => device.supplyPath === 'converter-branch') &&
      !(feed.trunkDevices ?? []).some((device) => device.symbol === 'source_changeover')
    let assemblySeen = false
    for (const device of feed.trunkDevices ?? []) {
      const key = deviceKey(device.id)
      if (assemblyAssociated) handledDevices.add(device.id)
      if (assemblyDevices.has(device.id)) {
        if (!assemblySeen) upstreamByPanel.set(feed.panelId, tail)
        assemblySeen = true
      } else {
        link(tail, key)
        fallbackBusTail = key
      }
      if (!directConverterBranch || !assemblyDevices.has(device.id)) tail = key
    }
    if (!assemblySeen) upstreamByPanel.set(feed.panelId, tail)
    const panel = panels.find((panel) => panel.id === feed.panelId)
    if (panel && !assemblyOwnsPanelInput(project, panel, feed.busSectionId)) {
      link(fallbackBusTail, busKey(feed.panelId, feed.busSectionId))
    }
  }
  for (const assembly of assemblies) {
    const nodeKeys = new Map(
      assembly.nodes.map((node) => {
        const deviceId = getSupplyNodePhysicalDeviceId(node)
        return [node.id, deviceId ? deviceKey(deviceId) : `assembly:${assembly.id}:${node.id}`]
      })
    )
    const input = resolveAssemblyPanelInput(project, assembly.incomingAttachment)
    const utility = assembly.nodes.find((node) => node.kind === 'utility-source')
    const upstream = sharedAssemblyUpstreamById.has(assembly.id)
      ? sharedAssemblyUpstreamById.get(assembly.id)
      : input
        ? upstreamByPanel.get(input.panelId)
        : assembly.incomingAttachment.kind === 'shared-feed'
          ? sharedTail
          : undefined
    if (utility) link(upstream, nodeKeys.get(utility.id))
    for (const connection of assembly.connections) {
      if (connection.domain === 'PE') continue
      link(
        nodeKeys.get(connection.endpoints[0].nodeId),
        nodeKeys.get(connection.endpoints[1].nodeId)
      )
    }
    for (const handoff of assembly.loadHandoffs) {
      const target = resolveAssemblyPanelInput(project, handoff.target)
      if (target) {
        const receivingDevice = getAssemblyReceivingPanelInputDevices(project, assembly, handoff.target)[0]
        link(nodeKeys.get(handoff.handoffNodeId), receivingDevice
          ? deviceKey(receivingDevice.id) : busKey(target.panelId, target.busSectionId))
      }
      else if (handoff.target.kind === 'circuit-input') {
        link(nodeKeys.get(handoff.handoffNodeId), circuitKey(handoff.target.circuitId))
      }
    }
  }
  const adjacent = (key: string, direction: 'parents' | 'children'): SupplyPhysicalTarget[] => {
    const adjacency = direction === 'parents' ? parents : children
    const seen = new Set([key])
    const queue = [...(adjacency.get(key) ?? [])]
    const result: SupplyPhysicalTarget[] = []
    for (let index = 0; index < queue.length; index++) {
      const next = queue[index]!
      if (seen.has(next)) continue
      seen.add(next)
      const target = targets.get(next)
      if (target) result.push(target)
      else queue.push(...(adjacency.get(next) ?? []))
    }
    return result.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  return {
    hasDevice: (id: string) => targets.has(`device:${id}`),
    handlesDevice: (id: string) => handledDevices.has(id),
    handledDeviceIds: () => [...handledDevices],
    gridChildren: () => adjacent(gridSourceKey, 'children'),
    assemblyNodeParents: (assemblyId: string, nodeId: string) =>
      adjacent(`assembly:${assemblyId}:${nodeId}`, 'parents'),
    deviceAdjacent: (id: string, direction: 'parents' | 'children') =>
      adjacent(`device:${id}`, direction),
    busParents: (panel: Panel, section?: string) => adjacent(busKey(panel.id, section)!, 'parents'),
    hasCircuit: (id: string) => targets.has(`circuit:${id}`),
    circuitParents: (id: string) => adjacent(`circuit:${id}`, 'parents'),
  }
}
