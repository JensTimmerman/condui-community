import { getProjectStoreApi } from './projectStoreHistory'
import type { ProjectSliceCreator } from './projectStoreTypes'
import { syncPlugInPropsForDcEndpoints } from '@/lib/eendraad/endpointInsertAfter'
import { pruneEendraadFrames } from '@/lib/eendraad/frameContent'
import {
  findCircuitById,
  findEndpointById,
  findPanelContainingCircuit,
  findPanelOwningProtection,
  findProtectionById,
  findSupplyDeviceContainer,
  getAllCircuits,
  getAllEndpoints,
  getAllProtections,
  getDefaultPanelGridModuleRefs,
  getPanelPathFromRoot,
  isModuleRefValid,
  normalizeDomoticaCircuit,
  panelGridModuleIsVisibleByDefault,
  panelGridModuleRefKey,
  removeEndpointIdsFromCircuit,
} from '@/lib/eendraad/projectElectricalDomain'
import { repairCircuitBranchMembership } from '@/lib/eendraad/repairCircuitBranchMembership'
import { ensureInstallationFeedTopology, getPanelFeedProjection, getPanelSupplyTrunkDevices } from '@/lib/feedTopology'
import { ejectSupplyTrunkFromMainGridSlot } from '@/lib/panel/healSupplyTrunkGrid'
import { getSuppressedPanelGridModuleKeys } from '@/lib/panel/panelGridDuplicates'
import { findPanelById, findPanelByName } from '@/lib/panel/panelTree'
import { buildAutoSitplanPlacement, getViewportCenterPlanSpaceIfApplicable } from '@/lib/plan/autoSitplanPlacement'
import { ensureElectricalLayerOnFloor, healProjectFloorsElectricalLayers } from '@/lib/plan/floorLayers'
import { resolvePanelForDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import { resolveSitplanTargetFloorId } from '@/lib/plan/sitplanTargetFloor'
import {
  getEendraadFramesFromProject,
  getEendraadNotesFromProject,
  getMutableEendraadFramesForProject,
  getMutableEendraadNotesForProject,
  getMutableOneWireSegmentsForProject,
  getOneWireSegmentsFromProject,
  getSitplanNotesFromProject,
  replaceEendraadFramesForProject,
  replaceEendraadNotesForProject,
  replaceSitplanNotesForProject,
} from '@/lib/projectV2/annotations'
import {
  getCompatibilityFloorsFromProject,
  getMutableCompatibilityFloorsForProject,
} from '@/lib/projectV2/buildingFloors'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  getMutableElectricalPanelsForProject,
} from '@/lib/projectV2/electrical'
import { getQuarantinedItemsFromProject, syncValidationFromCompatibility } from '@/lib/projectV2/validation'
import { removeFromQuarantine as doRemoveFromQuarantine, restoreFromQuarantine as doRestoreFromQuarantine, quarantineCircuit, quarantineEndpoint } from '@/lib/validation/quarantine'
import { useUIStore } from '@/stores/uiStore'
import type { Circuit, Endpoint, Frame, Note, PanelGridModuleRef, PanelGridSlot, Placement, ProtectionDevice, WireSegment } from '@/types/schema'
import { DEFAULT_ELECTRICAL_DOMAIN } from '@/types/schema'
import { findCircuitForEndpointInPanel, findCircuitForEndpointInProject, generateId } from '@/utils/project'

