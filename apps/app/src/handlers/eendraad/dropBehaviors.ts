import { logger } from '@/lib/logger'
/**
 * Per-symbol drop behaviors registry
 *
 * Replaces the monolithic createDropHandler with focused, per-symbol handlers.
 * Each symbol type has its own small handler that knows what to create.
 */

import { useUIStore } from '@/stores/uiStore'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import {
  trackSymbolPlace,
  type EditorCanvasAnalytics,
  type SymbolPlacementMethod,
} from '@/lib/analytics/editorEventAnalytics'
import { ensureElectricalLayerOnFloor } from '@/lib/plan/floorLayers'
import {
  buildAutoSitplanPlacement,
  getViewportCenterPlanSpaceIfApplicable,
} from '@/lib/plan/autoSitplanPlacement'
import {
  resolveCircuitSitplanTargetFloorId,
  resolveSitplanTargetFloorId,
} from '@/lib/plan/sitplanTargetFloor'
import { ensureEarthingSitplanPlacement } from '@/lib/plan/earthingSitplanPlacement'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'
import { generateId, getEndpointTypeFromSymbol, getSymbolKeyFromSymbol } from '@/utils'
import { getNextAvailableCircuitCode, countPanels } from '@/utils/project'
import { applyLibraryPresetToEndpoint } from '@/utils/symbolMapping'
import { initializeBranchesIfNeeded, getCircuitBranches } from '@/lib/layout/endpointChains'
import {
  getVoltagePolesConfig,
  getDefaultProtectionProps,
  getDefaultTrunkDeviceProtectionProps,
  getProtectionCreationProps,
} from '@/lib/protectionDefaults'
import {
  PROTECTION_SYMBOL_ID_TO_TYPE,
  PROTECTION_SYMBOL_IDS,
  resolveInitialProtectionBusLabel,
} from '@/lib/protectionKind'
import { getPortDomainsForSymbol, getSymbolById, resolveSymbolPortsForWire } from '@/lib/symbols'
import { DEFAULT_ELECTRICAL_DOMAIN } from '@/types/schema'
import {
  createDefaultAcCircuitCable,
  DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
} from '@/lib/wires/circuitWireDefaults'
import {
  domoticaChildRefForEndpoint,
  domoticaChildRefForBranchInsert,
  insertDomoticaChildEndpoint,
} from '@/lib/eendraad/domoticaOutputOrdering'
import type { SymbolMetadata } from '@/lib/symbols'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type {
  Endpoint,
  Floor,
  ProtectionDevice,
  Circuit,
  Panel,
  TrunkDevice,
  TrunkDeviceType,
  ProtectionType,
  Branch,
  Placement,
} from '@/types/schema'
import type { Point, Selection } from '@/types/ui'
import type { TFunction } from 'i18next'
import { getSupplyFeedDevicesForPanel } from '@/lib/feedTopology'
import {
  refreshBranchDropTargetAfterInsert,
  isEmptyBranchWireDrop,
  resolveLayoutBranchIndex,
  resolveSmartSwitchExpansion,
  shouldApplySmartSwitchExpansion,
} from '@/handlers/eendraad/smartSwitchDrop'
import {
  computeEndpointInsertAfter,
  isPlugInAfterSocketDrop,
} from '@/lib/eendraad/endpointInsertAfter'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { clamp } from '@/lib/geometry'
import {
  getBuildingFloorsFromProject,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import { findPanelById } from '@/lib/panel/panelTree'

export type DropBehaviorProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

export interface DropBehavior {
  validTargets: Array<DropTarget['type']>
  execute: (
    target: DropTarget,
    project: DropBehaviorProject,
    symbol: SymbolMetadata,
    t: TFunction,
    callbacks: DropBehaviorCallbacks
  ) => void
}

export interface DropBehaviorCallbacks {
  addPanel: (panel: Panel, parentPanelId?: string) => void
  addProtection: (panelId: string, protection: ProtectionDevice) => void
  addCircuit: (panelId: string, circuit: Circuit, protectionId?: string) => void
  addCircuitToProtection: (panelId: string, protectionId: string, circuit: Circuit) => void
  addEndpoint: (
    circuitId: string,
    endpoint: Endpoint,
    insertAfterEndpointId?: string | null,
    branchOpts?: {
      branchId?: string | null
      branchInsertIndex?: number
      forceNewBranch?: boolean
    }
  ) => void
  addPlacement: (endpointId: string, placement: Placement) => void
  setSelection: (selection: Selection) => void
  /** Wire-canvas world position where the library symbol was dropped (e.g. for free-floating notes). */
  dropCanvasPosition?: Point
  getFloorById: (floorId: string) => {
    id: string
    layers?: string[]
    hiddenSitplanPlacementIds?: string[]
  } | null
  updateFloor: (floorId: string, updates: Partial<Floor>) => void
  getCircuitById: (circuitId: string) => Circuit | null
  getProtectionById: (protectionId: string) => ProtectionDevice | null
  addTrunkDevice: (circuitId: string, device: TrunkDevice) => void
  addSupplyTrunkDevice: (
    device: TrunkDevice,
    insertIndex?: number,
    target?: { panelId?: string; feedScope?: DropTarget['supplyFeedScope'] }
  ) => void
  addGroundTrunkDevice: (device: TrunkDevice, insertIndex?: number) => void
  ensureJunctionPanelPlacementForLabel: (label: string, floorId?: string) => void
  updateCircuit: (circuitId: string, updates: Partial<Circuit>) => void
  updateProtection: (protectionId: string, updates: Partial<ProtectionDevice>) => void
  updateInstallation: (
    updates: Partial<NonNullable<ReturnType<typeof projectInstallation>>>
  ) => void
  moveCircuitOnMainBus: (panelId: string, circuitId: string, direction: 'left' | 'right') => void
  moveCircuitToSecondaryBus: (
    panelId: string,
    parentCircuitId: string,
    circuitId: string,
    insertIndex: number
  ) => void
  deleteEndpoint: (endpointId: string) => void
  addEendraadNote: (note: {
    id: string
    text: string
    fontSize: number
    pos: Point
    panelId?: string
  }) => void
  /** Called when a drop is rejected (e.g. domain mismatch for conversion components) */
  onDropRejected?: (message: string) => void
}

function getOrderedTrunkDevices(circuit: Circuit): TrunkDevice[] {
  // Stable sort by trunkPosition; for equal positions keep array order.
  return [...(circuit.trunkDevices ?? [])].sort(
    (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
  )
}

function projectPanels(project: DropBehaviorProject): Panel[] {
  const runtimePanels = (project as { panels?: Panel[] }).panels
  if (runtimePanels) return runtimePanels
  return getElectricalPanelsFromProject(project)
}

function projectInstallation(project: DropBehaviorProject) {
  const runtimeInstallation = (
    project as { installation?: ReturnType<typeof getElectricalInstallationFromProject> }
  ).installation
  if (runtimeInstallation) return runtimeInstallation
  return getElectricalInstallationFromProject(project)
}

function getSupplyDevicesForDropTarget(
  target: DropTarget,
  project: DropBehaviorProject
): TrunkDevice[] {
  const panels = projectPanels(project)
  const installation = projectInstallation(project)
  const targetPanel = target.panelId ? findPanelById(panels, target.panelId) : null
  const panelSupplyCircuit = targetPanel?.circuits?.find((c) => c.code === 'PANEL')
  const panelSupply = [...(panelSupplyCircuit?.trunkDevices ?? [])].sort(
    (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
  )
  if (panelSupply.length > 0 || (targetPanel && !targetPanel.isMain)) {
    return panelSupply
  }
  if (targetPanel?.isMain && target.panelId) {
    if (!installation) return []
    return getSupplyFeedDevicesForPanel(
      installation,
      panels,
      target.panelId,
      target.supplyFeedScope ?? 'shared'
    )
  }
  return installation?.mainSupply?.supplyTrunkDevices ?? []
}

function getCircuitTrunkPositionForDrop(target: DropTarget, circuit: Circuit): number {
  // Per-segment drop target on vertical trunk wire takes priority.
  if (typeof target.circuitTrunkSegmentIndex === 'number') {
    const ordered = getOrderedTrunkDevices(circuit)
    const segmentIndex = target.circuitTrunkSegmentIndex
    if (segmentIndex <= 0 || ordered.length === 0) return 0
    const prevDevice = ordered[Math.min(segmentIndex - 1, ordered.length - 1)]
    return prevDevice?.trunkPosition ?? 0
  }

  // Fallback legacy behavior: infer by nearest branch endpoint.
  if (target.insertAfterEndpointId) {
    const branches = getCircuitBranches(circuit)
    for (let i = 0; i < branches.length; i++) {
      const branch = branches[i]
      if (branch?.some((ep) => ep.id === target.insertAfterEndpointId)) {
        return i + 1
      }
    }
  }
  return 0
}

/** Get the wire domain at a drop target. Used to validate conversion component placement. */
function getWireDomainAtDropTarget(
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: Pick<DropBehaviorCallbacks, 'getCircuitById'>
): typeof DEFAULT_ELECTRICAL_DOMAIN {
  if (target.wireDomain) {
    return target.wireDomain as typeof DEFAULT_ELECTRICAL_DOMAIN
  }
  const AC = 'AC' as const

  if (target.type === 'supplyWire') {
    const supply = getSupplyDevicesForDropTarget(target, project)
    const insertIndex = target.supplyDeviceInsertIndex ?? 0
    if (insertIndex === 0) return AC // Mains is AC
    let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
    for (let i = 0; i < insertIndex; i++) {
      const prevDevice = supply[i]
      if (!prevDevice) continue
      const resolved = resolveSymbolPortsForWire(prevDevice.symbol, domain)
      if (resolved.matched && resolved.oppositePortDomain) {
        domain = resolved.oppositePortDomain
      }
    }
    return domain
  }

  if (target.type === 'protection' && target.protectionId) {
    const protection = findProtectionInProject(projectPanels(project), target.protectionId)
    const circuitId = protection?.circuits?.[0]?.id
    if (circuitId) {
      const circuit = callbacks.getCircuitById(circuitId)
      if (circuit?.trunkDevices?.length) {
        const sorted = [...circuit.trunkDevices].sort(
          (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
        )
        let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
        for (const td of sorted) {
          const resolved = resolveSymbolPortsForWire(td.symbol, domain)
          if (resolved.matched && resolved.oppositePortDomain) {
            domain = resolved.oppositePortDomain
          }
        }
        return domain
      }
    }
    return AC // MCB output or empty circuit
  }
  if (target.type === 'mainBus' || target.type === 'rcd') return AC

  if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
    const circuit = callbacks.getCircuitById(target.circuitId)
    if (!circuit) return AC
    const trunkDevices = getOrderedTrunkDevices(circuit)

    // Segment-aware domain check for per-segment vertical trunk hitboxes.
    if (typeof target.circuitTrunkSegmentIndex === 'number') {
      const segmentIndex = target.circuitTrunkSegmentIndex
      if (segmentIndex <= 0 || trunkDevices.length === 0) return AC
      let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
      const endExclusive = Math.min(segmentIndex, trunkDevices.length)
      for (let i = 0; i < endExclusive; i++) {
        const prevDevice = trunkDevices[i]
        if (!prevDevice) continue
        const resolved = resolveSymbolPortsForWire(prevDevice.symbol, domain)
        if (resolved.matched && resolved.oppositePortDomain) {
          domain = resolved.oppositePortDomain
        }
      }
      return domain
    }

    const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)
    if (trunkPosition === 0) return AC // MCB output is AC
    const prevDevices = trunkDevices.filter((d) => (d.trunkPosition ?? 0) < trunkPosition)
    let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
    for (const prevDevice of prevDevices) {
      const resolved = resolveSymbolPortsForWire(prevDevice.symbol, domain)
      if (resolved.matched && resolved.oppositePortDomain) {
        domain = resolved.oppositePortDomain
      }
    }
    return domain
  }

  if (target.type === 'endpoint' || (target.type === 'circuit' && target.branchEndpoints?.length)) {
    const circuitId = target.circuitId
    if (!circuitId) return AC
    const circuit = callbacks.getCircuitById(circuitId)
    if (!circuit) return AC

    // Base branch domain starts at the circuit trunk output domain.
    const trunkDevices = circuit.trunkDevices ?? []
    const sorted = [...trunkDevices].sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
    let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
    for (const td of sorted) {
      const resolved = resolveSymbolPortsForWire(td.symbol, domain)
      if (resolved.matched && resolved.oppositePortDomain) {
        domain = resolved.oppositePortDomain
      }
    }

    // If this drop is on a branch wire/endpoint, include upstream in-branch symbols
    // (e.g. rectifier placed on branch) up to the insertion point.
    const branchIds = target.branchEndpoints ?? []
    if (branchIds.length > 0) {
      let upstreamIds: string[] = []
      if (target.insertAfterEndpointId === null) {
        upstreamIds = []
      } else if (typeof target.insertAfterEndpointId === 'string') {
        const idx = branchIds.indexOf(target.insertAfterEndpointId)
        upstreamIds = idx >= 0 ? branchIds.slice(0, idx + 1) : []
      } else {
        // No explicit insertion cursor in branch: treat as append at end.
        upstreamIds = [...branchIds]
      }

      for (const endpointId of upstreamIds) {
        const endpoint = circuit.endpoints.find((ep: Endpoint) => ep.id === endpointId)
        if (!endpoint?.symbol) continue
        const resolved = resolveSymbolPortsForWire(endpoint.symbol, domain)
        if (resolved.matched && resolved.oppositePortDomain) {
          domain = resolved.oppositePortDomain
        }
      }
    }
    return domain
  }

  return AC
}

/** Returns sorted trunk devices that are upstream of the drop point on a circuit wire/branch. */
function getUpstreamCircuitTrunkDevicesForDrop(
  target: DropTarget,
  circuit: Circuit
): TrunkDevice[] {
  const sorted = getOrderedTrunkDevices(circuit)
  if (!sorted.length) return []

  if (target.type === 'circuit' && typeof target.circuitTrunkSegmentIndex === 'number') {
    const endExclusive = clamp(target.circuitTrunkSegmentIndex, 0, sorted.length)
    return sorted.slice(0, endExclusive)
  }

  if (target.type === 'circuit' && !target.branchEndpoints?.length) {
    const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)
    if (trunkPosition === 0) return []
    return sorted.filter((d) => (d.trunkPosition ?? 0) < trunkPosition)
  }

  // Endpoint/protection targets attach after all existing trunk devices on that circuit.
  return sorted
}

/** True when an upstream trunk conversion device already exists before this drop point. */
function hasUpstreamConversionDeviceForDrop(target: DropTarget, circuit: Circuit): boolean {
  const upstream = getUpstreamCircuitTrunkDevicesForDrop(target, circuit)
  return upstream.some((device) => device.type === 'conversion')
}

function addCircuitTrunkDeviceAtDrop(
  target: DropTarget,
  _circuit: Circuit,
  trunkDevice: TrunkDevice,
  callbacks: DropBehaviorCallbacks
): void {
  if (!target.circuitId) return
  callbacks.addTrunkDevice(target.circuitId, trunkDevice)
  const updatedCircuit = callbacks.getCircuitById(target.circuitId)
  const list = updatedCircuit?.trunkDevices ? [...updatedCircuit.trunkDevices] : null
  if (!list) return
  const currentIdx = list.findIndex((d) => d.id === trunkDevice.id)
  if (currentIdx === -1) return
  list.splice(currentIdx, 1)
  const segIndex =
    typeof target.circuitTrunkSegmentIndex === 'number'
      ? target.circuitTrunkSegmentIndex
      : list.length
  const insertIdx = clamp(segIndex, 0, list.length)
  list.splice(insertIdx, 0, trunkDevice)
  callbacks.updateCircuit(target.circuitId, { trunkDevices: list })
}

/** Returns true if the symbol is a conversion component that requires domain validation. */
function isConversionSymbol(symbol: SymbolMetadata): boolean {
  return ['transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(symbol.id)
}

/** Returns true if domain at drop target matches symbol's required input domain; calls onDropRejected if not. */
function checkDomainForConversion(
  target: DropTarget,
  project: DropBehaviorProject,
  symbol: SymbolMetadata,
  t: TFunction,
  callbacks: DropBehaviorCallbacks
): boolean {
  if (!isConversionSymbol(symbol)) return true
  const requiredPorts = getPortDomainsForSymbol(symbol.id)
  const wireDomain = getWireDomainAtDropTarget(target, project, callbacks)
  const resolved = resolveSymbolPortsForWire(symbol.id, wireDomain)
  if (resolved.matched) return true
  const message = t('wires.domainMismatchDrop', {
    defaultValue:
      '{{component}} has no {{wireDomain}} compatible port (ports: {{portA}} / {{portB}}).',
    component: symbol.name,
    wireDomain,
    portA: requiredPorts[0],
    portB: requiredPorts[1],
  })
  callbacks.onDropRejected?.(message)
  return false
}

/**
 * Generic protection behavior for MCB, FUSE, MAIN_SWITCH, and SPD
 * These all create a protection device + circuit in the same way,
 * just with different types and default properties.
 */
const protectionBehavior: DropBehavior = {
  validTargets: ['mainBus', 'rcd', 'circuit', 'supplyWire'],
  execute: (target, project, symbol, _t, callbacks) => {
    // If dropped on supply wire, add as a supply trunk device
    if (target.type === 'supplyWire') {
      addSupplyTrunkDevice(symbol, target, project, callbacks)
      return
    }

    const panel = findPanelForTarget(project, target)
    if (!panel) return

    const protectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id] ?? 'MCB'

    const autoCircuitCode = resolveInitialProtectionBusLabel(
      protectionType,
      getNextAvailableCircuitCode(project, panel.id)
    )
    const targetedCircuit =
      target.type === 'circuit' && target.circuitId
        ? callbacks.getCircuitById(target.circuitId)
        : null
    const targetedProtection =
      targetedCircuit && target.circuitId
        ? findProtectionByCircuitIdInProject(projectPanels(project), target.circuitId)
        : null
    if (targetedCircuit && targetedProtection?.directPanelFeeder && targetedProtection.subPanelId) {
      callbacks.updateProtection(targetedProtection.id, {
        type: protectionType,
        label: autoCircuitCode,
        ...getProtectionCreationProps(project, protectionType),
        directPanelFeeder: undefined,
      })
      callbacks.updateCircuit(targetedCircuit.id, { code: autoCircuitCode })
      return
    }

    const circuitId = generateId()
    const protectionId = generateId()
    const defaults = getProtectionCreationProps(project, protectionType)
    const protection: ProtectionDevice = {
      id: protectionId,
      type: protectionType,
      label: autoCircuitCode,
      circuits: [],
      ...defaults,
    }

    callbacks.addProtection(panel.id, protection)

    const circuit: Circuit = {
      id: circuitId,
      code: autoCircuitCode,
      kind: 'other',
      cable: createDefaultAcCircuitCable(),
      endpoints: [],
      ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
    }

    // Add circuit to new protection (single source of truth)
    callbacks.addCircuit(panel.id, circuit, protectionId)

    if (target.type === 'rcd' && target.protectionId) {
      // Also register under the RCD for grouping (via store action, not direct mutation)
      callbacks.addCircuitToProtection(panel.id, target.protectionId, circuit)
    } else if (
      target.type === 'circuit' &&
      target.circuitId &&
      !(typeof target.secondaryBusInsertIndex === 'number' && target.secondaryBusInsertIndex >= 0)
    ) {
      // Record nested relationship — ID only, no duplicated object
      const parentCircuit = callbacks.getCircuitById(target.circuitId)
      if (parentCircuit) {
        const insertedBetween = target.insertBeforeNestedCircuitId
          ? insertProtectionBetweenNestedCircuits(
              parentCircuit,
              circuitId,
              target.insertBeforeNestedCircuitId,
              callbacks
            )
          : false
        if (!insertedBetween) {
          moveParentContentToSubCircuit(
            parentCircuit,
            target.circuitId,
            circuitId,
            protectionId,
            panel,
            callbacks
          )
        }
      }
    }

    // When dropped on the main bus, reposition the new circuit/protection to
    // match the cursor segment between existing bus items.
    if (target.type === 'mainBus' && typeof target.mainBusInsertIndex === 'number') {
      const panelForReorder = findPanelForTarget(project, target)
      if (panelForReorder) {
        const beforeCount = target.mainBusItemCount ?? 0
        const totalAfter = beforeCount + 1
        const desiredIndex = clamp(target.mainBusInsertIndex, 0, totalAfter - 1)
        const currentIndex = totalAfter - 1 // Newly added item starts at the end
        const movesLeft = Math.max(0, currentIndex - desiredIndex)
        for (let i = 0; i < movesLeft; i++) {
          callbacks.moveCircuitOnMainBus(panelForReorder.id, circuitId, 'left')
        }
      }
    }

    // When dropped on a secondary bus (nested circuits), place the new
    // subcircuit directly at the resolved slot. This is more reliable than
    // appending and replaying left/right swaps when the bus has many children.
    if (
      target.type === 'circuit' &&
      target.circuitId &&
      typeof target.secondaryBusInsertIndex === 'number' &&
      target.secondaryBusInsertIndex >= 0
    ) {
      callbacks.moveCircuitToSecondaryBus(
        panel.id,
        target.circuitId,
        circuitId,
        target.secondaryBusInsertIndex
      )
    }
  },
}

// Alias for backwards compatibility — kept for drop behavior registry lookup by symbol id
export const mcbBehavior = protectionBehavior

/**
 * RCD/RCBO drop behavior — creates protection + circuit, just like MCB.
 * All protection devices share the same base flow: create protection, create circuit, link them.
 */
const rcdBehavior: DropBehavior = {
  validTargets: ['mainBus', 'rcd', 'circuit', 'supplyWire'],
  execute: (target, project, symbol, _t, callbacks) => {
    // If dropped on supply wire, add as a supply trunk device
    if (target.type === 'supplyWire') {
      addSupplyTrunkDevice(symbol, target, project, callbacks)
      return
    }

    const panel = findPanelForTarget(project, target)
    if (!panel) return

    const isRcbo = symbol.id === 'rcbo'
    const protectionType = isRcbo ? 'RCBO' : 'RCD'
    const autoCircuitCode = resolveInitialProtectionBusLabel(
      protectionType,
      getNextAvailableCircuitCode(project, panel.id)
    )

    const circuitId = generateId()
    const protectionId = generateId()
    const defaults = getProtectionCreationProps(project, protectionType)
    const protection: ProtectionDevice = {
      id: protectionId,
      type: protectionType,
      label: autoCircuitCode,
      circuits: [],
      ...defaults,
    }

    callbacks.addProtection(panel.id, protection)

    const circuit: Circuit = {
      id: circuitId,
      code: autoCircuitCode,
      kind: 'other',
      cable: createDefaultAcCircuitCable(),
      endpoints: [],
      ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
    }

    // Add circuit to new protection (single source of truth)
    callbacks.addCircuit(panel.id, circuit, protectionId)

    if (target.type === 'rcd' && target.protectionId) {
      // Also register under the existing RCD for grouping (via store action)
      callbacks.addCircuitToProtection(panel.id, target.protectionId, circuit)
    } else if (
      target.type === 'circuit' &&
      target.circuitId &&
      !(typeof target.secondaryBusInsertIndex === 'number' && target.secondaryBusInsertIndex >= 0)
    ) {
      // Record nested relationship — ID only, no duplicated object
      const parentCircuit = callbacks.getCircuitById(target.circuitId)
      if (parentCircuit) {
        const insertedBetween = target.insertBeforeNestedCircuitId
          ? insertProtectionBetweenNestedCircuits(
              parentCircuit,
              circuitId,
              target.insertBeforeNestedCircuitId,
              callbacks
            )
          : false
        if (!insertedBetween) {
          moveParentContentToSubCircuit(
            parentCircuit,
            target.circuitId,
            circuitId,
            protectionId,
            panel,
            callbacks
          )
        }
      }
    }

    // When dropped on the main bus, reposition the new RCD/RCBO to the
    // correct segment along the bus based on cursor position.
    if (target.type === 'mainBus' && typeof target.mainBusInsertIndex === 'number') {
      const panelForReorder = findPanelForTarget(project, target)
      if (panelForReorder) {
        const beforeCount = target.mainBusItemCount ?? 0
        const totalAfter = beforeCount + 1
        const desiredIndex = clamp(target.mainBusInsertIndex, 0, totalAfter - 1)
        const currentIndex = totalAfter - 1
        const movesLeft = Math.max(0, currentIndex - desiredIndex)
        for (let i = 0; i < movesLeft; i++) {
          callbacks.moveCircuitOnMainBus(panelForReorder.id, circuitId, 'left')
        }
      }
    }

    // Same exact-slot placement as MCB/fuse drops for nested secondary buses.
    if (
      target.type === 'circuit' &&
      target.circuitId &&
      typeof target.secondaryBusInsertIndex === 'number' &&
      target.secondaryBusInsertIndex >= 0
    ) {
      callbacks.moveCircuitToSecondaryBus(
        panel.id,
        target.circuitId,
        circuitId,
        target.secondaryBusInsertIndex
      )
    }
  },
}

/**
 * When dropping a protection device onto an existing circuit's trunk,
 * move the parent circuit's endpoints, branches, and trunk devices
 * into the newly created subcircuit.
 *
 * Before: A { endpoints, branches }
 * After:  A { subCircuitIds: [B] }  →  B { endpoints, branches }
 *
 * Also handles sub-panel connections: if the parent's protection has
 * a subPanelId (feeds a secondary panel), that link is transferred
 * to the new child protection so the panel symbol follows the content.
 *
 * Without this, both parent and subcircuit would draw on top of each other.
 */
function moveParentContentToSubCircuit(
  parentCircuit: Circuit,
  parentCircuitId: string,
  newSubCircuitId: string,
  newProtectionId: string,
  panel: Panel,
  callbacks: DropBehaviorCallbacks
): void {
  const hasEndpoints = parentCircuit.endpoints.length > 0
  const hasBranches = (parentCircuit.branches?.length ?? 0) > 0
  const hasTrunkDevices = (parentCircuit.trunkDevices?.length ?? 0) > 0

  if (hasEndpoints || hasBranches || hasTrunkDevices) {
    // Move parent's content to the new subcircuit
    const updates: Partial<Circuit> = {}
    if (hasEndpoints) updates.endpoints = [...parentCircuit.endpoints]
    if (hasBranches) updates.branches = [...parentCircuit.branches!]
    if (hasTrunkDevices) updates.trunkDevices = [...parentCircuit.trunkDevices!]
    callbacks.updateCircuit(newSubCircuitId, updates)

    // Clear parent and register the new subcircuit
    callbacks.updateCircuit(parentCircuitId, {
      endpoints: [],
      branches: [],
      trunkDevices: [],
      subCircuitIds: [...(parentCircuit.subCircuitIds || []), newSubCircuitId],
    })
  } else {
    // No content to move — just register the subcircuit
    callbacks.updateCircuit(parentCircuitId, {
      subCircuitIds: [...(parentCircuit.subCircuitIds || []), newSubCircuitId],
    })
  }

  // Transfer subPanelId from parent's protection to new child protection.
  // If the parent MCB was feeding a secondary panel, the new MCB now sits
  // between them, so the new MCB should be the one linked to the sub-panel.
  const parentProtection = panel.protections.find((p) =>
    p.circuits?.some((c) => c.id === parentCircuitId)
  )
  if (parentProtection?.subPanelId) {
    const subPanelId = parentProtection.subPanelId
    // Remove from parent protection, assign to new child protection
    callbacks.updateProtection(parentProtection.id, { subPanelId: undefined })
    callbacks.updateProtection(newProtectionId, { subPanelId })
  }
}

function insertProtectionBetweenNestedCircuits(
  parentCircuit: Circuit,
  newCircuitId: string,
  existingChildCircuitId: string,
  callbacks: Pick<DropBehaviorCallbacks, 'updateCircuit'>
): boolean {
  const childIds = parentCircuit.subCircuitIds ?? []
  const childIndex = childIds.indexOf(existingChildCircuitId)
  if (childIndex < 0) return false

  const nextParentChildren = [...childIds]
  nextParentChildren.splice(childIndex, 1, newCircuitId)
  callbacks.updateCircuit(parentCircuit.id, { subCircuitIds: nextParentChildren })
  callbacks.updateCircuit(newCircuitId, { subCircuitIds: [existingChildCircuitId] })
  return true
}

/**
 * True if the given circuit feeds a sub-panel via its protection device.
 * When this is the case the circuit is terminal: no additional endpoints
 * or trunk devices should be added on that circuit.
 */
function circuitFeedsSubPanel(project: DropBehaviorProject, circuitId: string): boolean {
  const stack: Panel[] = [...projectPanels(project)]
  while (stack.length) {
    const panel = stack.pop()!
    for (const protection of panel.protections ?? []) {
      if (protection.subPanelId && protection.circuits?.some((c) => c.id === circuitId)) {
        return true
      }
    }
    if (panel.subPanels?.length) {
      stack.push(...panel.subPanels)
    }
  }
  return false
}

/**
 * Next unique label for a domotica output child: base.1, base.2, … (base = parent label, e.g. D1).
 * Uses a single sequence for all children of this parent (control and output wires), so the first
 * control switch is D1.1 and the first output light is D1.2, not both D1.1.
 */
function getNextDomoticaChildLabel(
  circuit: Circuit,
  parent: Endpoint,
  _group: 'endpoint' | 'control',
  outputIndex?: number
): string {
  const base = parent.label?.trim() || `${circuit.code}1`
  let rowLabelIndex = 1
  const scanRows = (ids: string[] | undefined, rowGroup: 'endpoint' | 'control'): string | null => {
    for (let index = 0; index < (ids?.length ?? 0); index++) {
      const id = ids?.[index]
      if (!id) continue
      const label = `${base}.${rowLabelIndex}`
      if (rowGroup === 'endpoint' && index === outputIndex) return label
      rowLabelIndex += 1
    }
    return null
  }
  return (
    scanRows(parent.domoticaProps?.endpointChildEndpointIds, 'endpoint') ??
    `${base}.${rowLabelIndex}`
  )
}

/**
 * Endpoint drop behavior (sockets, lights, in-between devices).
 * - Actual endpoints: one per branch, always at the end; dropping a second creates a new branch.
 * - In-between (switches, relay, domotica, energy_meter): any number, always between trunk and endpoint.
 */
const endpointBehavior: DropBehavior = {
  validTargets: ['endpoint', 'circuit', 'protection'],
  execute: (target, project, symbol, _t, callbacks) => {
    let circuitId = target.circuitId
    if (!circuitId && target.type === 'protection' && target.protectionId) {
      const protection = callbacks.getProtectionById(target.protectionId)
      circuitId = protection?.circuits?.[0]?.id
    }
    if (!circuitId) return

    // Circuits that feed a secondary panel are terminal: the MCB output
    // goes exclusively to the sub‑panel, so no extra endpoints may be added.
    if (circuitFeedsSubPanel(project, circuitId)) {
      return
    }

    const circuit = callbacks.getCircuitById(circuitId)
    if (!circuit) return

    initializeBranchesIfNeeded(circuit)

    const endpointId = generateId()
    const endpointType = getEndpointTypeFromSymbol(symbol)
    if (!endpointType) return
    const symbolKey = getSymbolKeyFromSymbol(symbol)

    const isDomoticaOutputDrop = !!target.domoticaOutput && !!target.endpointId
    const isDomoticaChildReplace =
      target.domoticaChildDropIntent === 'replace' && !!target.endpointId

    const endpoint: Endpoint = {
      id: endpointId,
      type: endpointType,
      label: '',
      symbol: symbolKey,
      placements: [],
    }

    if (isDomoticaOutputDrop) {
      const parent = circuit.endpoints.find((e: Endpoint) => e.id === target.endpointId)
      if (parent) {
        endpoint.label = getNextDomoticaChildLabel(
          circuit,
          parent,
          'endpoint',
          target.domoticaOutput!.index
        )
      }
      endpoint.domoticaChildProps = {
        parentEndpointId: target.endpointId!,
        outputGroup: 'endpoint',
        outputIndex: target.domoticaOutput!.index,
      }
    }

    // HVAC furnace presets: apply default hvacProps based on library preset ID.
    if (symbol.id === 'furnace_heatpump') {
      endpoint.hvacProps = {
        energySource: 'electricity',
        hvacType: 'heat_exchange',
        hvacFunction: 'heat_cool',
      }
    } else if (symbol.id === 'furnace_gas') {
      endpoint.hvacProps = {
        energySource: 'gas_atmospheric',
        hvacType: 'boiler',
        hvacFunction: 'heat',
      }
    } else if (symbol.id === 'furnace_oil') {
      endpoint.hvacProps = {
        energySource: 'liquid',
        hvacType: 'boiler',
        hvacFunction: 'heat',
      }
    } else if (symbol.id === 'furnace_pellets') {
      endpoint.hvacProps = {
        energySource: 'solid',
        hvacType: 'cogeneration',
        hvacFunction: 'heat',
      }
    }

    // DC generation/storage presets (plugIn synced from branch layout in projectStore)
    if (symbol.id === 'solar_panel') {
      endpoint.solarPanelProps = {
        wattageW: 1000,
      }
    } else if (symbol.id === 'battery') {
      endpoint.batteryProps = {
        voltageV: 48,
        capacityKWh: 5,
      }
    }

    applyLibraryPresetToEndpoint(symbol, endpoint)

    const hadAnyEndpointsBeforeAdd = (circuit.endpoints?.length ?? 0) > 0
    const { insertAfterEndpointId, createNewBranch } = computeEndpointInsertAfter(
      target,
      circuit,
      symbol
    )

    if (!isDomoticaOutputDrop) {
      const chainRef = isDomoticaChildReplace
        ? domoticaChildRefForEndpoint(circuit, target.endpointId)
        : domoticaChildRefForBranchInsert(circuit, insertAfterEndpointId, target.branchEndpoints)
      if (chainRef) {
        endpoint.domoticaChildProps = chainRef
        const parent = circuit.endpoints.find((e: Endpoint) => e.id === chainRef.parentEndpointId)
        if (parent) {
          endpoint.label = getNextDomoticaChildLabel(
            circuit,
            parent,
            chainRef.outputGroup,
            chainRef.outputIndex
          )
        }
      }
    }

    // Initialize branches if needed so the layout engine has structure.
    const branches = circuit.branches?.length
      ? circuit.branches
      : initializeBranchesIfNeeded(circuit)

    // Branch point labels are synced after addEndpoint / updateCircuit (sequential A1…n in branch order).
    callbacks.addEndpoint(circuitId, endpoint, insertAfterEndpointId)

    if (isDomoticaChildReplace && target.endpointId && target.endpointId !== endpointId) {
      callbacks.deleteEndpoint(target.endpointId)
    }

    // Domotica output drop: insert a new root child at the chosen output row.
    // Existing occupants shift down; chained children stay with their root row.
    if (isDomoticaOutputDrop && target.endpointId) {
      const circuitAfterAdd = callbacks.getCircuitById(circuitId)
      if (circuitAfterAdd) {
        const nextCircuit = insertDomoticaChildEndpoint(
          circuitAfterAdd,
          endpointId,
          target.endpointId,
          'endpoint',
          target.domoticaOutput!.index
        )
        if (nextCircuit) {
          callbacks.updateCircuit(circuitId, {
            endpoints: nextCircuit.endpoints,
            branches: nextCircuit.branches,
          })
        }
      }
    }

    if (isDomoticaChildReplace) {
      // addEndpoint inserted the replacement next to the target; deleteEndpoint removed
      // the old target from endpoints, branches, and parent slot refs.
    } else if (isDomoticaOutputDrop) {
      // Domotica output insertion is fully handled above by insertDomoticaChildEndpoint.
      // Do not run generic branch bookkeeping with stale branch data.
    } else if (createNewBranch) {
      // Create a new branch with this endpoint — labels synced by updateCircuit.
      callbacks.updateCircuit(circuitId, {
        branches: [...branches, { id: generateId(), label: '', endpointIds: [endpointId] }],
      })
    } else if (
      target.branchEndpoints !== undefined &&
      target.branchEndpoints.length === 0 &&
      isEmptyBranchWireDrop(target, circuitId)
    ) {
      const branchIndex = resolveLayoutBranchIndex(target.branchId, circuitId)
      const storedBranches = branches.length ? branches : initializeBranchesIfNeeded(circuit)
      const targetBranch = branchIndex !== null ? storedBranches[branchIndex] : undefined
      if (targetBranch && !targetBranch.endpointIds.includes(endpointId)) {
        const updatedIds = [...targetBranch.endpointIds]
        if (typeof insertAfterEndpointId === 'string') {
          const idx = updatedIds.indexOf(insertAfterEndpointId)
          if (idx >= 0) {
            updatedIds.splice(idx + 1, 0, endpointId)
          } else {
            updatedIds.push(endpointId)
          }
        } else {
          updatedIds.unshift(endpointId)
        }
        const updatedBranches = storedBranches.map((b: Branch) =>
          b.id === targetBranch.id ? { ...b, endpointIds: updatedIds } : b
        )
        callbacks.updateCircuit(circuitId, { branches: updatedBranches })
      }
    } else if (target.branchEndpoints !== undefined && target.branchEndpoints.length > 0) {
      // Adding to an existing branch — find it in stored or inferred branches and update.
      // Always persist branches so multi-branch circuits keep correct assignment
      // (without stored branches, groupEndpointsIntoBranches re-infers linearly
      // and would assign in-between devices to the wrong branch).
      const targetBranch = branches.find((b: Branch) =>
        b.endpointIds.some((id: string) => target.branchEndpoints!.includes(id))
      )
      if (targetBranch && !targetBranch.endpointIds.includes(endpointId)) {
        const updatedIds = [...targetBranch.endpointIds]
        if (typeof insertAfterEndpointId === 'string') {
          const idx = updatedIds.indexOf(insertAfterEndpointId)
          if (idx >= 0) {
            updatedIds.splice(idx + 1, 0, endpointId)
          } else {
            updatedIds.push(endpointId)
          }
        } else {
          // null or undefined = insert at start of branch
          updatedIds.unshift(endpointId)
        }
        const updatedBranches = branches.map((b: Branch) =>
          b.id === targetBranch.id ? { ...b, endpointIds: updatedIds } : b
        )
        callbacks.updateCircuit(circuitId, { branches: updatedBranches })
      }
    } else if (
      target.branchEndpoints === undefined ||
      (target.branchEndpoints.length === 0 && !isEmptyBranchWireDrop(target, circuitId))
    ) {
      // No branch wire context (trunk / MCB / protection) — create a new branch when needed
      // For the very first endpoint on a fresh circuit, `addEndpoint()` already creates
      // the canonical first branch and label (e.g. P1). Do not run a second naming pass.
      if (!hadAnyEndpointsBeforeAdd) {
        // Keep the branch + label assigned by addEndpoint as the single source of truth.
      } else {
        const circuitAfterAdd = callbacks.getCircuitById(circuitId)
        if (!circuitAfterAdd) {
          callbacks.updateCircuit(circuitId, {
            branches: [
              ...branches,
              { id: generateId(), label: endpoint.label, endpointIds: [endpointId] },
            ],
          })
        } else {
          // `store.addEndpoint()` keeps branch endpointIds in sync while inserting the new
          // endpoint. When this drop is intended to create a *new* branch, we must ensure
          // the new endpoint is not accidentally inserted into an existing branch first
          // (which would reuse the old branch label, e.g. 05 instead of 06).
          const branchesSansNewEndpoint = (circuitAfterAdd.branches ?? [])
            .map((b: Branch) => ({
              ...b,
              endpointIds: (b.endpointIds ?? []).filter((id: string) => id !== endpointId),
            }))
            .filter((b: Branch) => (b.endpointIds ?? []).length > 0)

          callbacks.updateCircuit(circuitId, {
            branches: [
              ...branchesSansNewEndpoint,
              { id: generateId(), label: '', endpointIds: [endpointId] },
            ],
          })
        }
      }
    }

    // Global selection (uiStore): eendraad, sitplan, panel, and inspectors all react to this.
    callbacks.setSelection({ type: 'endpoint', ids: [endpointId] })

    // Auto-place new sitplan symbol when it doesn't yet exist on the plan.
    // Layout rule:
    // - Start from a common origin.
    // - One horizontal row per circuit (grouped by circuit).
    // - New symbol in same circuit goes to the right of existing ones on that row.
    // - New circuit gets a new row "above" the existing rows.
    //
    // Floor + layer: match plan canvas drops (plan uses active floor + layers[0] ?? 'electrical').
    // Do not require floors[0].layers — many floors omit `layers` in data; skipping auto-place
    // left endpoints invisible on every sitplan floor (bug).
    // Do not create placements for one-line-only or explicitly excluded symbols.
    if (!canSymbolAppearOnSituationPlan(symbol.id)) {
      return
    }

    const currentProject = project
    const activeFloorId = resolveCircuitSitplanTargetFloorId(
      currentProject,
      useUIStore.getState().activeFloorId,
      circuitId
    )

    if (activeFloorId && currentProject) {
      const floorEntity = getBuildingFloorsFromProject(currentProject).find(
        (f) => f.id === activeFloorId
      )
      if (!floorEntity) return
      if ('layers' in floorEntity) ensureElectricalLayerOnFloor(floorEntity)
      const uiSnap = useUIStore.getState()
      const preferredPlanPos =
        getViewportCenterPlanSpaceIfApplicable(
          uiSnap.viewportLayout,
          uiSnap.planCanvasViewportPx,
          uiSnap.activeFloorId,
          activeFloorId,
          uiSnap.planView
        ) ?? undefined
      const placement = buildAutoSitplanPlacement(currentProject, {
        circuitId,
        floorId: activeFloorId,
        placementId: generateId(),
        ...(preferredPlanPos ? { preferredPlanPos } : {}),
      })
      if (placement) {
        callbacks.addPlacement(endpointId, placement)
      }
    }
  },
}

/**
 * Switch drop behavior — expands two-way / cross drops on switch-free branches.
 */
const switchBehavior: DropBehavior = {
  validTargets: ['endpoint', 'circuit', 'protection'],
  execute: (target, project, symbol, t, callbacks) => {
    const expansion = resolveSmartSwitchExpansion(symbol)
    if (!expansion) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }

    let circuitId = target.circuitId
    if (!circuitId && target.type === 'protection' && target.protectionId) {
      const protection = callbacks.getProtectionById(target.protectionId)
      circuitId = protection?.circuits?.[0]?.id
    }
    if (!circuitId) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }

    const circuit = callbacks.getCircuitById(circuitId)
    if (!circuit || !shouldApplySmartSwitchExpansion(target, circuit, symbol)) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }

    let workingTarget = target
    let lastAddedEndpointId: string | undefined
    let primaryEndpointId: string | undefined

    for (let i = 0; i < expansion.symbols.length; i++) {
      const sym = expansion.symbols[i]!
      const trackingCallbacks: DropBehaviorCallbacks = {
        ...callbacks,
        addEndpoint: (cid, endpoint, insertAfter, branchOpts) => {
          lastAddedEndpointId = endpoint.id
          callbacks.addEndpoint(cid, endpoint, insertAfter, branchOpts)
        },
        setSelection: () => {},
      }

      endpointBehavior.execute(workingTarget, project, sym, t, trackingCallbacks)

      if (!lastAddedEndpointId) continue
      if (i === expansion.primaryIndex) {
        primaryEndpointId = lastAddedEndpointId
      }

      const circuitAfter = callbacks.getCircuitById(circuitId)
      if (!circuitAfter) break
      workingTarget = refreshBranchDropTargetAfterInsert(
        circuitAfter,
        workingTarget,
        lastAddedEndpointId
      )
    }

    if (primaryEndpointId) {
      callbacks.setSelection({ type: 'endpoint', ids: [primaryEndpointId] })
    }
  },
}

