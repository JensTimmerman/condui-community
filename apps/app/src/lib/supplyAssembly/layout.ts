import type {
  OffGridSupplyAssembly,
  SupplyConductor,
  SupplyConnectionPathRole,
  SupplyElectricalDomain,
  SupplyNode,
  SupplyPort,
} from './types'

export type SupplyLayoutPortSide = 'left' | 'right' | 'top' | 'bottom'

export interface SupplyLayoutPort {
  nodeId: string
  portId: string
  role: SupplyPort['role']
  domain: SupplyElectricalDomain
  conductors: SupplyConductor[]
  side: SupplyLayoutPortSide
  x: number
  y: number
}

export interface SupplyLayoutNode {
  nodeId: string
  kind: SupplyNode['kind']
  label: string
  x: number
  y: number
  width: number
  height: number
  ports: SupplyLayoutPort[]
}

export interface SupplyLayoutSegment {
  connectionId: string
  pathRole: SupplyConnectionPathRole
  domain: SupplyElectricalDomain
  conductors: SupplyConductor[]
  points: number[]
}

export interface SupplyAssemblyLayoutResult {
  nodes: SupplyLayoutNode[]
  segments: SupplyLayoutSegment[]
  bounds: { x: number; y: number; width: number; height: number }
}

interface NodeBox {
  x: number
  y: number
  width: number
  height: number
}

interface LayoutContext {
  inverterCount: number
  stackedInverters: boolean
  stackTop: number
  stackCenterY: number
  gridLaneY: number
}

const NODE_WIDTH = 136
const NODE_HEIGHT = 72

function createLayoutContext(assembly: OffGridSupplyAssembly): LayoutContext {
  const inverterCount = assembly.nodes.filter((node) => node.kind === 'inverter-unit').length
  const stackedInverters = inverterCount > 1
  const stackTop = 100
  const stackCenterY = stackTop + ((Math.max(inverterCount, 1) - 1) * 170) / 2 + 44
  return {
    inverterCount,
    stackedInverters,
    stackTop,
    stackCenterY,
    gridLaneY: stackedInverters ? stackTop + inverterCount * 170 + 40 : 430,
  }
}

function nodeBox(node: SupplyNode, kindIndex: number, context: LayoutContext): NodeBox {
  if (context.stackedInverters) {
    switch (node.kind) {
      case 'utility-source':
        return { x: 1030, y: context.gridLaneY, width: 112, height: 64 }
      case 'ac-distribution':
        return { x: 760, y: context.gridLaneY, width: 136, height: 64 }
      case 'inverter-unit':
        return { x: 590, y: context.stackTop + kindIndex * 170, width: 158, height: 88 }
      case 'battery':
        return { x: 1030, y: context.stackCenterY - 36, width: NODE_WIDTH, height: NODE_HEIGHT }
      case 'dc-bus':
        return { x: 790, y: context.stackCenterY - 28, width: 180, height: 56 }
      case 'changeover-switch':
        return { x: 350, y: context.gridLaneY - 60, width: 150, height: 104 }
      case 'panel-handoff':
        return { x: 70, y: Math.max(74, context.gridLaneY - 220), width: 128, height: 72 }
      default:
        break
    }
  }

  switch (node.kind) {
    case 'utility-source':
      return { x: 870, y: 430, width: 112, height: 64 }
    case 'ac-distribution':
      return { x: 610, y: 430, width: 136, height: 64 }
    case 'inverter-unit':
      return { x: 610, y: 186 + kindIndex * 124, width: 148, height: 88 }
    case 'battery':
      return { x: 870, y: 194 + kindIndex * 104, width: NODE_WIDTH, height: NODE_HEIGHT }
    case 'solar-source':
      return { x: 870, y: 74 + kindIndex * 104, width: NODE_WIDTH, height: NODE_HEIGHT }
    case 'dc-bus':
      return { x: 410, y: 440 + kindIndex * 104, width: 96, height: 56 }
    case 'protection':
      return { x: 625, y: 330 + kindIndex * 92, width: 112, height: 64 }
    case 'changeover-switch':
      return { x: 380, y: 230 + kindIndex * 124, width: 150, height: 104 }
    case 'panel-handoff':
      return { x: 80, y: 74 + kindIndex * 112, width: 128, height: 72 }
    case 'generator-source':
      return { x: 470, y: 70 + kindIndex * 104, width: NODE_WIDTH, height: NODE_HEIGHT }
    case 'integrated-transfer':
      return { x: 730, y: 70 + kindIndex * 104, width: NODE_WIDTH, height: NODE_HEIGHT }
  }
}

