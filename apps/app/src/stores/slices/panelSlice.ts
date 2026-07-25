import { appendUndoSnapshotInStore, cloneProjectForHistory, projectHistory, sanitizeOverlayMap } from './projectStoreHistory'
import type { ProjectSliceCreator } from './projectStoreTypes'
import { recordSessionAction } from '@/lib/diagnostics/sessionActionLog'
import { findParentCircuitInfo } from '@/lib/eendraad/findParentCircuitInfo'
import { logger } from '@/lib/logger'
import {
  applyAutomaticEendraadNamingAllPanelsInProject,
  arePanelGridSlotsEqual,
  deletePanelFromProject,
  findCircuitById,
  findCircuitOwner,
  findProtectionSupplyingPanel,
  flushAutomaticEendraadNamingAfterPanelGridMutation,
  isModuleRefValid,
  isSharedSupplyTrunkModuleRef,
  maybeApplyAutomaticEendraadNamingForPanel,
  panelContainsDescendant,
  panelGridModuleRefKey,
  panelGridSlotMutationOnlyChangesProtections,
  removePanelFromHierarchy,
  syncManualChronologyForInstallDateUpdate,
} from '@/lib/eendraad/projectElectricalDomain'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { ejectSupplyTrunkFromMainGridSlot, healSupplyTrunkMisplacedOnMainGridForPanel } from '@/lib/panel/healSupplyTrunkGrid'
import { cascadeMainEarthingToPanels, inheritEarthingFromMainForNewPanel } from '@/lib/panel/panelEarthingSync'
import { findPanelById } from '@/lib/panel/panelTree'
import { applyPanelRowChange } from '@/components/canvas/panel/panelRowChange'
import { getViewportCenterPlanSpaceIfApplicable } from '@/lib/plan/autoSitplanPlacement'
import { getCompatibilityFloorsFromProject } from '@/lib/projectV2/buildingFloors'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  getMutableElectricalInstallationForProject,
  getMutableElectricalPanelsForProject,
} from '@/lib/projectV2/electrical'
import { useUIStore } from '@/stores/uiStore'
import type { Circuit } from '@/types/schema'
import { ensurePanelPlacement } from '@/utils/panelPlacement'
import { generateId } from '@/utils/project'
import { supportsExtendedInstallationProfiles } from '@/lib/editionInstallationProfileCapabilities'
import { DEFAULT_INSTALLATION_PROFILE } from '@/lib/installationProfile'