function buildVisibleTrunkSitplanPlacement(
  project: DropBehaviorProject,
  circuitId: string,
  preferredPlanPosOverride?: Point,
): Placement | null {
  const activeFloorId = resolveCircuitSitplanTargetFloorId(
    project,
    useUIStore.getState().activeFloorId,
    circuitId,
  )
  if (!activeFloorId) return null

  const uiSnap = useUIStore.getState()
  const preferredPlanPos =
    preferredPlanPosOverride ??
    getViewportCenterPlanSpaceIfApplicable(
      uiSnap.viewportLayout,
      uiSnap.planCanvasViewportPx,
      uiSnap.activeFloorId,
      activeFloorId,
      uiSnap.planView,
    ) ??
    undefined
  return buildAutoSitplanPlacement(project, {
    circuitId,
    floorId: activeFloorId,
    placementId: generateId(),
    ...(preferredPlanPos ? { preferredPlanPos } : {}),
  })
}

/** Energy conversion drop behavior — trunk device on circuit trunk only (not supply wire). */
const energyConversionBehavior: DropBehavior = {
  validTargets: ['endpoint', 'circuit', 'protection'],
  execute: (target, project, symbol, t, callbacks) => {
    if (!checkDomainForConversion(target, project, symbol, t, callbacks)) return

    if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
      if (circuitFeedsSubPanel(project, target.circuitId)) {
        return
      }
      const circuit = callbacks.getCircuitById(target.circuitId)
      if (!circuit) return
      const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)
      const deviceId = generateId()
      const trunkDevice: TrunkDevice = {
        id: deviceId,
        type: 'conversion',
        symbol: symbol.id as TrunkDevice['symbol'],
        label: '',
        trunkPosition,
      }
      const placement = buildVisibleTrunkSitplanPlacement(project, target.circuitId)
      if (placement) trunkDevice.placements = [placement]
      addCircuitTrunkDeviceAtDrop(target, circuit, trunkDevice, callbacks)
      callbacks.setSelection({ type: 'trunkDevice', ids: [deviceId] })
      return
    }
    endpointBehavior.execute(target, project, symbol, t, callbacks)
  },
}