function portSide(node: SupplyNode, port: SupplyPort): SupplyLayoutPortSide {
  if (port.domain === 'DC') {
    if (node.kind === 'battery' || node.kind === 'solar-source') return 'left'
    if (node.kind === 'inverter-unit') return 'right'
    if (node.kind === 'dc-bus') return port.behavior === 'sink' ? 'right' : 'left'
    return 'bottom'
  }
  if (port.domain === 'PE') return 'bottom'
  switch (port.role) {
    case 'utility-ac':
      return 'left'
    case 'serial-load-side':
      return 'right'
    case 'grid-distribution-ac':
      return port.behavior === 'sink' ? 'right' : 'left'
    case 'inverter-grid-ac':
      return 'bottom'
    case 'inverter-backup-ac':
      return 'left'
    case 'source-grid-ac':
      return 'bottom'
    case 'source-backup-ac':
      return 'top'
    case 'serial-source-side':
    case 'panel-handoff':
      return 'bottom'
    case 'load-ac':
      return 'left'
    case 'battery-dc':
    case 'dc-bus':
    case 'solar-dc':
    case 'protective-earth':
      return 'bottom'
  }
}

function anchoredPorts(node: SupplyNode, box: NodeBox): SupplyLayoutPort[] {
  const sides = new Map<SupplyLayoutPortSide, SupplyPort[]>()
  for (const port of node.ports) {
    const side = portSide(node, port)
    const ports = sides.get(side) ?? []
    ports.push(port)
    sides.set(side, ports)
  }

  const result: SupplyLayoutPort[] = []
  for (const [side, ports] of sides) {
    ports.forEach((port, index) => {
      const fraction = (index + 1) / (ports.length + 1)
      const horizontal = side === 'top' || side === 'bottom'
      result.push({
        nodeId: node.id,
        portId: port.id,
        role: port.role,
        domain: port.domain,
        conductors: [...port.conductors],
        side,
        x: horizontal
          ? box.x + box.width * fraction
          : side === 'left'
            ? box.x
            : box.x + box.width,
        y: horizontal
          ? side === 'top'
            ? box.y
            : box.y + box.height
          : box.y + box.height * fraction,
      })
    })
  }
  return result
}

function routePorts(
  first: SupplyLayoutPort,
  second: SupplyLayoutPort,
  pathRole: SupplyConnectionPathRole,
): number[] {
  if (pathRole === 'load-ac') {
    return [first.x, first.y, second.x, first.y, second.x, second.y]
  }
  const bothHorizontal =
    (first.side === 'left' || first.side === 'right') &&
    (second.side === 'left' || second.side === 'right')
  if (bothHorizontal && Math.abs(first.y - second.y) < 1) {
    return [first.x, first.y, second.x, second.y]
  }
  if (first.domain === 'DC' || first.domain === 'PE') {
    const routeX = first.x + (second.x - first.x) / 2
    return [first.x, first.y, routeX, first.y, routeX, second.y, second.x, second.y]
  }
  if (first.side === 'top' || first.side === 'bottom') {
    return [first.x, first.y, first.x, second.y, second.x, second.y]
  }
  if (second.side === 'bottom') {
    const routeY = second.y + 44
    return [first.x, first.y, first.x, routeY, second.x, routeY, second.x, second.y]
  }
  if (second.side === 'top') {
    return [first.x, first.y, second.x, first.y, second.x, second.y]
  }
  const routeX = first.x + (second.x - first.x) / 2
  return [first.x, first.y, routeX, first.y, routeX, second.y, second.x, second.y]
}

export function deriveSupplyAssemblyLayout(
  assembly: OffGridSupplyAssembly,
): SupplyAssemblyLayoutResult {
  const context = createLayoutContext(assembly)
  const kindCounts = new Map<SupplyNode['kind'], number>()
  const nodes = assembly.nodes.map((node): SupplyLayoutNode => {
    const kindIndex = kindCounts.get(node.kind) ?? 0
    kindCounts.set(node.kind, kindIndex + 1)
    const box = nodeBox(node, kindIndex, context)
    return {
      nodeId: node.id,
      kind: node.kind,
      label: node.label ?? node.kind,
      ...box,
      ports: anchoredPorts(node, box),
    }
  })

  const ports = new Map<string, SupplyLayoutPort>()
  for (const node of nodes) {
    for (const port of node.ports) ports.set(`${port.nodeId}:${port.portId}`, port)
  }

  const segments: SupplyLayoutSegment[] = []
  for (const connection of assembly.connections) {
    const [firstRef, secondRef] = connection.endpoints
    const first = ports.get(`${firstRef.nodeId}:${firstRef.portId}`)
    const second = ports.get(`${secondRef.nodeId}:${secondRef.portId}`)
    if (!first || !second) continue
    segments.push({
      connectionId: connection.id,
      pathRole: connection.pathRole,
      domain: connection.domain,
      conductors: [...connection.conductors],
      points: routePorts(first, second, connection.pathRole),
    })
  }

  const margin = 56
  const maxX = Math.max(...nodes.map((node) => node.x + node.width), margin)
  const maxY = Math.max(...nodes.map((node) => node.y + node.height), margin)
  return {
    nodes,
    segments,
    bounds: { x: 0, y: 0, width: maxX + margin, height: maxY + margin },
  }
}
