/**
 * Query API interface for accessing installation data
 * This insulates rules from Belgium-specific or raw graph structure
 */
import type {
  Panel,
  Circuit,
  ProtectionDevice,
  Endpoint,
  Placement,
  WireSegment,
  TrunkDevice,
  CircuitKind,
} from '@/types/schema'
import type { ValidationProject } from './types'
import { trunkDeviceCountsAsProtection } from '@/lib/protectionKind'
import { getDerivedCircuitKind } from '@/lib/circuitKind'
import { ProjectIndex } from './projectIndex'
import { getElectricalInstallationFromProject } from '@/lib/projectV2/electrical'

export interface CircuitIdentifier {
  circuitCode: string // e.g. "A"
  pointLabel: string // e.g. "A1"
}

export interface SitplanMapping {
  placementId: string
  circuitId: string
  endpointId: string
  circuitPointId: string // e.g. "A1"
}

export interface ControlledLoadRef {
  circuitId: string
  loadId: string
}

/**
 * Query API interface for accessing installation data
 */
export interface InstallationQueryAPI {
  // Structure queries
  getCircuits(panelId?: string): Circuit[]
  getBoards(): Panel[]
  getDevicesByType(type: 'MCB' | 'RCD' | 'RCBO' | 'FUSE'): ProtectionDevice[]
  getCircuitById(id: string): Circuit | undefined
  /** Circuit kind derived from endpoints/trunk (for rules); use this instead of circuit.kind when enforcing. */
  getCircuitKind(circuitId: string): CircuitKind
  getPanelById(id: string): Panel | undefined
  getProtectionById(id: string): ProtectionDevice | undefined
  /** Upstream protection (typically MCB/RCBO/FUSE) that owns this circuit, if any. */
  getProtectionForCircuit(circuitId: string): ProtectionDevice | undefined
  getEndpointById(id: string): Endpoint | undefined
  getTrunkDeviceById(id: string): TrunkDevice | undefined

  // Graph queries
  getDownstream(circuitId: string): Array<{ type: 'circuit' | 'endpoint'; id: string }>
  getUpstream(deviceId: string): Array<{ type: 'protection' | 'circuit'; id: string }>

  // Wiring queries
  getCableSegments(circuitId: string): WireSegment[]
  getCrossSection(segment: WireSegment): number | undefined
  getInstallationMethod(segment: WireSegment): string | undefined

  // Spatial queries
  getPlacementsByFloor(floorId: string): Placement[]
  getPlacementById(id: string): (Placement & { endpointId?: string }) | undefined
  getSpatialDistance(a: Placement, b: Placement): number | undefined // Stub for now

  // Identifier queries
  getCircuitLetter(circuitId: string): string | undefined
  getPointLabel(endpointId: string): string | undefined
  getSitplanToEendraadMapping(): SitplanMapping[]
  getControlledLoadRef(endpointId: string): ControlledLoadRef | undefined

  // Source queries
  getSupplyOrigin(): 'grid' | 'generator' | 'pv_inverter' | 'unknown' | undefined
  /** Protection devices on the main supply trunk (upstream of the main panel). */
  getMainSupplyProtections(): TrunkDevice[]
}

/**
 * Default implementation of InstallationQueryAPI.
 *
 * All lookups are backed by a `ProjectIndex` that is built once in O(N) at
 * construction time. The historical recursive-walk implementation of
 * `getCircuitById` / `getEndpointById` / `getProtectionForCircuit` / …
 * showed up as the single hottest path in validation traces — every rule
 * was paying an O(panels × circuits × endpoints) tax per scope. With the
 * index in place those lookups are O(1).
 */
export class DefaultQueryAPI implements InstallationQueryAPI {
  private readonly index: ProjectIndex

  constructor(
    private project: ValidationProject,
    index?: ProjectIndex,
  ) {
    this.index = index ?? new ProjectIndex(project)
  }

  getCircuits(panelId?: string): Circuit[] {
    if (panelId !== undefined) {
      return this.index.circuitsByPanelId.get(panelId) ?? []
    }
    return this.index.allCircuits
  }

  getBoards(): Panel[] {
    return this.index.allPanels
  }

  getDevicesByType(type: 'MCB' | 'RCD' | 'RCBO' | 'FUSE'): ProtectionDevice[] {
    return this.index.devicesByType.get(type) ?? []
  }

  getCircuitById(id: string): Circuit | undefined {
    return this.index.circuitById.get(id)
  }

  getCircuitKind(circuitId: string): CircuitKind {
    const circuit = this.index.circuitById.get(circuitId)
    if (!circuit) return 'other'
    const protection = this.getProtectionForCircuit(circuitId)
    return getDerivedCircuitKind(circuit, protection)
  }

  getProtectionForCircuit(circuitId: string): ProtectionDevice | undefined {
    return this.index.protectionsByCircuitId.get(circuitId)?.[0]
  }

  getPanelById(id: string): Panel | undefined {
    return this.index.panelById.get(id)
  }

  getProtectionById(id: string): ProtectionDevice | undefined {
    return this.index.protectionById.get(id)
  }