/**
 * DC-only endpoint drop behavior (solar panel, battery).
 * - When dropped on a DC wire: behaves like a normal fixed appliance endpoint.
 * - When dropped on an AC circuit wire: first inserts a rectifier (AC → DC) on the trunk,
 *   then adds the endpoint on the now-DC circuit.
 */
const dcEndpointBehavior: DropBehavior = {
  validTargets: ['endpoint', 'circuit', 'protection'],
  execute: (target, project, symbol, t, callbacks) => {
    // Resolve circuit from target or protection (same as endpointBehavior)
    let circuitId = target.circuitId
    if (!circuitId && target.type === 'protection' && target.protectionId) {
      const protection = callbacks.getProtectionById(target.protectionId)
      circuitId = protection?.circuits?.[0]?.id
    }
    if (!circuitId) return

    const circuit = callbacks.getCircuitById(circuitId)
    if (!circuit) return

    const wireDomain = getWireDomainAtDropTarget(target, project, callbacks)
    const plugInAfterSocket = isPlugInAfterSocketDrop(target, circuit, symbol)

    if (wireDomain === 'DC') {
      // Already on a DC wire – behave like a standard endpoint.
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }

    if (plugInAfterSocket) {
      // Chained after a socket: internal converter, no trunk rectifier.
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }

    // Auto-insert conversion only on plain AC (no upstream conversion chain yet).
    // If a conversion device is already upstream, force explicit user placement.
    if (wireDomain !== 'AC' || hasUpstreamConversionDeviceForDrop(target, circuit)) {
      const message = t('wires.domainMismatchDrop', {
        defaultValue:
          '{{component}} requires {{domain}} input, but the wire here is {{wireDomain}}.',
        component: symbol.name,
        domain: 'DC',
        wireDomain,
      })
      callbacks.onDropRejected?.(message)
      return
    }

    // On AC with no upstream conversion: insert a rectifier (AC → DC) on the trunk first, then add the endpoint.
    const rectifierMeta = getSymbolById('rectifier')
    if (!rectifierMeta) {
      // Fallback: just reject the drop if rectifier metadata is missing.
      const message = t('wires.domainMismatchDrop', {
        defaultValue:
          '{{component}} requires {{domain}} input, but the wire here is {{wireDomain}}.',
        component: symbol.name,
        domain: 'DC',
        wireDomain,
      })
      callbacks.onDropRejected?.(message)
      return
    }

    const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)
    const deviceId = generateId()
    const trunkDevice: TrunkDevice = {
      id: deviceId,
      type: 'conversion',
      symbol: 'rectifier',
      label: '',
      trunkPosition,
    }
    callbacks.addTrunkDevice(circuitId, trunkDevice)

    // Now add the DC endpoint using the normal endpoint behavior.
    let addedEndpointId: string | undefined
    const trackingCallbacks: DropBehaviorCallbacks = {
      ...callbacks,
      addEndpoint: (targetCircuitId, endpoint, insertAfterEndpointId, branchOpts) => {
        addedEndpointId = endpoint.id
        callbacks.addEndpoint(targetCircuitId, endpoint, insertAfterEndpointId, branchOpts)
      },
    }
    endpointBehavior.execute(target, project, symbol, t, trackingCallbacks)

    const updatedCircuit = callbacks.getCircuitById(circuitId)
    const addedEndpoint = updatedCircuit?.endpoints.find(
      (endpoint) => endpoint.id === addedEndpointId,
    )
    const endpointPlacement = addedEndpoint?.placements[0]
    const rectifierPlacement = buildVisibleTrunkSitplanPlacement(
      project,
      circuitId,
      endpointPlacement
        ? { x: endpointPlacement.pos.x - 80, y: endpointPlacement.pos.y }
        : undefined,
    )
    if (updatedCircuit && rectifierPlacement) {
      callbacks.updateCircuit(circuitId, {
        trunkDevices: (updatedCircuit.trunkDevices ?? []).map((device) =>
          device.id === trunkDevice.id ? { ...device, placements: [rectifierPlacement] } : device,
        ),
      })
    }
  },
}