export const createSelectorAnnotationSlice: ProjectSliceCreator = (set, get) => ({
    // Selectors
    getPanelById: (id) => {
      const { currentProject } = getProjectStoreApi().getState()
      return currentProject ? findPanelById(getElectricalPanelsFromProject(currentProject), id) : undefined
    },

    getPanelByName: (name) => {
      const { currentProject } = getProjectStoreApi().getState()
      return currentProject ? findPanelByName(getElectricalPanelsFromProject(currentProject), name) : undefined
    },

    getProtectionById: (id) => {
      const { currentProject } = get()
      if (!currentProject) return undefined
      for (const panel of getElectricalPanelsFromProject(currentProject)) {
        const protection = findProtectionById(panel, id)
        if (protection) return protection
      }
      return undefined
    },

    getPanelForProtection: (protectionId) => {
      const { currentProject } = get()
      if (!currentProject) return undefined
      return findPanelOwningProtection(getElectricalPanelsFromProject(currentProject), protectionId)
    },

    getCircuitById: (id) => {
      const { currentProject } = get()
      if (!currentProject) return undefined
      for (const panel of getElectricalPanelsFromProject(currentProject)) {
        const result = findCircuitById(panel, id)
        if (result) return result.circuit
      }
      return undefined
    },

    // Get the display identifier for a circuit
    // For single MCBs: returns the MCB label (MCB IS the circuit)
    // For RCD circuits or direct circuits: returns circuit.code
    getCircuitIdentifier: (circuitId) => {
      const { currentProject } = get()
      if (!currentProject) return ''
      for (const panel of getElectricalPanelsFromProject(currentProject)) {
        const result = findCircuitById(panel, circuitId)
        if (result) {
          // If circuit is under a protection device, use its label
          if (result.parent && 'type' in result.parent && 'label' in result.parent) {
            return result.parent.label
          }
          // Otherwise use circuit code (direct circuits, etc.)
          return result.circuit.code
        }
      }
      return ''
    },

    getEndpointById: (id) => {
      const { currentProject } = get()
      if (!currentProject) return undefined
      for (const panel of getElectricalPanelsFromProject(currentProject)) {
        const result = findEndpointById(panel, id)
        if (result) return result.endpoint
      }
      return undefined
    },

    getFloorById: (id) => {
      const { currentProject } = get()
      return currentProject
        ? getCompatibilityFloorsFromProject(currentProject).find((f) => f.id === id)
        : undefined
    },

    getPlacementById: (id) => {
      const { currentProject } = get()
      if (!currentProject) return undefined
      const earthing = getElectricalInstallationFromProject(currentProject)?.earthingPlacements?.find((p) => p.id === id)
      if (earthing) {
        return {
          id: earthing.id,
          floorId: earthing.floorId,
          layer: earthing.layer ?? 'default',
          pos: earthing.pos,
          rotationDeg: (earthing.rotationDeg ?? 0) as 0 | 90 | 180 | 270,
          rotationMode: earthing.rotationMode,
          scale: earthing.scale ?? 1,
          locked: earthing.locked,
          isEarthing: true,
        }
      }
      for (const panel of getElectricalPanelsFromProject(currentProject)) {
        for (const endpoint of getAllEndpoints(panel)) {
          const placement = endpoint.placements.find((p) => p.id === id)
          if (placement) {
            return { ...placement, endpointId: endpoint.id }
          }
        }
        for (const circuit of getAllCircuits(panel)) {
          for (const device of circuit.trunkDevices ?? []) {
            const placement = device.placements?.find((candidate) => candidate.id === id)
            if (placement) return { ...placement, trunkDeviceId: device.id }
          }
        }
      }
      return undefined
    },

    getCircuitsByPanel: (panelId) => {
      const { currentProject } = get()
      if (!currentProject) return []
      const panel = findPanelById(getElectricalPanelsFromProject(currentProject), panelId)
      return panel ? getAllCircuits(panel) : []
    },

    getProtectionsByPanel: (panelId) => {
      const { currentProject } = get()
      if (!currentProject) return []
      const panel = findPanelById(getElectricalPanelsFromProject(currentProject), panelId)
      return panel ? getAllProtections(panel) : []
    },

    getPanelGridModules: (panelId) => {
      const { currentProject } = get()
      if (!currentProject) return []
      const panel = findPanelById(getElectricalPanelsFromProject(currentProject), panelId)
      if (!panel) return []
      const installation = getElectricalInstallationFromProject(currentProject)
      const panels = getElectricalPanelsFromProject(currentProject)
      if (!installation) return []
      ensureInstallationFeedTopology(installation, panels)
      const projection = panel.isMain
        ? getPanelFeedProjection(installation, panels, panel)
        : null
      const sharedSupplyKeys = new Set(
        (projection?.sharedFeed.trunkDevices ?? []).map((device) =>
          panelGridModuleRefKey({ kind: 'trunkDevice', id: device.id, scope: 'supply' })
        )
      )
      const rootSupplyKeys = new Set(
        (projection?.rootFeed?.trunkDevices ?? []).map((device) =>
          panelGridModuleRefKey({ kind: 'trunkDevice', id: device.id, scope: 'supply' })
        )
      )
      const hiddenKeys = new Set(panel.gridView?.hiddenModuleKeys ?? [])
      const shownKeys = new Set(panel.gridView?.shownModuleKeys ?? [])
      const defaultRefs = getDefaultPanelGridModuleRefs(
        panel,
        getElectricalInstallationFromProject(currentProject),
        getElectricalPanelsFromProject(currentProject)
      )
      const slots = panel.gridView?.slots ?? []
      const supplySlots = panel.gridView?.supplyPanelSlots ?? []

      // Filter out invalid slots (single source of truth - only return valid refs)
      const validSlots = slots.filter((s) => {
        try {
          return isModuleRefValid(s.module, currentProject)
        } catch {
          return false
        }
      })
      const validSupplySlots = supplySlots.filter((s) => {
        try {
          return isModuleRefValid(s.module, currentProject)
        } catch {
          return false
        }
      })
      const sharedSupplySlots = panel.isMain
        ? validSupplySlots.filter((slot) =>
            sharedSupplyKeys.has(panelGridModuleRefKey(slot.module))
          )
        : validSupplySlots
      const rootSupplySlots = panel.isMain
        ? validSupplySlots.filter((slot) => rootSupplyKeys.has(panelGridModuleRefKey(slot.module)))
        : []
      const supplyKeys = new Set(sharedSupplySlots.map((s) => panelGridModuleRefKey(s.module)))
      const mainKeys = new Set(validSlots.map((s) => panelGridModuleRefKey(s.module)))

      // Slots are purely visual (position), order always comes from data arrays (defaultRefs)
      // Create a map of slots by module key for quick lookup
      const slotMap = new Map(
        [...validSlots, ...rootSupplySlots].map((s) => [panelGridModuleRefKey(s.module), s])
      )

      // Always use data array order (defaultRefs), look up slot position if it exists
      const result: Array<{
        ref: PanelGridModuleRef
        slot?: { row: number; col: number; moduleWidth?: number; moduleWidthManual?: boolean }
        inSupplyPanel?: boolean
      }> = defaultRefs
        .filter((ref) => {
          const key = panelGridModuleRefKey(ref)
          if (hiddenKeys.has(key)) return false
          if (
            !panelGridModuleIsVisibleByDefault(ref, panel, installation, panels) &&
            !shownKeys.has(key)
          ) return false
          // Supply devices on main panel:
          // - shared supply devices default to the shared supply panel unless explicitly placed in main
          // - root-local supply devices always materialize in the main panel body
          if (panel.isMain && ref.kind === 'trunkDevice' && ref.scope === 'supply') {
            if (rootSupplyKeys.has(key)) return true
            if (supplyKeys.has(key)) return false
            return mainKeys.has(key)
          }
          return !supplyKeys.has(key)
        })
        .map((ref) => {
          const key = panelGridModuleRefKey(ref)
          const slot = slotMap.get(key)
          return {
            ref,
            slot: slot
              ? {
                  row: slot.row,
                  col: slot.col,
                  moduleWidth: slot.moduleWidth,
                  moduleWidthManual: slot.moduleWidthManual,
                }
              : undefined,
            inSupplyPanel: false,
          }
        })
      // For supply modules, ensure order matches the single source of truth: supplyTrunkDevices array
      // This ensures panel canvas matches eendraad canvas order
      // IMPORTANT: Add ALL supply devices from the array, even if they don't have slots yet
      // (newly inserted devices may not have slots, but should still appear and get auto-placed)
      if (panel.isMain) {
        const installation = getElectricalInstallationFromProject(currentProject)
        if (!installation) return result
        const supplyDevices = getPanelSupplyTrunkDevices(
          installation,
          getElectricalPanelsFromProject(currentProject),
          panel
        ).filter((device) =>
          sharedSupplyKeys.has(
            panelGridModuleRefKey({ kind: 'trunkDevice', id: device.id, scope: 'supply' })
          )
        )
        const supplySlotMap = new Map(
          sharedSupplySlots.map((s) => [panelGridModuleRefKey(s.module), s])
        )

        // Add supply modules in the order they appear in supplyTrunkDevices array
        for (const device of supplyDevices) {
          const ref: PanelGridModuleRef = { kind: 'trunkDevice', id: device.id, scope: 'supply' }
          const key = panelGridModuleRefKey(ref)
          if (hiddenKeys.has(key)) continue // Skip hidden devices
          // If user explicitly placed this supply module in main panel, don't also emit it in supply panel.
          if (mainKeys.has(key) && !supplyKeys.has(key)) continue

          const slot = supplySlotMap.get(key)
          result.push({
            ref,
            slot: slot
              ? {
                  row: slot.row,
                  col: slot.col,
                  moduleWidth: slot.moduleWidth,
                  moduleWidthManual: slot.moduleWidthManual,
                }
              : undefined,
            inSupplyPanel: true,
          })
        }
      } else {
        // For non-main panels or when no supply devices, use original order
        for (const s of validSupplySlots) {
          result.push({
            ref: s.module,
            slot: {
              row: s.row,
              col: s.col,
              moduleWidth: s.moduleWidth,
              moduleWidthManual: s.moduleWidthManual,
            },
            inSupplyPanel: true,
          })
        }
      }
      const suppressedDuplicateKeys = getSuppressedPanelGridModuleKeys(
        currentProject,
        result.map((item, index) => ({
          ref: item.ref,
          area: item.inSupplyPanel ? 'supply' : 'main',
          row: item.slot?.row ?? 0,
          col: item.slot?.col ?? 0,
          order: index,
        }))
      )
      // Final safety net: never return duplicate module keys.
      const seen = new Set<string>()
      return result.filter((m) => {
        const key = panelGridModuleRefKey(m.ref)
        if (hiddenKeys.has(key)) return false
        if (
          !panelGridModuleIsVisibleByDefault(m.ref, panel, installation, panels) &&
          !shownKeys.has(key)
        ) return false
        if (suppressedDuplicateKeys.has(key)) return false
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    },

    getPanelHiddenModuleRefs: (panelId) => {
      const { currentProject } = get()
      if (!currentProject) return []
      const panel = findPanelById(getElectricalPanelsFromProject(currentProject), panelId)
      if (!panel) return []
      const hiddenKeys = new Set(panel.gridView?.hiddenModuleKeys ?? [])
      const shownKeys = new Set(panel.gridView?.shownModuleKeys ?? [])
      const installation = getElectricalInstallationFromProject(currentProject)
      const panels = getElectricalPanelsFromProject(currentProject)
      const defaultRefs = getDefaultPanelGridModuleRefs(
        panel,
        installation,
        panels
      )
      return defaultRefs.filter((ref) => {
        const key = panelGridModuleRefKey(ref)
        return hiddenKeys.has(key) || (
          !panelGridModuleIsVisibleByDefault(ref, panel, installation, panels) &&
          !shownKeys.has(key)
        )
      })
    },

    getEndpointsByCircuit: (circuitId) => {
      const { currentProject } = get()
      if (!currentProject) return []
      for (const panel of getElectricalPanelsFromProject(currentProject)) {
        const result = findCircuitById(panel, circuitId)
        if (result) return result.circuit.endpoints
      }
      return []
    },

    getPlacementsByFloor: (floorId) => {
      const { currentProject } = get()
      if (!currentProject) return []
      const result: Array<
        Placement & { endpointId?: string; trunkDeviceId?: string; junctionPanelLabel?: string; isEarthing?: boolean }
      > = []
      for (const panel of getElectricalPanelsFromProject(currentProject)) {
        const endpoints = getAllEndpoints(panel)
        for (const endpoint of endpoints) {
          for (const placement of endpoint.placements) {
            if (placement.floorId === floorId) {
              result.push({ ...placement, endpointId: endpoint.id })
            }
          }
        }
        for (const circuit of getAllCircuits(panel)) {
          for (const device of circuit.trunkDevices ?? []) {
            for (const placement of device.placements ?? []) {
              if (placement.floorId === floorId) {
                result.push({ ...placement, trunkDeviceId: device.id })
              }
            }
          }
        }
      }
      const installation = getElectricalInstallationFromProject(currentProject)
      const jpPlacements = installation?.junctionPanelPlacements ?? []
      for (const jp of jpPlacements) {
        if (jp.floorId === floorId) {
          result.push({
            id: jp.id,
            floorId: jp.floorId,
            layer: jp.layer ?? 'default',
            pos: jp.pos,
            rotationDeg: (jp.rotationDeg ?? 0) as 0 | 90 | 180 | 270,
            rotationMode: jp.rotationMode,
            scale: jp.scale ?? 1,
            junctionPanelLabel: jp.label,
          })
        }
      }
      const earthingPlacements = installation?.earthingPlacements ?? []
      for (const ep of earthingPlacements) {
        if (ep.floorId === floorId) {
          result.push({
            id: ep.id,
            floorId: ep.floorId,
            layer: ep.layer ?? 'default',
            pos: ep.pos,
            rotationDeg: (ep.rotationDeg ?? 0) as 0 | 90 | 180 | 270,
            rotationMode: ep.rotationMode,
            scale: ep.scale ?? 1,
            locked: ep.locked,
            isEarthing: true,
          })
        }
      }
      return result
    },

    getTrunkDeviceById: (deviceId) => {
      const { currentProject } = get()
      if (!currentProject) return undefined

      // Check shared/root supply trunk devices first
      const supplyContainer = findSupplyDeviceContainer(currentProject, deviceId)
      const supplyDevice = supplyContainer?.devices.find((d) => d.id === deviceId)
      if (supplyDevice) {
        return {
          device: supplyDevice,
          circuit: null,
          isSupplyDevice: true,
          supplyFeedScope: supplyContainer?.scope,
          supplyPanelId: supplyContainer?.panelId,
        }
      }

      // Check ground trunk devices
      const installation = getElectricalInstallationFromProject(currentProject)
      const groundDevice = installation?.groundTrunkDevices?.find(
        (d) => d.id === deviceId
      )
      if (groundDevice) {
        // Ground devices are not associated with a circuit
        return { device: groundDevice, circuit: null, isGroundDevice: true }
      }

      // Check circuit trunk devices
      for (const panel of getElectricalPanelsFromProject(currentProject)) {
        const circuits = getAllCircuits(panel)
        for (const circuit of circuits) {
          const device = circuit.trunkDevices?.find((d) => d.id === deviceId)
          if (device) return { device, circuit, isSupplyDevice: false }
        }
      }
      return undefined
    },

    // Helper to find parent circuit for an endpoint (works for endpoints in main or secondary panels)
    findCircuitForEndpoint: (endpointId) => {
      const { currentProject } = get()
      if (!currentProject) return undefined
      for (const panel of getElectricalPanelsFromProject(currentProject)) {
        const found = findCircuitForEndpointInPanel(panel, endpointId)
        if (found) return found
      }
      return undefined
    },

    // Helper to find parent panel for a circuit (returns the panel that actually contains the circuit, including sub-panels)
    findPanelForCircuit: (circuitId) => {
      const { currentProject } = get()
      if (!currentProject) return undefined
      for (const panel of getElectricalPanelsFromProject(currentProject)) {
        const found = findPanelContainingCircuit(panel, circuitId)
        if (found) return found
      }
      return undefined
    },

    // Protection that owns this circuit (when under an MCB/RCD etc.)
    getProtectionForCircuit: (circuitId) => {
      const { currentProject } = get()
      if (!currentProject) return undefined
      for (const panel of getElectricalPanelsFromProject(currentProject)) {
        const result = findCircuitById(panel, circuitId)
        if (result?.parent && 'type' in result.parent) return result.parent as ProtectionDevice
      }
      return undefined
    },

    // Path from root to the given panel (main panel first, target panel last); null if not found
    getPanelPathFromRoot: (targetPanelId) => {
      const { currentProject } = get()
      if (!currentProject) return null
      return getPanelPathFromRoot(getElectricalPanelsFromProject(currentProject), targetPanelId)
    },

    // Helper to get all endpoints (for searching)
    getAllEndpoints: () => {
      const { currentProject } = get()
      if (!currentProject) return []
      const endpoints: Endpoint[] = []
      for (const panel of getElectricalPanelsFromProject(currentProject)) {
        endpoints.push(...getAllEndpoints(panel))
      }
      return endpoints
    },

    quarantineDetectedOrphan: (orphan) =>
      set((state) => {
        if (!state.currentProject || !orphan.quarantinePayload) return
        const p = state.currentProject
        if (orphan.quarantinePayload.kind === 'circuit') {
          quarantineCircuit(
            p,
            orphan.panelId,
            orphan.quarantinePayload.circuitId,
            orphan.reason,
            orphan.quarantinePayload.originalParentId,
            orphan.quarantinePayload.originalRefId
          )
        } else {
          quarantineEndpoint(
            p,
            orphan.panelId,
            orphan.quarantinePayload.circuitId,
            orphan.quarantinePayload.endpointId,
            orphan.reason,
            orphan.quarantinePayload.originalRefId
          )
        }
        syncValidationFromCompatibility(p)
        state.isDirty = true
      }),

    resolveDetectedOrphan: (orphan) =>
      set((state) => {
        if (!state.currentProject || !orphan.resolutionPayload) return
        const payload = orphan.resolutionPayload
        if (payload.kind === 'attachCircuitToProtection') {
          const targetPanel = findPanelById(getMutableElectricalPanelsForProject(state.currentProject), payload.panelId)
          if (!targetPanel) return
          const circuit = targetPanel.circuits.find(
            (candidate) => candidate.id === payload.circuitId
          )
          if (!circuit || circuit.code === 'PANEL') return

          const attachableProtection =
            targetPanel.protections.find((protection) => {
              if (protection.subPanelId) return false
              return (
                protection.type === 'MCB' ||
                protection.type === 'RCBO' ||
                protection.type === 'FUSE' ||
                protection.type === 'OTHER'
              )
            }) ?? targetPanel.protections.find((protection) => !protection.subPanelId)

          if (attachableProtection) {
            if (!attachableProtection.circuits) attachableProtection.circuits = []
            if (!attachableProtection.circuits.some((existing) => existing.id === circuit.id)) {
              attachableProtection.circuits.push(circuit)
            }
          } else {
            targetPanel.protections.push({
              id: generateId(),
              type: 'MCB',
              label: `MCB ${circuit.code}`,
              ratingA: 16,
              curve: 'C',
              circuits: [circuit],
            })
          }

          targetPanel.circuits = targetPanel.circuits.filter(
            (candidate) => candidate.id !== circuit.id
          )
          state.isDirty = true
        } else if (payload.kind === 'dedupeEndpointPlacements') {
          let endpoint: Endpoint | undefined
          for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
            const found = findEndpointById(panel, payload.endpointId)
            if (found) {
              endpoint = found.endpoint
              break
            }
          }
          if (!endpoint) return
          const removeSet = new Set(payload.removePlacementIds)
          endpoint.placements = endpoint.placements.filter((p) => !removeSet.has(p.id))
          // Safety: ensure the kept placement remains present.
          if (!endpoint.placements.some((p) => p.id === payload.keepPlacementId)) {
            return
          }
          state.isDirty = true
        } else if (payload.kind === 'repairPanelGridDuplicateModules') {
          const targetPanel = findPanelById(getMutableElectricalPanelsForProject(state.currentProject), payload.panelId)
          if (!targetPanel?.gridView) return

          const shouldKeepSlot = (slot: PanelGridSlot, area: 'main' | 'supply'): boolean =>
            !payload.removeSlots.some(
              (entry) =>
                entry.area === area &&
                entry.row === slot.row &&
                entry.col === slot.col &&
                entry.moduleKey === panelGridModuleRefKey(slot.module)
            )

          targetPanel.gridView.slots = (targetPanel.gridView.slots ?? []).filter((slot) =>
            shouldKeepSlot(slot, 'main')
          )
          targetPanel.gridView.supplyPanelSlots = (
            targetPanel.gridView.supplyPanelSlots ?? []
          ).filter((slot) => shouldKeepSlot(slot, 'supply'))

          if (payload.hideModuleKeys.length > 0) {
            const hidden = new Set(targetPanel.gridView.hiddenModuleKeys ?? [])
            for (const key of payload.hideModuleKeys) hidden.add(key)
            targetPanel.gridView.hiddenModuleKeys = [...hidden]
          }

          state.isDirty = true
        } else if (payload.kind === 'ejectSupplyTrunkToSupplyStrip') {
          const targetPanel = findPanelById(getMutableElectricalPanelsForProject(state.currentProject), payload.panelId)
          if (!targetPanel) return
          if (
            ejectSupplyTrunkFromMainGridSlot(targetPanel, state.currentProject, payload.moduleRef)
          ) {
            state.isDirty = true
          }
        } else if (payload.kind === 'repairDomoticaChildLink') {
          const p = state.currentProject
          let circuit: Circuit | null = null
          for (const panel of getMutableElectricalPanelsForProject(p)) {
            const found = findCircuitById(panel, payload.circuitId)
            if (found) {
              circuit = found.circuit
              break
            }
          }
          if (!circuit) return
          const parent = circuit.endpoints.find((e) => e.id === payload.parentEndpointId)
          const child = circuit.endpoints.find((e) => e.id === payload.endpointId)
          if (!parent?.domoticaProps || !child) return

          const ids = [...(parent.domoticaProps.endpointChildEndpointIds ?? [])]
          while (ids.length <= payload.outputIndex) ids.push('')
          if (ids[payload.outputIndex] !== payload.endpointId) {
            ids[payload.outputIndex] = payload.endpointId
          }

          parent.domoticaProps = {
            ...parent.domoticaProps,
            endpointCount: Math.max(
              parent.domoticaProps.endpointCount ?? 1,
              payload.outputIndex + 1
            ),
            endpointChildEndpointIds: ids,
          }
          child.domoticaChildProps = {
            parentEndpointId: parent.id,
            outputGroup: 'endpoint',
            outputIndex: payload.outputIndex,
          }
          if (circuit.branches?.length) {
            let placed = false
            circuit.branches = circuit.branches.map((branch) => {
              const withoutChild = branch.endpointIds.filter((id) => id !== child.id)
              const parentIndex = withoutChild.indexOf(parent.id)
              if (!placed && parentIndex >= 0) {
                placed = true
                const nextIds = [...withoutChild]
                nextIds.splice(parentIndex + 1, 0, child.id)
                return { ...branch, endpointIds: nextIds }
              }
              return { ...branch, endpointIds: withoutChild }
            })
          }
          normalizeDomoticaCircuit(circuit)
          state.isDirty = true
        } else if (payload.kind === 'addAutoSitplanPlacement') {
          const p = state.currentProject
          healProjectFloorsElectricalLayers(p)
          const floorId = resolveSitplanTargetFloorId(p, useUIStore.getState().activeFloorId)
          if (!floorId) return
          const floor = getMutableCompatibilityFloorsForProject(p).find((f) => f.id === floorId)
          if (floor) ensureElectricalLayerOnFloor(floor)

          let targetEndpoint: Endpoint | undefined
          for (const panel of getMutableElectricalPanelsForProject(p)) {
            const found = findEndpointById(panel, payload.endpointId)
            if (found) {
              targetEndpoint = found.endpoint
              break
            }
          }
          if (!targetEndpoint || targetEndpoint.placements.length > 0) return

          const hit = findCircuitForEndpointInProject(p, payload.endpointId)
          if (!hit) return
          const circuitId = hit.circuit.id

          const uiSnap = useUIStore.getState()
          const preferredPlanPos =
            getViewportCenterPlanSpaceIfApplicable(
              uiSnap.viewportLayout,
              uiSnap.planCanvasViewportPx,
              uiSnap.activeFloorId,
              floorId,
              uiSnap.planView
            ) ?? undefined
          const placement = buildAutoSitplanPlacement(p, {
            circuitId,
            floorId,
            placementId: generateId(),
            ...(preferredPlanPos ? { preferredPlanPos } : {}),
          })
          if (!placement) return

          for (const panel of getMutableElectricalPanelsForProject(p)) {
            const found = findEndpointById(panel, payload.endpointId)
            if (found) {
              found.endpoint.placements.push(placement)
              state.isDirty = true
              return
            }
          }
        } else if (payload.kind === 'syncPanelDistributionLabel') {
          const p = state.currentProject
          let target: Endpoint | undefined
          for (const panel of getMutableElectricalPanelsForProject(p)) {
            const found = findEndpointById(panel, payload.endpointId)
            if (found) {
              target = found.endpoint
              break
            }
          }
          if (!target || target.symbol !== 'panel_distribution') return
          const board = resolvePanelForDistributionEndpoint(p, target)
          if (!board) return
          target.label = board.name
          if (target.panelId !== board.id) target.panelId = board.id
          state.isDirty = true
        } else if (payload.kind === 'mergeMultiplierEndpointsOnBranch') {
          const p = state.currentProject
          const { circuitId, keepEndpointId, absorbEndpointIds } = payload
          if (!absorbEndpointIds.length) return
          let circuit: Circuit | null = null
          let keeper: Endpoint | undefined
          for (const panel of getMutableElectricalPanelsForProject(p)) {
            const found = findCircuitById(panel, circuitId)
            if (found) {
              circuit = found.circuit
              keeper = found.circuit.endpoints.find((e) => e.id === keepEndpointId)
              break
            }
          }
          if (!circuit || !keeper) return
          const absorbs = absorbEndpointIds.map((aid) =>
            circuit!.endpoints.find((e) => e.id === aid)
          )
          if (absorbs.some((a) => !a)) return
          const usedPlacementIds = new Set(keeper.placements.map((pl) => pl.id))
          for (const absorb of absorbs) {
            if (!absorb) continue
            for (const pl of absorb.placements) {
              let pid = pl.id
              if (usedPlacementIds.has(pid)) {
                pid = generateId()
              }
              usedPlacementIds.add(pid)
              keeper.placements.push({ ...pl, id: pid })
            }
          }
          removeEndpointIdsFromCircuit(circuit, new Set(absorbEndpointIds))
          normalizeDomoticaCircuit(circuit)
          state.isDirty = true
        } else if (payload.kind === 'repairCircuitBranchMembership') {
          const targetPanel = findPanelById(getMutableElectricalPanelsForProject(state.currentProject), payload.panelId)
          if (!targetPanel) return
          const circuitResult = findCircuitById(targetPanel, payload.circuitId)
          if (!circuitResult || circuitResult.circuit.code === 'PANEL') return
          if (repairCircuitBranchMembership(circuitResult.circuit)) {
            normalizeDomoticaCircuit(circuitResult.circuit)
            syncPlugInPropsForDcEndpoints(circuitResult.circuit)
            state.isDirty = true
          }
        } else if (payload.kind === 'repairSubCircuitSelfReference') {
          const targetPanel = findPanelById(getMutableElectricalPanelsForProject(state.currentProject), payload.panelId)
          if (!targetPanel) return
          const circuitResult = findCircuitById(targetPanel, payload.circuitId)
          if (!circuitResult || circuitResult.circuit.code === 'PANEL') return
          const c = circuitResult.circuit
          if (!c.subCircuitIds?.length) return
          const next = c.subCircuitIds.filter((id) => id !== c.id)
          if (next.length === c.subCircuitIds.length) return
          c.subCircuitIds = next.length > 0 ? next : undefined
          state.isDirty = true
        } else if (payload.kind === 'pruneFrameContentReference') {
          pruneEendraadFrames(state.currentProject, {
            removedMemberIds: payload.contentType === 'circuit' ? undefined : [payload.contentId],
            removedCircuitIds: payload.contentType === 'circuit' ? [payload.contentId] : undefined,
          })
          state.isDirty = true
        }
      }),

    restoreFromQuarantine: (quarantinedItemId) =>
      set((state) => {
        if (!state.currentProject) return
        if (doRestoreFromQuarantine(state.currentProject, quarantinedItemId)) {
          syncValidationFromCompatibility(state.currentProject)
          state.isDirty = true
        }
      }),

    removeFromQuarantine: (quarantinedItemId) =>
      set((state) => {
        if (!state.currentProject) return
        if (doRemoveFromQuarantine(state.currentProject, quarantinedItemId)) {
          syncValidationFromCompatibility(state.currentProject)
          state.isDirty = true
        }
      }),

    repairBranchMembershipForQuarantinedItem: (quarantinedItemId) =>
      set((state) => {
        const p = state.currentProject
        if (!p) return
        const item = getQuarantinedItemsFromProject(p).find((q) => q.id === quarantinedItemId)
        if (!item || item.reason !== 'endpointNotInBranch') return

        if (item.kind === 'circuit') {
          const circuit = item.data as Circuit
          if (circuit.code === 'PANEL') return
          if (repairCircuitBranchMembership(circuit)) {
            normalizeDomoticaCircuit(circuit)
            syncPlugInPropsForDcEndpoints(circuit)
            state.isDirty = true
          }
          return
        }

        const circuitId = item.originalParentId
        if (!circuitId) return
        const panel = findPanelById(getMutableElectricalPanelsForProject(p), item.panelId)
        if (!panel) return
        const found = findCircuitById(panel, circuitId)
        if (!found || found.circuit.code === 'PANEL') return
        if (repairCircuitBranchMembership(found.circuit)) {
          normalizeDomoticaCircuit(found.circuit)
          syncPlugInPropsForDcEndpoints(found.circuit)
          state.isDirty = true
        }
      }),

    // Wire segment actions
    updateWireSegment: (id, updates) =>
      set((state) => {
        if (state.currentProject) {
          const wireSegments = getMutableOneWireSegmentsForProject(state.currentProject)

          // Find existing wire segment override
          let wireSegment = wireSegments.find((ws) => ws.id === id)

          if (!wireSegment) {
            // Create new wire segment override with minimal data
            wireSegment = {
              id,
              type: 'vertical', // Default, will be overridden if needed
              startPoint: { x: 0, y: 0 },
              endPoint: { x: 0, y: 0 },
              cable: {
                kind: 'XVB',
                conductors: 3,
                sectionMm2: 2.5,
                hasPE: true,
              },
              domain: DEFAULT_ELECTRICAL_DOMAIN,
              panelId: '', // Will be set from updates if provided
              ...updates,
            } as WireSegment
            wireSegments.push(wireSegment)
          } else {
            // Update existing wire segment override
            // If updating cable, merge the cable object
            if (updates.cable) {
              wireSegment.cable = { ...wireSegment.cable, ...updates.cable }
            }
            // Update other properties (excluding cable which is handled above)
            const { cable: _cable, ...otherUpdates } = updates
            Object.assign(wireSegment, otherUpdates)
          }

          state.isDirty = true
        }
      }),

    getWireSegmentById: (id: string) => {
      const { currentProject } = getProjectStoreApi().getState()
      if (!currentProject) return undefined
      return getOneWireSegmentsFromProject(currentProject).find((ws: WireSegment) => ws.id === id)
    },

    // Eendraad Note actions
    addEendraadNote: (note: Note) =>
      set((state) => {
        if (state.currentProject) {
          replaceEendraadNotesForProject(state.currentProject, [
            ...getEendraadNotesFromProject(state.currentProject),
            note,
          ])
          state.isDirty = true
        }
      }),

    updateEendraadNote: (id: string, updates: Partial<Note>) =>
      set((state) => {
        if (state.currentProject) {
          const notes = getMutableEendraadNotesForProject(state.currentProject)
          const idx = notes.findIndex((n: Note) => n.id === id)
          if (idx !== -1) {
            const note = notes[idx]
            if (!note) return
            const nextNotes = notes.slice()
            nextNotes[idx] = { ...note, ...updates }
            replaceEendraadNotesForProject(state.currentProject, nextNotes)
            state.isDirty = true
          }
        }
      }),

    deleteEendraadNote: (id: string) =>
      set((state) => {
        if (state.currentProject) {
          const notes = getMutableEendraadNotesForProject(state.currentProject)
          replaceEendraadNotesForProject(
            state.currentProject,
            notes.filter((n: Note) => n.id !== id)
          )
          state.isDirty = true
        }
      }),

    deleteEendraadNotes: (ids: string[]) =>
      set((state) => {
        if (state.currentProject) {
          const notes = getMutableEendraadNotesForProject(state.currentProject)
          replaceEendraadNotesForProject(
            state.currentProject,
            notes.filter((n: Note) => !ids.includes(n.id))
          )
          state.isDirty = true
        }
      }),

    getEendraadNoteById: (id: string) => {
      const { currentProject } = getProjectStoreApi().getState()
      if (!currentProject) return undefined
      return getEendraadNotesFromProject(currentProject).find((n: Note) => n.id === id)
    },

    getEendraadNotesByPanel: (panelId: string) => {
      const { currentProject } = getProjectStoreApi().getState()
      if (!currentProject) return []
      return getEendraadNotesFromProject(currentProject).filter((n: Note) => n.panelId === panelId)
    },

    // Sitplan Note actions
    addSitplanNote: (note: Note) =>
      set((state) => {
        if (state.currentProject) {
          replaceSitplanNotesForProject(state.currentProject, [
            ...getSitplanNotesFromProject(state.currentProject),
            note,
          ])
          state.isDirty = true
        }
      }),

    updateSitplanNote: (id: string, updates: Partial<Note>) =>
      set((state) => {
        if (state.currentProject) {
          const notes = getSitplanNotesFromProject(state.currentProject)
          const idx = notes.findIndex((n: Note) => n.id === id)
          if (idx !== -1) {
            const note = notes[idx]
            if (!note) return
            const nextNotes = notes.slice()
            nextNotes[idx] = { ...note, ...updates }
            replaceSitplanNotesForProject(state.currentProject, nextNotes)
            state.isDirty = true
          }
        }
      }),

    deleteSitplanNote: (id: string) =>
      set((state) => {
        if (state.currentProject) {
          const notes = getSitplanNotesFromProject(state.currentProject)
          replaceSitplanNotesForProject(
            state.currentProject,
            notes.filter((n: Note) => n.id !== id)
          )
          state.isDirty = true
        }
      }),

    deleteSitplanNotes: (ids: string[]) =>
      set((state) => {
        if (state.currentProject) {
          const notes = getSitplanNotesFromProject(state.currentProject)
          replaceSitplanNotesForProject(
            state.currentProject,
            notes.filter((n: Note) => !ids.includes(n.id))
          )
          state.isDirty = true
        }
      }),

    getSitplanNoteById: (id: string) => {
      const { currentProject } = getProjectStoreApi().getState()
      if (!currentProject) return undefined
      return getSitplanNotesFromProject(currentProject).find((n: Note) => n.id === id)
    },

    getSitplanNotesByFloor: (floorId: string) => {
      const { currentProject } = getProjectStoreApi().getState()
      if (!currentProject) return []
      return getSitplanNotesFromProject(currentProject).filter((n: Note) => n.floorId === floorId)
    },

    // Frame actions
    addFrame: (frame: Frame) =>
      set((state) => {
        if (state.currentProject) {
          getMutableEendraadFramesForProject(state.currentProject).push(frame)
          state.isDirty = true
        }
      }),

    updateFrame: (id: string, updates: Partial<Frame>) =>
      set((state) => {
        if (state.currentProject) {
          const frame = getMutableEendraadFramesForProject(state.currentProject).find(
            (f: Frame) => f.id === id
          )
          if (frame) {
            Object.assign(frame, updates)
            state.isDirty = true
          }
        }
      }),

    deleteFrame: (id: string) =>
      set((state) => {
        if (state.currentProject) {
          const frames = getMutableEendraadFramesForProject(state.currentProject)
          replaceEendraadFramesForProject(
            state.currentProject,
            frames.filter((f: Frame) => f.id !== id)
          )
          state.isDirty = true
        }
      }),

    deleteFrames: (ids: string[]) =>
      set((state) => {
        if (state.currentProject) {
          const frames = getMutableEendraadFramesForProject(state.currentProject)
          replaceEendraadFramesForProject(
            state.currentProject,
            frames.filter((f: Frame) => !ids.includes(f.id))
          )
          state.isDirty = true
        }
      }),

    getFrameById: (id: string) => {
      const { currentProject } = getProjectStoreApi().getState()
      if (!currentProject) return undefined
      return getEendraadFramesFromProject(currentProject).find((f: Frame) => f.id === id)
    },

    getFramesByPanel: (panelId: string) => {
      const { currentProject } = getProjectStoreApi().getState()
      if (!currentProject) return []
      return getEendraadFramesFromProject(currentProject).filter((f: Frame) => f.panelId === panelId)
    },

})