  getEndpointById(id: string): Endpoint | undefined {
    return this.index.endpointById.get(id)
  }

  getTrunkDeviceById(id: string): TrunkDevice | undefined {
    return this.index.trunkDeviceById.get(id)
  }

  getMainSupplyProtections(): TrunkDevice[] {
    const installation = getElectricalInstallationFromProject(this.project)
    return (
      installation?.mainSupply?.supplyTrunkDevices?.filter((td) =>
        trunkDeviceCountsAsProtection(td),
      ) ?? []
    )
  }

  getDownstream(circuitId: string): Array<{ type: 'circuit' | 'endpoint'; id: string }> {
    const circuit = this.index.circuitById.get(circuitId)
    if (!circuit) return []
    const result: Array<{ type: 'circuit' | 'endpoint'; id: string }> = []
    for (const endpoint of circuit.endpoints) {
      result.push({ type: 'endpoint', id: endpoint.id })
    }
    if (circuit.subCircuitIds) {
      for (const subCircuitId of circuit.subCircuitIds) {
        result.push({ type: 'circuit', id: subCircuitId })
      }
    }
    return result
  }

  getUpstream(deviceId: string): Array<{ type: 'protection' | 'circuit'; id: string }> {
    const result: Array<{ type: 'protection' | 'circuit'; id: string }> = []
    const seen = new Set<string>()
    const pushUnique = (item: { type: 'protection' | 'circuit'; id: string }) => {
      const key = `${item.type}:${item.id}`
      if (seen.has(key)) return
      seen.add(key)
      result.push(item)
    }

    const circuit = this.index.circuitById.get(deviceId)
    if (!circuit) return result

    // Collect actual upstream protections (MCB/RCD/RCBO/etc.) for the circuit.
    // A circuit stored directly under a panel has no recorded protection, so
    // do not invent one here: validation must report the missing relationship.
    const collectDirectUpstream = (circuitId: string) => {
      const protections = this.index.protectionsByCircuitId.get(circuitId)
      if (!protections) return
      for (const protection of protections) {
        pushUnique({ type: 'protection', id: protection.id })
      }
    }

    collectDirectUpstream(deviceId)

    // Also collect upstream protections of any parent/container circuits via
    // `subCircuitIds` (recursive). Some projects model a "container" circuit
    // under an RCD/RCBO with `subCircuitIds` pointing to the leaf circuit
    // (which actually owns the endpoints).
    const visitedCircuitIds = new Set<string>([deviceId])
    let frontier: string[] = [deviceId]
    while (frontier.length > 0) {
      const nextFrontier: string[] = []
      for (const childId of frontier) {
        const parents = this.index.parentCircuitIdsByChildId.get(childId)
        if (!parents) continue
        for (const parentId of parents) {
          if (visitedCircuitIds.has(parentId)) continue
          visitedCircuitIds.add(parentId)
          pushUnique({ type: 'circuit', id: parentId })
          collectDirectUpstream(parentId)
          nextFrontier.push(parentId)
        }
      }
      frontier = nextFrontier
    }

    return result
  }

  getCableSegments(circuitId: string): WireSegment[] {
    return this.index.cableSegmentsByCircuitId.get(circuitId) ?? []
  }

  getCrossSection(segment: WireSegment): number | undefined {
    return segment.cable?.sectionMm2
  }

  getInstallationMethod(segment: WireSegment): string | undefined {
    return segment.installationType
  }

  getPlacementsByFloor(floorId: string): Placement[] {
    return this.index.placementsByFloorId.get(floorId) ?? []
  }

  getPlacementById(id: string): (Placement & { endpointId?: string }) | undefined {
    return this.index.placementWithEndpointById.get(id)
  }

  getSpatialDistance(_a: Placement, _b: Placement): number | undefined {
    // Stub: return undefined for now
    // Later: compute actual distance from floor plan geometry
    return undefined
  }

  getCircuitLetter(circuitId: string): string | undefined {
    return this.index.circuitById.get(circuitId)?.code
  }

  getPointLabel(endpointId: string): string | undefined {
    return this.index.pointLabelByEndpointId.get(endpointId)
  }

  getSitplanToEendraadMapping(): SitplanMapping[] {
    return this.index.sitplanMappings
  }

  getControlledLoadRef(endpointId: string): ControlledLoadRef | undefined {
    const endpoint = this.index.endpointById.get(endpointId)
    if (!endpoint || !endpoint.controlledEndpointIds || endpoint.controlledEndpointIds.length === 0) {
      return undefined
    }
    const circuit = this.index.circuitForEndpointId.get(endpointId)
    if (!circuit) return undefined
    const controlledId = endpoint.controlledEndpointIds[0]
    if (!controlledId) return undefined
    return {
      circuitId: circuit.id,
      loadId: controlledId,
    }
  }

  getSupplyOrigin(): 'grid' | 'generator' | 'pv_inverter' | 'unknown' | undefined {
    return getElectricalInstallationFromProject(this.project)?.mainSupply.origin
  }
}