/**
 * Energy meter drop behavior — special dual-mode:
 * - On endpoint/protection targets: acts as in-between device on branches (like a switch)
 * - On circuit targets (vertical trunk wire): adds as a trunk device
 *
 * When dropped on the vertical trunk, the energy meter is placed BEFORE all branches
 * by default (trunkPosition 0). The trunkPosition can be refined based on where on
 * the trunk the cursor was (computed from insertAfterEndpointId).
 */
const energyMeterBehavior: DropBehavior = {
  validTargets: ['endpoint', 'circuit', 'protection', 'supplyWire'],
  execute: (target, project, symbol, t, callbacks) => {
    if (target.type === 'supplyWire') {
      addSupplyTrunkDevice(symbol, target, project, callbacks)
      return
    }

    // If dropped on a circuit target (vertical trunk wire), add as trunk device
    if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
      if (circuitFeedsSubPanel(project, target.circuitId)) {
        return
      }
      const circuit = callbacks.getCircuitById(target.circuitId)
      if (!circuit) return

      // Compute trunkPosition from explicit circuit trunk segment metadata when available.
      const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)

      const deviceId = generateId()
      const trunkDevice: TrunkDevice = {
        id: deviceId,
        type: 'energy_meter',
        symbol: 'energy_meter',
        label: `kWh`,
        trunkPosition,
      }

      addCircuitTrunkDeviceAtDrop(target, circuit, trunkDevice, callbacks)
      return
    }

    // Otherwise, use the standard endpoint behavior (in-between device on branch)
    endpointBehavior.execute(target, project, symbol, t, callbacks)
  },
}

