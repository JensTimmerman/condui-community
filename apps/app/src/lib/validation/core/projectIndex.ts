/**
 * Pre-built lookup index for a single validation run.
 *
 * Building the index is O(N) over the project graph and happens once per
 * `validateProject` call. After that, every `*ById` lookup, circuit/endpoint
 * back-pointer, and pre-grouped collection is O(1) instead of an O(N)
 * recursive panel-tree walk (or worse, O(N²) for things like
 * `getSitplanToEendraadMapping` that historically called `getPointLabel`
 * inside a project-wide walk).
 *
 * The shape mirrors the historical `DefaultQueryAPI` lookups so that
 * `DefaultQueryAPI` can be a thin facade over this index.
 */
import type {
  Panel,
  Circuit,
  Branch,
  ProtectionDevice,
  Endpoint,
  Placement,
  WireSegment,
  TrunkDevice,
} from '@/types/schema'
import type { ValidationProject } from './types'
import { queryOneWireSegments } from '@/lib/projectV2/annotations'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'

export interface IndexedSitplanMapping {
  placementId: string
  circuitId: string
  endpointId: string
  circuitPointId: string
}

export type PlacementWithEndpointId = Placement & { endpointId: string }

export class ProjectIndex {
  // Flat collections
  readonly allPanels: Panel[] = []
  readonly allProtections: ProtectionDevice[] = []
  readonly allCircuits: Circuit[] = []
  readonly allEndpoints: Endpoint[] = []

  // ID-keyed lookups
  readonly panelById = new Map<string, Panel>()
  readonly protectionById = new Map<string, ProtectionDevice>()
  readonly circuitById = new Map<string, Circuit>()
  readonly endpointById = new Map<string, Endpoint>()
  readonly trunkDeviceById = new Map<string, TrunkDevice>()
  readonly placementWithEndpointById = new Map<string, PlacementWithEndpointId>()

  // Back-pointers
  readonly circuitForEndpointId = new Map<string, Circuit>()
  readonly panelForCircuitId = new Map<string, Panel>()

  // Protection topology
  /** Every protection that lists the circuit in its `circuits` array. */
  readonly protectionsByCircuitId = new Map<string, ProtectionDevice[]>()
  /** For every circuit id, the parent circuit ids that reference it via `subCircuitIds`. */
  readonly parentCircuitIdsByChildId = new Map<string, Set<string>>()

  // Pre-grouped collections
  readonly circuitsByPanelId = new Map<string, Circuit[]>()
  readonly cableSegmentsByCircuitId = new Map<string, WireSegment[]>()
  readonly placementsByFloorId = new Map<string, Placement[]>()
  readonly devicesByType = new Map<ProtectionDevice['type'], ProtectionDevice[]>()

  // Pre-computed labels and mappings
  readonly pointLabelByEndpointId = new Map<string, string>()
  readonly sitplanMappings: IndexedSitplanMapping[] = []

  constructor(project: ValidationProject) {
    this.indexProject(project)
    this.indexParentCircuitLinks()
    this.indexCableSegments(project)
    this.computePointLabels()
    this.computeSitplanMappings()
  }

  private indexProject(project: ValidationProject): void {
    this.indexTopLevelTrunkDevices(project)
    this.walkPanels(getProjectElectricalPanels(project))
  }

  private indexTopLevelTrunkDevices(project: ValidationProject): void {
    const installation = getProjectElectricalInstallation(project)
    const supply = installation?.mainSupply?.supplyTrunkDevices
    if (supply) {
      for (const td of supply) this.trunkDeviceById.set(td.id, td)
    }
    const ground = installation?.groundTrunkDevices
    if (ground) {
      for (const td of ground) this.trunkDeviceById.set(td.id, td)
    }
  }

  private walkPanels(panels: Panel[]): void {
    for (const panel of panels) {
      this.allPanels.push(panel)
      this.panelById.set(panel.id, panel)

      const panelCircuits: Circuit[] = []

      for (const protection of panel.protections) {
        this.allProtections.push(protection)
        this.protectionById.set(protection.id, protection)
        let bucket = this.devicesByType.get(protection.type)
        if (!bucket) {
          bucket = []
          this.devicesByType.set(protection.type, bucket)
        }
        bucket.push(protection)

        if (protection.circuits) {
          for (const circuit of protection.circuits) {
            this.indexCircuit(circuit, panel, panelCircuits)
            const arr = this.protectionsByCircuitId.get(circuit.id)
            if (arr) {
              arr.push(protection)
            } else {
              this.protectionsByCircuitId.set(circuit.id, [protection])
            }
          }
        }
      }

      for (const circuit of panel.circuits) {
        this.indexCircuit(circuit, panel, panelCircuits)
      }

      this.circuitsByPanelId.set(panel.id, panelCircuits)

      if (panel.subPanels.length > 0) this.walkPanels(panel.subPanels)
    }
  }