export const createPanelSlice: ProjectSliceCreator = (set, get) => ({
    // Panel actions
    updateInstallation: (updates) =>
      set((state) => {
        if (state.currentProject) {
          const installation = getMutableElectricalInstallationForProject(state.currentProject)
          if (!installation) return
          const permittedUpdates =
    supportsExtendedInstallationProfiles(state.currentProjectStorageMode)
              ? updates
              : { ...updates, installationProfile: DEFAULT_INSTALLATION_PROFILE }
          Object.assign(installation, permittedUpdates)
          // Keep feed topology in sync with installation supply edits (cable/devices),
          // otherwise supply-wire UI can read stale shared/root feed cable values.
          ensureInstallationFeedTopology(
            installation,
            getMutableElectricalPanelsForProject(state.currentProject)
          )
          if (state.currentProject.project) {
            state.currentProject.project.updatedAt = new Date().toISOString()
          }
          state.isDirty = true
        }
      }),

    applyAutomaticEendraadNamingAllPanels: () =>
      set((state) => {
        if (!state.currentProject) return
        applyAutomaticEendraadNamingAllPanelsInProject(state.currentProject)
        state.isDirty = true
      }),

    addPanel: (panel, parentPanelId) =>
      set((state) => {
        if (state.currentProject) {
          const projectPanels = getMutableElectricalPanelsForProject(state.currentProject)
          const parentPanel = parentPanelId
            ? findPanelById(projectPanels, parentPanelId)
            : undefined
          if (parentPanelId) {
            if (parentPanel) {
              parentPanel.subPanels.push(panel)
            } else {
              // Fallback to root if parent not found
              projectPanels.push(panel)
            }
          } else {
            projectPanels.push(panel)
          }

          inheritEarthingFromMainForNewPanel(getMutableElectricalPanelsForProject(state.currentProject), panel)

          // Automatically create endpoint and placement for panel on plan.
          // When the plan canvas is visible, prefer dropping near the center
          // of the current plan viewport; ensurePanelPlacement will still
          // separate to the nearest non-overlapping position.
          const uiSnap = useUIStore.getState()
          const preferredPlanPos = uiSnap.activeFloorId
            ? (getViewportCenterPlanSpaceIfApplicable(
                uiSnap.viewportLayout,
                uiSnap.planCanvasViewportPx,
                uiSnap.activeFloorId,
                uiSnap.activeFloorId,
                uiSnap.planView
              ) ?? undefined)
            : undefined
          const panelPlacement = ensurePanelPlacement(state.currentProject, panel, {
            ...(preferredPlanPos ? { preferredPlanPos } : {}),
          })
          if (panelPlacement) {
            // Find or create a dummy circuit for the panel endpoint
            const panelCircuit = findCircuitById(
              findPanelById(getMutableElectricalPanelsForProject(state.currentProject), panel.id)!,
              'PANEL'
            )

            if (!panelCircuit) {
              // Create a dummy circuit for the panel endpoint
              const dummyCircuit: Circuit = {
                id: generateId(),
                code: 'PANEL',
                kind: 'other',
                cable: {
                  kind: 'XVB',
                  conductors: 3,
                  sectionMm2: 6,
                  hasPE: true,
                },
                endpoints: [],
              }
              const targetPanel = findPanelById(getMutableElectricalPanelsForProject(state.currentProject), panel.id)!
              targetPanel.circuits.push(dummyCircuit)

              // Update endpoint with correct circuit ID
              panelPlacement.endpoint.placements = [panelPlacement.placement]
              dummyCircuit.endpoints.push(panelPlacement.endpoint)
            } else {
              // Add placement to existing endpoint
              const existingEndpoint = panelCircuit.circuit.endpoints.find(
                (e) =>
                  e.symbol === 'panel_distribution' &&
                  (e.panelId === panel.id || e.label === panel.name)
              )
              if (existingEndpoint) {
                existingEndpoint.placements.push(panelPlacement.placement)
              } else {
                panelPlacement.endpoint.placements = [panelPlacement.placement]
                panelCircuit.circuit.endpoints.push(panelPlacement.endpoint)
              }
            }
          }

          const installation = getMutableElectricalInstallationForProject(state.currentProject)
          if (!installation) return
          ensureInstallationFeedTopology(
            installation,
            getMutableElectricalPanelsForProject(state.currentProject)
          )

          state.isDirty = true
        }
      }),

    setPlanFloorOverlayVisibleByBaseFloorId: (map) =>
      set((state) => {
        const floors = state.currentProject
          ? getCompatibilityFloorsFromProject(state.currentProject)
          : []
        state.planFloorOverlayVisibleByBaseFloorId = sanitizeOverlayMap(map, floors)
      }),

    updatePanel: (id, updates) =>
      set((state) => {
        if (state.currentProject) {
          const panel = findPanelById(getMutableElectricalPanelsForProject(state.currentProject), id)
          if (panel) {
            const updatesToApply = { ...updates }
            if (
              typeof updatesToApply.name === 'string' &&
              updatesToApply.name.trim().length === 0
            ) {
              delete updatesToApply.name
            }
            if (Object.keys(updatesToApply).length === 0) return
            const previousName = panel.name
            const isMainEarthingUpdate =
              panel.isMain && Object.prototype.hasOwnProperty.call(updatesToApply, 'earthingSystem')
            const previousMainEarthing = isMainEarthingUpdate ? panel.earthingSystem : undefined
            Object.assign(panel, updatesToApply)
            syncManualChronologyForInstallDateUpdate(
              state.currentProject,
              { id, type: 'panel' },
              updatesToApply
            )
            if (isMainEarthingUpdate) {
              cascadeMainEarthingToPanels(
                getMutableElectricalPanelsForProject(state.currentProject),
                panel,
                panel.earthingSystem,
                previousMainEarthing
              )
            }
            // Keep the panel_distribution endpoint label aligned with panel.name.
            // This avoids false orphan warnings right after renaming a panel.
            if (typeof updatesToApply.name === 'string' && updatesToApply.name.trim().length > 0) {
              const syncCircuitEndpoints = (circuit: Circuit) => {
                for (const endpoint of circuit.endpoints ?? []) {
                  if (endpoint.symbol !== 'panel_distribution') continue
                  // PANEL pseudo-circuit endpoints are canonical panel symbols for this panel.
                  // Always sync them on rename, even if legacy data still has stale labels/panelId.
                  if (
                    circuit.code === 'PANEL' ||
                    endpoint.panelId === panel.id ||
                    endpoint.label === previousName
                  ) {
                    endpoint.label = panel.name
                    endpoint.panelId = panel.id
                  }
                }
              }
              for (const circuit of panel.circuits ?? []) {
                syncCircuitEndpoints(circuit)
              }
              for (const protection of panel.protections ?? []) {
                for (const circuit of protection.circuits ?? []) {
                  syncCircuitEndpoints(circuit)
                }
              }
            }
            state.isDirty = true
          }
        }
      }),

    movePanelSupply: (panelId, target) =>
      set((state) => {
        const project = state.currentProject
        if (!project) return
        const panels = getElectricalPanelsFromProject(project)
        const installation = getElectricalInstallationFromProject(project)
        if (!installation) return

        const panel = findPanelById(panels, panelId)
        if (!panel) return

        if (target.type === 'circuit') {
          const targetOwner = findCircuitOwner(panels, target.circuitId)
          if (!targetOwner?.protection) return
          if (targetOwner.protection.subPanelId && targetOwner.protection.subPanelId !== panelId)
            return
          if (targetOwner.panel.id === panelId) return
          if (panelContainsDescendant(panel, targetOwner.panel.id)) return
        }

        const detachedPanel = removePanelFromHierarchy(panels, panelId)
        if (!detachedPanel) return

        const previousFeeder = findProtectionSupplyingPanel(panels, panelId)
        if (previousFeeder) {
          previousFeeder.protection.subPanelId = undefined
        }

        if (target.type === 'supply') {
          detachedPanel.isMain = true
          panels.push(detachedPanel)
        } else {
          const targetOwner = findCircuitOwner(panels, target.circuitId)
          if (!targetOwner?.protection) {
            detachedPanel.isMain = true
            panels.push(detachedPanel)
          } else {
            detachedPanel.isMain = false
            targetOwner.panel.subPanels.push(detachedPanel)
            targetOwner.protection.subPanelId = detachedPanel.id
          }
        }

        const topology = ensureInstallationFeedTopology(installation, panels)
        topology.rootFeeds = topology.rootFeeds.filter((feed) => {
          const rootPanel = findPanelById(panels, feed.panelId)
          return rootPanel?.isMain === true
        })

        state.isDirty = true
      }),

    updatePanelGrid: (panelId, updates) =>
      set((state) => {
        if (state.currentProject) {
          const panel = findPanelById(getElectricalPanelsFromProject(state.currentProject), panelId)
          if (panel) {
            if (!panel.gridView) {
              panel.gridView = { rows: 8, columns: 12, feedFromTop: false, slots: [] }
            }
            const resizedSlots =
              updates.rows != null && updates.rows !== panel.gridView.rows
                ? applyPanelRowChange(panel, state.currentProject, updates.rows).slots
                : null
            Object.assign(panel.gridView, updates)
            if (resizedSlots) panel.gridView.slots = resizedSlots
            state.isDirty = true
          }
        }
      }),

    updatePanelGridSlots: (panelId, slots, options) =>
      set((state) => {
        if (state.currentProject) {
          const panel = findPanelById(getElectricalPanelsFromProject(state.currentProject), panelId)
          if (panel) {
            if (!panel.gridView) {
              panel.gridView = { rows: 8, columns: 12, feedFromTop: false, slots: [] }
            }
            // Single source of truth: filter out invalid slots before storing
            const validMainSlots = slots.filter((s) => {
              if (isSharedSupplyTrunkModuleRef(state.currentProject!, panel, s.module)) return false
              try {
                return isModuleRefValid(s.module, state.currentProject!)
              } catch {
                return false
              }
            })
            const currentMainSlots = panel.gridView.slots ?? []
            if (arePanelGridSlotsEqual(currentMainSlots, validMainSlots)) {
              return
            }
            panel.gridView.slots = validMainSlots
            const dedupeSupplyAgainstMain = () => {
              if (panel.gridView!.supplyPanelSlots && panel.gridView!.supplyPanelSlots.length > 0) {
                const mainKeys = new Set(
                  (panel.gridView!.slots ?? []).map((s) => panelGridModuleRefKey(s.module))
                )
                const filteredSupply = panel.gridView!.supplyPanelSlots.filter(
                  (s) => !mainKeys.has(panelGridModuleRefKey(s.module))
                )
                panel.gridView!.supplyPanelSlots =
                  filteredSupply.length > 0 ? filteredSupply : undefined
              }
            }
            dedupeSupplyAgainstMain()
            if (panel.isMain) {
              healSupplyTrunkMisplacedOnMainGridForPanel(panel, state.currentProject!)
              dedupeSupplyAgainstMain()
            }
            state.isDirty = true
            const protectionOnlyMutation = panelGridSlotMutationOnlyChangesProtections(
              currentMainSlots,
              panel.gridView.slots
            )
            if (!options?.preserveProtectionOrder && protectionOnlyMutation) {
              flushAutomaticEendraadNamingAfterPanelGridMutation(state.currentProject, panelId)
            } else {
              maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
            }
          }
        }
      }),

    ejectToSupplyPanel: (panelId, moduleRef) =>
      set((state) => {
        if (!state.currentProject || !findPanelById(getMutableElectricalPanelsForProject(state.currentProject), panelId)?.isMain)
          return
        const panel = findPanelById(getMutableElectricalPanelsForProject(state.currentProject), panelId)!
        if (ejectSupplyTrunkFromMainGridSlot(panel, state.currentProject, moduleRef)) {
          state.isDirty = true
        }
      }),

    returnFromSupplyPanel: (panelId, moduleRef) =>
      set((state) => {
        if (!state.currentProject) return
        const panel = findPanelById(getElectricalPanelsFromProject(state.currentProject), panelId)
        if (!panel?.gridView?.supplyPanelSlots) return
        const key = panelGridModuleRefKey(moduleRef)
        const removedSlot = panel.gridView.supplyPanelSlots.find(
          (s) => panelGridModuleRefKey(s.module) === key
        )
        const supplySlots = panel.gridView.supplyPanelSlots.filter(
          (s) => panelGridModuleRefKey(s.module) !== key
        )
        if (supplySlots.length === panel.gridView.supplyPanelSlots.length) return
        panel.gridView.supplyPanelSlots = supplySlots.length > 0 ? supplySlots : undefined
        if (supplySlots.length === 0) panel.gridView.supplyPanelVisible = false
        const mainSlots = panel.gridView.slots ?? []
        const usedCols = new Set(mainSlots.map((s) => s.row * 1000 + s.col))
        const rows = panel.gridView.rows ?? 8
        const cols = panel.gridView.columns ?? 12
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (!usedCols.has(r * 1000 + c)) {
              panel.gridView!.slots = [
                ...mainSlots,
                {
                  row: r,
                  col: c,
                  ...(removedSlot?.moduleWidthManual === true && removedSlot.moduleWidth != null
                    ? { moduleWidth: removedSlot.moduleWidth, moduleWidthManual: true }
                    : {}),
                  module: moduleRef,
                },
              ]
              state.isDirty = true
              return
            }
          }
        }
        state.isDirty = true
      }),

    hideModuleFromPanel: (panelId, moduleRefKey) =>
      set((state) => {
        if (!state.currentProject) return
        const panel = findPanelById(getMutableElectricalPanelsForProject(state.currentProject), panelId)
        if (!panel) return
        if (!panel.gridView) {
          panel.gridView = { rows: 8, columns: 12, feedFromTop: false, slots: [] }
        }
        const hidden = panel.gridView.hiddenModuleKeys ?? []
        const shown = panel.gridView.shownModuleKeys ?? []
        let changed = false
        if (!hidden.includes(moduleRefKey)) {
          panel.gridView.hiddenModuleKeys = [...hidden, moduleRefKey]
          changed = true
        }
        if (shown.includes(moduleRefKey)) {
          panel.gridView.shownModuleKeys = shown.filter((key) => key !== moduleRefKey)
          if (panel.gridView.shownModuleKeys.length === 0) panel.gridView.shownModuleKeys = undefined
          changed = true
        }
        if (!changed) return
        state.isDirty = true
      }),

    unhideModuleFromPanel: (panelId, moduleRefKey) =>
      set((state) => {
        if (!state.currentProject) return
        const panel = findPanelById(getMutableElectricalPanelsForProject(state.currentProject), panelId)
        if (!panel) return
        if (!panel.gridView) {
          panel.gridView = { rows: 8, columns: 12, feedFromTop: false, slots: [] }
        }
        let changed = false
        if (panel.gridView.hiddenModuleKeys?.length) {
          const previousLength = panel.gridView.hiddenModuleKeys.length
          panel.gridView.hiddenModuleKeys = panel.gridView.hiddenModuleKeys.filter(
            (k) => k !== moduleRefKey
          )
          changed = panel.gridView.hiddenModuleKeys.length !== previousLength
          if (panel.gridView.hiddenModuleKeys.length === 0)
            panel.gridView.hiddenModuleKeys = undefined
        }
        const shown = panel.gridView.shownModuleKeys ?? []
        if (!shown.includes(moduleRefKey)) {
          panel.gridView.shownModuleKeys = [...shown, moduleRefKey]
          changed = true
        }
        if (!changed) return
        state.isDirty = true
      }),

    updateSupplyPanelSlots: (panelId, slots) =>
      set((state) => {
        if (!state.currentProject) return
        const panel = findPanelById(getMutableElectricalPanelsForProject(state.currentProject), panelId)
        if (!panel?.gridView) return
        // Single source of truth: filter out invalid slots before storing
        const validSlots = slots.filter((s) => {
          try {
            return isModuleRefValid(s.module, state.currentProject!)
          } catch {
            return false
          }
        })
        const supplyPanelVisible = validSlots.length > 0
        if (
          arePanelGridSlotsEqual(panel.gridView.supplyPanelSlots, validSlots) &&
          panel.gridView.supplyPanelVisible === supplyPanelVisible
        ) {
          return
        }
        panel.gridView.supplyPanelSlots = validSlots.length > 0 ? validSlots : undefined
        // Keep slot ownership unique: a module key can live in either supply OR main slots, never both.
        if (panel.gridView.slots && panel.gridView.slots.length > 0 && validSlots.length > 0) {
          const supplyKeys = new Set(validSlots.map((s) => panelGridModuleRefKey(s.module)))
          panel.gridView.slots = panel.gridView.slots.filter(
            (s) => !supplyKeys.has(panelGridModuleRefKey(s.module))
          )
        }
        panel.gridView.supplyPanelVisible = supplyPanelVisible
        state.isDirty = true
      }),

    setSupplyPanelVisible: (panelId, visible) =>
      set((state) => {
        if (!state.currentProject) return
        const panel = findPanelById(getMutableElectricalPanelsForProject(state.currentProject), panelId)
        if (!panel?.gridView) return
        if (visible) {
          panel.gridView.supplyPanelVisible = true
          state.isDirty = true
          return
        }
        const supplySlots = panel.gridView.supplyPanelSlots ?? []
        if (supplySlots.length === 0) {
          panel.gridView.supplyPanelVisible = false
          state.isDirty = true
          return
        }
        const mainSlots = panel.gridView.slots ?? []
        const usedCols = new Set(mainSlots.map((s) => s.row * 1000 + s.col))
        const rows = panel.gridView.rows ?? 8
        const cols = panel.gridView.columns ?? 12
        for (const slot of supplySlots) {
          let placed = false
          for (let r = 0; r < rows && !placed; r++) {
            for (let c = 0; c < cols && !placed; c++) {
              if (!usedCols.has(r * 1000 + c)) {
                mainSlots.push({
                  row: r,
                  col: c,
                  module: slot.module,
                  ...(slot.moduleWidthManual === true && slot.moduleWidth != null
                    ? { moduleWidth: slot.moduleWidth, moduleWidthManual: true }
                    : {}),
                })
                usedCols.add(r * 1000 + c)
                placed = true
              }
            }
          }
        }
        panel.gridView.supplyPanelSlots = []
        panel.gridView.supplyPanelVisible = false
        state.isDirty = true
      }),

    applyPanelAutoArrange: (panelId, mainSlots, supplySlots) => {
      const projectBefore = get().currentProject
      if (!projectBefore) return
      const snapshotBefore = cloneProjectForHistory(projectBefore)
      let applied = false
      projectHistory.suppressNextDebouncedRun()
      try {
        set((state) => {
          if (!state.currentProject) return
          const panel = findPanelById(getElectricalPanelsFromProject(state.currentProject), panelId)
          if (!panel) return
          if (!panel.gridView) {
            panel.gridView = { rows: 8, columns: 12, feedFromTop: false, slots: [] }
          }
          const previousMainSlots = panel.gridView.slots ?? []
          const validMainSlots = mainSlots.filter((s) => {
            try {
              return isModuleRefValid(s.module, state.currentProject!)
            } catch {
              return false
            }
          })
          const validSupplySlots = supplySlots.filter((s) => {
            try {
              return isModuleRefValid(s.module, state.currentProject!)
            } catch {
              return false
            }
          })
          const mainKeys = new Set(validMainSlots.map((s) => panelGridModuleRefKey(s.module)))
          let finalSupply = validSupplySlots
          if (validMainSlots.length > 0 && validSupplySlots.length > 0) {
            finalSupply = validSupplySlots.filter(
              (s) => !mainKeys.has(panelGridModuleRefKey(s.module))
            )
          }
          panel.gridView.slots = validMainSlots
          panel.gridView.supplyPanelSlots = finalSupply.length > 0 ? finalSupply : undefined
          panel.gridView.supplyPanelVisible = finalSupply.length > 0
          if (panel.isMain) {
            healSupplyTrunkMisplacedOnMainGridForPanel(panel, state.currentProject!)
          }
          state.isDirty = true
          applied = true
          if (
            panelGridSlotMutationOnlyChangesProtections(
              previousMainSlots,
              panel.gridView.slots
            )
          ) {
            flushAutomaticEendraadNamingAfterPanelGridMutation(state.currentProject, panelId)
          } else {
            maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
          }
        })
      } finally {
        projectHistory.clearDebouncedSuppression()
      }
      if (applied) {
        appendUndoSnapshotInStore(set, snapshotBefore)
        recordSessionAction('panel auto-arrange')
      }
    },

    rewireModules: (originCircuitId, targetCircuitId) =>
      set((state) => {
        if (!state.currentProject) return
        if (originCircuitId === targetCircuitId) return // Can't rewire to self

        // Find both circuits
        let originCircuit: Circuit | null = null
        let targetCircuit: Circuit | null = null

        for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
          const originResult = findCircuitById(panel, originCircuitId)
          if (originResult) originCircuit = originResult.circuit

          const targetResult = findCircuitById(panel, targetCircuitId)
          if (targetResult) targetCircuit = targetResult.circuit

          if (originCircuit && targetCircuit) break
        }

        if (!originCircuit || !targetCircuit) {
          logger.warn('[rewireModules] Could not find circuits', {
            originCircuitId,
            targetCircuitId,
          })
          return
        }

        // Remove target from its current parent (if any)
        const targetParentInfo = findParentCircuitInfo(targetCircuitId, getMutableElectricalPanelsForProject(state.currentProject))
        if (targetParentInfo) {
          const parentSubCircuitIds = targetParentInfo.parentCircuit.subCircuitIds ?? []
          const index = parentSubCircuitIds.indexOf(targetCircuitId)
          if (index !== -1) {
            parentSubCircuitIds.splice(index, 1)
            // Update parent circuit
            for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
              const result = findCircuitById(panel, targetParentInfo.parentCircuit.id)
              if (result) {
                result.circuit.subCircuitIds =
                  parentSubCircuitIds.length > 0 ? parentSubCircuitIds : undefined
                break
              }
            }
          }
        }

        // Add target to origin's subCircuitIds
        const originSubCircuitIds = originCircuit.subCircuitIds ?? []
        if (!originSubCircuitIds.includes(targetCircuitId)) {
          originSubCircuitIds.push(targetCircuitId)
          // Update origin circuit
          for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
            const result = findCircuitById(panel, originCircuitId)
            if (result) {
              result.circuit.subCircuitIds = originSubCircuitIds
              break
            }
          }
        }

        state.isDirty = true
        applyAutomaticEendraadNamingAllPanelsInProject(state.currentProject)
      }),

    deletePanel: (id) =>
      set((state) => {
        if (state.currentProject) {
          const targetPanel = findPanelById(getMutableElectricalPanelsForProject(state.currentProject), id)
          if (targetPanel?.isMain) {

            logger.warn('[projectStore] deletePanel blocked for main panel', {
              panelId: id,
              panelName: targetPanel.name,
            })
            return
          }
          if (deletePanelFromProject(state.currentProject, id)) {
            state.isDirty = true
          }
        }
      }),

})