/**
 * Panel drop behavior
 */
const panelBehavior: DropBehavior = {
  validTargets: [null, 'mainBus', 'circuit', 'endpoint', 'protection', 'rcd'],
  execute: (target, project, _symbol, t, callbacks) => {
    const panels = projectPanels(project)
    const totalPanelCount = countPanels(panels)
    const panelNumber = totalPanelCount + 1

    const createPanel = (isMain: boolean): Panel => ({
      id: generateId(),
      name:
        totalPanelCount === 0
          ? t('panels.mainPanel', { defaultValue: 'Main Panel' })
          : t('panels.secondaryPanel', {
              number: panelNumber,
              defaultValue: `Panel ${panelNumber}`,
            }),
      symbol: 'panel_distribution',
      isMain,
      protections: [],
      circuits: [],
      subPanels: [],
    })

    // If no panels exist, create the first main panel.
    if (panels.length === 0) {
      const newMainPanel = createPanel(true)

      // addPanel already calls ensurePanelPlacement internally and creates
      // a PANEL circuit with the endpoint — no need to duplicate that here.
      callbacks.addPanel(newMainPanel)

      callbacks.setSelection({ type: 'panel', ids: [newMainPanel.id] })
      return
    }

    // A drop outside any panel frame / wire becomes a new root/main panel.
    if (target.type === null && !target.panelId) {
      const newRootPanel = createPanel(true)
      callbacks.addPanel(newRootPanel)
      callbacks.setSelection({ type: 'panel', ids: [newRootPanel.id] })
      return
    }

    // Determine which panel to nest the new secondary board under, then add feeder MCB/circuit.
    // Use the target panel if available, otherwise fall back to main panel
    let parentPanel: Panel | null = null
    if (target.panelId) {
      parentPanel = findPanelForTarget(project, target)
    }
    if (!parentPanel) {
      parentPanel = panels.find((p) => p.isMain) ?? panels[0] ?? null
    }
    if (!parentPanel) return

    const newPanel = createPanel(false)
    const newPanelId = newPanel.id

    callbacks.addPanel(newPanel, parentPanel.id)

    // Prefer reusing an explicitly targeted empty feeder (protection/circuit)
    // so dropping onto an empty slot does not create an extra feeder circuit.
    let feederProtection: ProtectionDevice | null = null
    if (target.type === 'protection' && target.protectionId) {
      feederProtection = callbacks.getProtectionById(target.protectionId)
    } else if ((target.type === 'circuit' || target.type === 'endpoint') && target.circuitId) {
      feederProtection = findProtectionByCircuitIdInProject(panels, target.circuitId)
    }
    const feederCircuit = feederProtection?.circuits?.[0]
    const canAttachToTargetFeeder =
      !!feederProtection &&
      !!feederCircuit &&
      !feederProtection.subPanelId &&
      typeof target.secondaryBusInsertIndex !== 'number' &&
      target.type !== 'rcd'

    if (canAttachToTargetFeeder && feederProtection) {
      callbacks.updateProtection(feederProtection.id, { subPanelId: newPanelId })
    } else {
      // Create MCB protection on the parent panel that feeds this sub-panel.
      // The MCB's subPanelId links it so the layout engine can render the
      // parent MCB on the sub-panel's supply wire as a mirrored reference.
      const protectionId = generateId()
      const circuitId = generateId()
      const voltagePoles = getVoltagePolesConfig(project)
      const mcbDefaults = getDefaultProtectionProps('MCB', voltagePoles)
      const feederCode = getNextAvailableCircuitCode(project, parentPanel.id)
      const mcbProtection: ProtectionDevice = {
        id: protectionId,
        type: 'MCB',
        label: feederCode,
        circuits: [],
        subPanelId: newPanelId,
        ...mcbDefaults,
      }

      callbacks.addProtection(parentPanel.id, mcbProtection)

      const mcbCircuit: Circuit = {
        id: circuitId,
        code: feederCode,
        kind: 'other',
        cable: createDefaultAcCircuitCable({ sectionMm2: 6 }),
        endpoints: [],
        ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
      }

      callbacks.addCircuit(parentPanel.id, mcbCircuit, protectionId)

      if (target.type === 'rcd' && target.protectionId) {
        callbacks.addCircuitToProtection(parentPanel.id, target.protectionId, mcbCircuit)
        if (typeof target.secondaryBusInsertIndex === 'number') {
          const targetRcd = callbacks.getProtectionById(target.protectionId)
          if (targetRcd?.circuits) {
            const ordered = targetRcd.circuits.filter((circuit) => circuit.id !== mcbCircuit.id)
            ordered.splice(clamp(target.secondaryBusInsertIndex, 0, ordered.length), 0, mcbCircuit)
            callbacks.updateProtection(targetRcd.id, { circuits: ordered })
          }
        }
      } else if (
        target.type === 'circuit' &&
        target.circuitId &&
        typeof target.secondaryBusInsertIndex === 'number'
      ) {
        callbacks.moveCircuitToSecondaryBus(
          parentPanel.id,
          target.circuitId,
          mcbCircuit.id,
          target.secondaryBusInsertIndex
        )
      } else if (target.type === 'mainBus' && typeof target.mainBusInsertIndex === 'number') {
        const beforeCount = target.mainBusItemCount ?? 0
        const desiredIndex = clamp(target.mainBusInsertIndex, 0, beforeCount)
        for (let index = beforeCount; index > desiredIndex; index -= 1) {
          callbacks.moveCircuitOnMainBus(parentPanel.id, mcbCircuit.id, 'left')
        }
      }
    }

    callbacks.setSelection({ type: 'panel', ids: [newPanelId] })
  },
}