  private indexCircuit(circuit: Circuit, panel: Panel, panelCircuits: Circuit[]): void {
    this.allCircuits.push(circuit)
    this.circuitById.set(circuit.id, circuit)
    this.panelForCircuitId.set(circuit.id, panel)
    panelCircuits.push(circuit)

    if (circuit.trunkDevices) {
      for (const td of circuit.trunkDevices) {
        this.trunkDeviceById.set(td.id, td)
      }
    }
    for (const branch of circuit.branches ?? []) {
      for (const td of branch.branchDevices ?? []) {
        this.trunkDeviceById.set(td.id, td)
      }
    }

    for (const endpoint of circuit.endpoints) {
      this.allEndpoints.push(endpoint)
      this.endpointById.set(endpoint.id, endpoint)
      this.circuitForEndpointId.set(endpoint.id, circuit)

      for (const placement of endpoint.placements) {
        // Cache the spread once: callers receive the same enriched object
        // every time, which also reduces GC pressure during validation.
        this.placementWithEndpointById.set(placement.id, {
          ...placement,
          endpointId: endpoint.id,
        })
        if (placement.floorId) {
          const arr = this.placementsByFloorId.get(placement.floorId)
          if (arr) arr.push(placement)
          else this.placementsByFloorId.set(placement.floorId, [placement])
        }
      }
    }
  }

  private indexParentCircuitLinks(): void {
    for (const parent of this.allCircuits) {
      const subIds = parent.subCircuitIds
      if (!subIds || subIds.length === 0) continue
      for (const childId of subIds) {
        let parents = this.parentCircuitIdsByChildId.get(childId)
        if (!parents) {
          parents = new Set<string>()
          this.parentCircuitIdsByChildId.set(childId, parents)
        }
        parents.add(parent.id)
      }
    }
  }

  private indexCableSegments(project: ValidationProject): void {
    for (const segment of queryOneWireSegments(project)) {
      if (!segment.circuitId) continue
      const arr = this.cableSegmentsByCircuitId.get(segment.circuitId)
      if (arr) arr.push(segment)
      else this.cableSegmentsByCircuitId.set(segment.circuitId, [segment])
    }
  }

  /**
   * Resolve the point label for every endpoint, mirroring the historical
   * `getPointLabel` logic but in a single sweep over circuits/branches.
   */
  private computePointLabels(): void {
    for (const circuit of this.allCircuits) {
      const labelByEndpointId = new Map<string, string>()

      if (circuit.branches) {
        for (const branch of circuit.branches) {
          const branchLabel = this.resolveBranchLabel(circuit, branch)
          if (!branchLabel) continue
          for (const endpointId of branch.endpointIds) {
            // Match historical "break after first matching branch" semantics
            // by writing only if not already labelled.
            if (!labelByEndpointId.has(endpointId)) {
              labelByEndpointId.set(endpointId, branchLabel)
            }
          }
        }
      }

      for (let i = 0; i < circuit.endpoints.length; i++) {
        const endpoint = circuit.endpoints[i]!
        if (!labelByEndpointId.has(endpoint.id)) {
          // Fallback: use positional index when no branch covers this endpoint.
          labelByEndpointId.set(endpoint.id, `${circuit.code}${i + 1}`)
        }
      }

      for (const [endpointId, label] of labelByEndpointId) {
        this.pointLabelByEndpointId.set(endpointId, label)
      }
    }
  }

  private resolveBranchLabel(circuit: Circuit, branch: Branch): string | undefined {
    const trimmed = branch.label?.trim()
    if (trimmed) return trimmed
    return this.inferPointLabelFromSharedEndpointLabels(circuit, branch)
  }

  private inferPointLabelFromSharedEndpointLabels(
    circuit: Circuit,
    branch: Branch,
  ): string | undefined {
    const endpoints: Endpoint[] = []
    for (const id of branch.endpointIds) {
      const ep = this.endpointById.get(id)
      if (ep) endpoints.push(ep)
    }
    if (endpoints.length === 0) return undefined

    const labels: string[] = []
    for (const ep of endpoints) {
      const t = ep.label?.trim()
      if (t) labels.push(t)
    }
    if (labels.length === 0) return undefined

    const first = labels[0]!
    for (let i = 1; i < labels.length; i++) {
      if (labels[i] !== first) return undefined
    }

    if (first.startsWith(circuit.code)) {
      const rest = first.slice(circuit.code.length)
      if (/^\d+$/.test(rest)) return first
    }
    if (/^\d+$/.test(first)) return `${circuit.code}${first}`
    return undefined
  }

  private computeSitplanMappings(): void {
    for (const circuit of this.allCircuits) {
      for (const endpoint of circuit.endpoints) {
        if (endpoint.placements.length === 0) continue
        const pointLabel = this.pointLabelByEndpointId.get(endpoint.id)
        if (!pointLabel) continue
        for (const placement of endpoint.placements) {
          this.sitplanMappings.push({
            placementId: placement.id,
            circuitId: circuit.id,
            endpointId: endpoint.id,
            circuitPointId: pointLabel,
          })
        }
      }
    }
  }
}