/**
 * Ground drop behavior
 */
const groundBehavior: DropBehavior = {
  validTargets: ['mainBus'],
  execute: (target, project, _symbol, _t, callbacks) => {
    const panel = findPanelForTarget(project, target)
    if (!panel || !panel.isMain) return

    if (projectInstallation(project)) {
      callbacks.updateInstallation({ hasGround: true })
    }

    const activeFloorId = resolveSitplanTargetFloorId(project, useUIStore.getState().activeFloorId)
    if (activeFloorId) {
      const uiSnap = useUIStore.getState()
      const preferredPlanPos =
        getViewportCenterPlanSpaceIfApplicable(
          uiSnap.viewportLayout,
          uiSnap.planCanvasViewportPx,
          uiSnap.activeFloorId,
          activeFloorId,
          uiSnap.planView
        ) ?? undefined
      ensureEarthingSitplanPlacement(activeFloorId, preferredPlanPos)
    }
  },
}

/**
 * Earthing separator drop behavior
 */
const earthingSeparatorBehavior: DropBehavior = {
  validTargets: ['groundWire'],
  execute: (target, project, symbol, _t, callbacks) => {
    // Only allow on main panel ground wire
    const panel = findPanelForTarget(project, target)
    if (!panel || !panel.isMain) return

    if (target.type === 'groundWire') {
      addGroundTrunkDevice(symbol, target, project, callbacks)
    }
  },
}

/**
 * Junction box: supply wire, ground wire, circuit trunk, or endpoint branch (like energy meter).
 * Branch-positioned boxes also receive a situation-plan placement. No label.
 */
const junctionBoxBehavior: DropBehavior = {
  validTargets: ['supplyWire', 'groundWire', 'circuit', 'endpoint', 'protection'],
  execute: (target, project, symbol, t, callbacks) => {
    const panel = findPanelForTarget(project, target)
    if (target.type === 'supplyWire') {
      addSupplyTrunkDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'groundWire') {
      if (!panel?.isMain) return
      addGroundTrunkDevice(symbol, target, project, callbacks)
      return
    }
    // On endpoint or protection (branch): add as in-between device on branch, like energy meter
    if (
      target.type === 'endpoint' ||
      target.type === 'protection' ||
      (target.type === 'circuit' && target.branchEndpoints?.length)
    ) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
      if (circuitFeedsSubPanel(project, target.circuitId)) {
        return
      }
      const circuit = callbacks.getCircuitById(target.circuitId)
      if (!circuit) return
      const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)
      const deviceId = generateId()
      const trunkDevice: TrunkDevice = {
        id: deviceId,
        type: 'junction_box',
        symbol: 'junction_box',
        label: '',
        trunkPosition,
      }
      const activeFloorId = resolveCircuitSitplanTargetFloorId(
        project,
        useUIStore.getState().activeFloorId,
        target.circuitId
      )
      if (activeFloorId) {
        const uiSnap = useUIStore.getState()
        const preferredPlanPos =
          getViewportCenterPlanSpaceIfApplicable(
            uiSnap.viewportLayout,
            uiSnap.planCanvasViewportPx,
            uiSnap.activeFloorId,
            activeFloorId,
            uiSnap.planView
          ) ?? undefined
        const placement = buildAutoSitplanPlacement(project, {
          circuitId: target.circuitId,
          floorId: activeFloorId,
          placementId: generateId(),
          ...(preferredPlanPos ? { preferredPlanPos } : {}),
        })
        if (placement) trunkDevice.placements = [placement]
      }
      addCircuitTrunkDeviceAtDrop(target, circuit, trunkDevice, callbacks)
      callbacks.setSelection({ type: 'trunkDevice', ids: [deviceId] })
    }
  },
}

/**
 * Junction panel: same as junction box but with label; appears on sitplan (one per label).
 * Can be placed on trunks or on endpoint branches (like energy meter).
 */
const junctionPanelBehavior: DropBehavior = {
  validTargets: ['supplyWire', 'groundWire', 'circuit', 'endpoint', 'protection'],
  execute: (target, project, symbol, t, callbacks) => {
    const panel = findPanelForTarget(project, target)
    if (target.type === 'supplyWire') {
      addSupplyTrunkDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'groundWire') {
      if (!panel?.isMain) return
      addGroundTrunkDevice(symbol, target, project, callbacks)
      return
    }
    // On endpoint or protection (branch): add as in-between device on branch, like energy meter
    if (
      target.type === 'endpoint' ||
      target.type === 'protection' ||
      (target.type === 'circuit' && target.branchEndpoints?.length)
    ) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
      if (circuitFeedsSubPanel(project, target.circuitId)) {
        return
      }
      const circuit = callbacks.getCircuitById(target.circuitId)
      if (!circuit) return
      const label = getFirstJunctionPanelLabel(project) ?? 'JP1'
      callbacks.ensureJunctionPanelPlacementForLabel(label)
      const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)
      const deviceId = generateId()
      const trunkDevice: TrunkDevice = {
        id: deviceId,
        type: 'junction_panel',
        symbol: 'junction_panel',
        label,
        trunkPosition,
      }
      addCircuitTrunkDeviceAtDrop(target, circuit, trunkDevice, callbacks)
    }
  },
}

/**
 * Helper: add an earthing separator to the ground trunk wire (ground symbol → main bus).
 */
function addGroundTrunkDevice(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks
): void {
  const deviceId = generateId()
  const insertIndex = target.groundDeviceInsertIndex ?? 0

  if (symbol.id === 'junction_box') {
    const trunkDevice: TrunkDevice = {
      id: deviceId,
      type: 'junction_box',
      symbol: 'junction_box',
      label: '',
      trunkPosition: insertIndex,
    }
    callbacks.addGroundTrunkDevice(trunkDevice, insertIndex)
    return
  }
  if (symbol.id === 'junction_panel') {
    const label = getFirstJunctionPanelLabel(project) ?? 'JP1'
    callbacks.ensureJunctionPanelPlacementForLabel(label)
    const trunkDevice: TrunkDevice = {
      id: deviceId,
      type: 'junction_panel',
      symbol: 'junction_panel',
      label,
      trunkPosition: insertIndex,
    }
    callbacks.addGroundTrunkDevice(trunkDevice, insertIndex)
    return
  }

  const trunkDevice: TrunkDevice = {
    id: deviceId,
    type: 'earthing_separator',
    symbol: 'earthing_separator',
    label: 'Aardingsonderbreker',
    trunkPosition: insertIndex,
  }
  callbacks.addGroundTrunkDevice(trunkDevice, insertIndex)
}

/** First junction_panel label in the project (supply, ground, or any circuit), for prefilling a second panel. */
function getFirstJunctionPanelLabel(project: DropBehaviorProject): string | undefined {
  const installation = projectInstallation(project)
  const supply = installation?.mainSupply?.supplyTrunkDevices ?? []
  const firstSupply = supply.find((d) => d.type === 'junction_panel')
  if (firstSupply?.label) return firstSupply.label
  const ground = installation?.groundTrunkDevices ?? []
  const firstGround = ground.find((d) => d.type === 'junction_panel')
  if (firstGround?.label) return firstGround.label
  const collectFromPanel = (panels: Panel[]): string | undefined => {
    for (const panel of panels) {
      const circuits = [
        ...(panel.circuits ?? []),
        ...(panel.protections?.flatMap((pr) => pr.circuits ?? []) ?? []),
      ]
      for (const circuit of circuits) {
        const first = circuit.trunkDevices?.find((d) => d.type === 'junction_panel')
        if (first?.label) return first.label
      }
      const fromSub = collectFromPanel(panel.subPanels ?? [])
      if (fromSub) return fromSub
    }
    return undefined
  }
  return collectFromPanel(projectPanels(project))
}

/**
 * Helper: add a device to the supply trunk wire (main panel supply → main bus).
 * Works for junction boxes/panels and protection devices (MCB, RCD, RCBO, FUSE, MAIN_SWITCH, SPD).
 */
function addSupplyTrunkDevice(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks
): void {
  if (['transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(symbol.id)) {
    return
  }

  const deviceId = generateId()

  // Determine trunk device type and properties based on symbol
  let deviceType: TrunkDeviceType = 'junction_box'
  let protectionType: ProtectionType | undefined
  let label = ''

  if (symbol.id === 'energy_meter') {
    deviceType = 'energy_meter'
    label = 'kWh'
  } else if (symbol.id === 'junction_box') {
    deviceType = 'junction_box'
    label = ''
  } else if (symbol.id === 'junction_panel') {
    deviceType = 'junction_panel'
    label = getFirstJunctionPanelLabel(project) ?? 'JP1'
    callbacks.ensureJunctionPanelPlacementForLabel(label)
  } else if (PROTECTION_SYMBOL_IDS.includes(symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number])) {
    deviceType = 'protection'
    protectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id] || 'OTHER'
    label = protectionType === 'ROTATING_SWITCH' ? '' : protectionType
  }

  const insertIndex = target.supplyDeviceInsertIndex
  const voltagePoles = getVoltagePolesConfig(project)
  const trunkDevice: TrunkDevice = {
    id: deviceId,
    type: deviceType,
    symbol: symbol.id as TrunkDevice['symbol'],
    label,
    trunkPosition: insertIndex ?? 0,
    ...(protectionType ? { protectionType } : {}),
    ...(protectionType ? getDefaultTrunkDeviceProtectionProps(protectionType, voltagePoles) : {}),
  }
  const targetPanel = target.panelId ? findPanelById(projectPanels(project), target.panelId) : null
  const panelSupplyCircuit = targetPanel?.circuits?.find((c) => c.code === 'PANEL')

  if (protectionType === 'ROTATING_SWITCH') {
    const activeFloorId = resolveSitplanTargetFloorId(
      project,
      useUIStore.getState().activeFloorId,
    )
    if (activeFloorId) {
      const uiSnap = useUIStore.getState()
      const preferredPlanPos =
        getViewportCenterPlanSpaceIfApplicable(
          uiSnap.viewportLayout,
          uiSnap.planCanvasViewportPx,
          uiSnap.activeFloorId,
          activeFloorId,
          uiSnap.planView,
        ) ?? undefined
      const placement = buildAutoSitplanPlacement(project, {
        circuitId: panelSupplyCircuit?.id ?? `panel-supply:${target.panelId ?? 'main'}`,
        floorId: activeFloorId,
        placementId: generateId(),
        ...(preferredPlanPos ? { preferredPlanPos } : {}),
      })
      if (placement) trunkDevice.placements = [placement]
    }
  }

  if (targetPanel && !targetPanel.isMain && panelSupplyCircuit) {
    // Sub-panel incoming wire allows only one local protection device.
    if (deviceType === 'protection') {
      const hasProtectionAlready = (panelSupplyCircuit.trunkDevices ?? []).some(
        (d) => d.type === 'protection'
      )
      if (hasProtectionAlready) return
    }
    callbacks.addTrunkDevice(panelSupplyCircuit.id, trunkDevice)
    const updatedPanelCircuit = callbacks.getCircuitById(panelSupplyCircuit.id)
    if (updatedPanelCircuit?.trunkDevices) {
      const list = updatedPanelCircuit.trunkDevices.map((d: TrunkDevice) => ({ ...d }))
      const currentIdx = list.findIndex((d: TrunkDevice) => d.id === trunkDevice.id)
      if (currentIdx !== -1) {
        list.splice(currentIdx, 1)
        const idx = clamp(insertIndex ?? list.length, 0, list.length)
        // Important: do NOT re-insert the original `trunkDevice` object reference,
        // because after `addTrunkDevice` it may be frozen by store immutability.
        list.splice(idx, 0, { ...trunkDevice })
        const reindexed = list.map((d: TrunkDevice, i: number) => ({ ...d, trunkPosition: i }))
        callbacks.updateCircuit(panelSupplyCircuit.id, { trunkDevices: reindexed })
      }
    }
    return
  }

  callbacks.addSupplyTrunkDevice(trunkDevice, insertIndex, {
    panelId: target.panelId,
    feedScope: target.supplyFeedScope,
  })
}

/** Free-floating note on the wire canvas (same data as context menu “Add note”). */
const noteBehavior: DropBehavior = {
  validTargets: [null],
  execute: (_target, _project, _symbol, _t, callbacks) => {
    const pos = callbacks.dropCanvasPosition ?? { x: 0, y: 0 }
    const noteId = `note-${Date.now()}`
    callbacks.addEendraadNote({
      id: noteId,
      text: 'New note',
      fontSize: 14,
      pos,
      panelId: undefined,
    })
    callbacks.setSelection({ type: 'note', ids: [noteId] })
    trackGoogleAnalyticsEvent('note_place', {
      canvas: 'eendraad',
      source: 'symbol_drop',
    })
  },
}

/**
 * Drop behaviors registry
 */
export const dropBehaviors: Record<string, DropBehavior> = {
  mcb: protectionBehavior,
  rcd: rcdBehavior,
  rcbo: rcdBehavior,
  fuse: protectionBehavior, // Fuse uses generic protection behavior
  main_switch: protectionBehavior, // Main switch uses generic protection behavior
  spd: protectionBehavior, // SPD uses generic protection behavior
  rotating_switch: protectionBehavior,
  socket: endpointBehavior,
  socket_gnd: endpointBehavior,
  socket_child: endpointBehavior,
  socket_gnd_child: endpointBehavior,
  double_socket_child: endpointBehavior,
  double_socket_gnd_child: endpointBehavior,
  light_point: endpointBehavior,
  light_spot: endpointBehavior,
  light_led: endpointBehavior,
  light_fluorescent: endpointBehavior,
  fixed_appliance_generic: endpointBehavior,
  oven: endpointBehavior,
  washer: endpointBehavior,
  dryer: endpointBehavior,
  dishwasher: endpointBehavior,
  boiler: endpointBehavior,
  ev: endpointBehavior,
  freezer: endpointBehavior,
  fridge: endpointBehavior,
  microwave: endpointBehavior,
  motor: endpointBehavior,
  stove: endpointBehavior,
  furnace: endpointBehavior,
  furnace_heatpump: endpointBehavior,
  furnace_gas: endpointBehavior,
  furnace_oil: endpointBehavior,
  furnace_pellets: endpointBehavior,
  heating: endpointBehavior,
  ventilation: endpointBehavior,
  door_lock: endpointBehavior,
  buzzer: endpointBehavior,
  bell: endpointBehavior,
  horn: endpointBehavior,
  siren: endpointBehavior,
  switch: switchBehavior,
  switch_1p_twoway: switchBehavior,
  switch_2p_twoway: switchBehavior,
  switch_dimmer: switchBehavior,
  switch_1p_changeover: switchBehavior,
  switch_1p_pull: switchBehavior,
  switch_impulse: switchBehavior,
  switch_cross: switchBehavior,
  motion_detector: switchBehavior,
  relay: switchBehavior,
  switch_single: switchBehavior,
  switch_double: switchBehavior,
  domotica: endpointBehavior,
  energy_meter: energyMeterBehavior,
  transformer: energyConversionBehavior,
  rectifier: energyConversionBehavior,
  inverter: energyConversionBehavior,
  dc_dc_converter: energyConversionBehavior,
  solar_panel: dcEndpointBehavior,
  battery: dcEndpointBehavior,
  panel_distribution: panelBehavior,
  earthing: groundBehavior,
  earthing_separator: earthingSeparatorBehavior,
  junction_box: junctionBoxBehavior,
  junction_panel: junctionPanelBehavior,
  note: noteBehavior,
}

/**
 * Execute drop behavior for a symbol
 */
export function executeDropBehavior(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  t: TFunction,
  callbacks: DropBehaviorCallbacks,
  analytics:
    | false
    | {
        canvas: EditorCanvasAnalytics
        placementMethod: SymbolPlacementMethod
      } = { canvas: 'eendraad', placementMethod: 'library_drop' }
): void {
  const behavior = dropBehaviors[symbol.id]
  if (!behavior) {
    logger.warn(`No drop behavior for symbol: ${symbol.id}`)
    return
  }

  if (!behavior.validTargets.includes(target.type)) {
    logger.warn(`Invalid drop target ${target.type} for symbol ${symbol.id}`)
    return
  }

  behavior.execute(target, project, symbol, t, callbacks)
  if (analytics) {
    trackSymbolPlace({
      ...analytics,
      symbol,
      targetType: target.type ?? 'empty',
    })
  }
}

/** Find protection by id in project (searches all panels and subPanels) */
function findProtectionInProject(panels: Panel[], id: string): ProtectionDevice | null {
  for (const p of panels) {
    const pr = p.protections?.find((pr) => pr.id === id)
    if (pr) return pr
    const found = findProtectionInProject(p.subPanels || [], id)
    if (found) return found
  }
  return null
}

/**
 * Helper to find panel for a drop target
 */
function findPanelForTarget(project: DropBehaviorProject, target: DropTarget): Panel | null {
  const panels = projectPanels(project)
  if (target.panelId) {
    return findPanelById(panels, target.panelId) ?? null
  }
  return panels.find((p) => p.isMain) || panels[0] || null
}

function findProtectionByCircuitIdInProject(
  panels: Panel[],
  circuitId: string
): ProtectionDevice | null {
  for (const panel of panels) {
    for (const protection of panel.protections ?? []) {
      if (protection.circuits?.some((c) => c.id === circuitId)) {
        return protection
      }
    }
    const inSubPanels = findProtectionByCircuitIdInProject(panel.subPanels ?? [], circuitId)
    if (inSubPanels) return inSubPanels
  }
  return null
}
