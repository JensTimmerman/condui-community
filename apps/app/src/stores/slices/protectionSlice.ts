import type { ProjectSliceCreator } from './projectStoreTypes'
import { getModuleWidthInCols } from '@/components/canvas/panel/panelGridLayout'
import { recordSessionAction } from '@/lib/diagnostics/sessionActionLog'
import { resolveUniqueProtectionLabelOnPanel } from '@/lib/eendraad/automaticMainBusNaming'
import { renameCircuitCodeKeepingEndpoints } from '@/lib/eendraad/circuitEndpointLabels'
import { runDuplicateProtectionLeft } from '@/lib/eendraad/duplicateProtectionLeftCore'
import { ensureSitplanPlacementsForEndpoints } from '@/lib/eendraad/duplicateSitplanHelpers'
import { findParentCircuitInfo } from '@/lib/eendraad/findParentCircuitInfo'
import {
  liftCircuitContentAboveOwnProtection,
  moveCircuitToCircuitContentPosition,
} from '@/lib/eendraad/circuitContentInsertion'
import { pruneEendraadFrames } from '@/lib/eendraad/frameContent'
import { logger } from '@/lib/logger'
import {
  collectCircuitClosureDownstreamFromProtection,
  computeMainBusInsertIndexForEjectedProtection,
  dedupePanelProtectionsInPanelTree,
  deriveDescriptiveNameFromProtectionForNewSubPanel,
  getMainBusItemsWithIndices,
  getMainBusOrder,
  moveProtectionToMainBusInsertIndex,
  pickRepresentativeCircuitIdForMainBusMove,
  promoteMovedSubPanelRootToIncomingTrunk,
  protectionDeviceToSubPanelIncomingTrunkDevice,
  relocateProtectionToPanelMainBus,
} from '@/lib/eendraad/mainBusOrder'
import {
  applyAutomaticEendraadNamingAllPanelsInProject,
  clearStaleAutoModuleWidthForModuleRef,
  deleteLinkedSubPanelsIfOrphaned,
  ensureLinkedSubPanelsHaveOwnPanelEndpoint,
  ensureRcboSensitivityOnProtection,
  findCircuitById,
  findPanelContainingCircuit,
  findPanelOwningProtection,
  findProtectionById,
  getAllCircuits,
  maybeApplyAutomaticEendraadNamingForPanel,
  migrateSubCircuitContentToParent,
  prunePanelGridSlotsForUnresolvedModules,
  rewirePromotedIncomingProtectionGridRef,
  removePanelGridDuplicateRefs,
  rewirePanelGridProtectionModuleId,
  syncLinkedSubPanelHierarchy,
  syncManualChronologyForInstallDateUpdate,
} from '@/lib/eendraad/projectElectricalDomain'
import { resolveSecondaryBusEjectSelection } from '@/lib/eendraad/secondaryBusEjectEligibility'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { findPanelById } from '@/lib/panel/panelTree'
import { getViewportCenterPlanSpaceIfApplicable } from '@/lib/plan/autoSitplanPlacement'
import {
  getMutableElectricalInstallationForProject,
  getMutableElectricalPanelsForProject,
} from '@/lib/projectV2/electrical'
import {
  getDefaultProtectionProps,
  getVoltagePolesConfig,
  protectionCreationTemplateFromDevice,
} from '@/lib/protectionDefaults'
import {
  DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
  createDefaultAcCircuitCable,
} from '@/lib/wires/circuitWireDefaults'
import { useUIStore } from '@/stores/uiStore'
import type { Circuit, Panel, PanelGridModuleRef, ProtectionDevice } from '@/types/schema'
import { ensurePanelPlacement } from '@/utils/panelPlacement'
import { countPanels, generateId, getNextAvailableCircuitCode } from '@/utils/project'

function panelTreeHasSurvivingFeeder(
  panels: Panel[],
  subPanelId: string,
  deletedProtectionIds: ReadonlySet<string>
): boolean {
  for (const panel of panels) {
    if (
      panel.protections.some(
        (protection) =>
          !deletedProtectionIds.has(protection.id) && protection.subPanelId === subPanelId
      )
    ) {
      return true
    }
    if (panelTreeHasSurvivingFeeder(panel.subPanels, subPanelId, deletedProtectionIds)) {
      return true
    }
  }
  return false
}

function preserveDeletedProtectionPanelLinks(
  panels: Panel[],
  deletedProtectionIds: ReadonlySet<string>
): void {
  const preservedPanelIds = new Set<string>()

  const preserveInPanel = (panel: Panel): void => {
    for (let index = 0; index < panel.protections.length; index += 1) {
      const protection = panel.protections[index]
      const subPanelId = protection?.subPanelId
      if (
        !protection ||
        !deletedProtectionIds.has(protection.id) ||
        !subPanelId ||
        preservedPanelIds.has(subPanelId) ||
        panelTreeHasSurvivingFeeder(panels, subPanelId, deletedProtectionIds)
      ) {
        continue
      }

      const carrier: ProtectionDevice = {
        id: generateId(),
        type: 'OTHER',
        label: '',
        circuits: protection.circuits ?? [],
        subPanelId,
        directPanelFeeder: true,
      }
      panel.protections.splice(index + 1, 0, carrier)
      preservedPanelIds.add(subPanelId)
      index += 1
    }

    for (const subPanel of panel.subPanels) preserveInPanel(subPanel)
  }

  for (const panel of panels) preserveInPanel(panel)
}

export const createProtectionSlice: ProjectSliceCreator = (set, get) => ({
  // Protection actions
  addProtection: (panelId, protection) =>
    set((state) => {
      if (state.currentProject) {
        const panels = getMutableElectricalPanelsForProject(state.currentProject)
        const panel = findPanelById(panels, panelId)
        if (panel) {
          if (!protection.circuits) {
            protection.circuits = []
          }
          ensureRcboSensitivityOnProtection(protection)
          panel.protections.push(protection)
          state.isDirty = true
          maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
        }
      }
    }),

  insertProtectionAfter: (panelId, protection, afterProtectionId) =>
    set((state) => {
      if (state.currentProject) {
        const panels = getMutableElectricalPanelsForProject(state.currentProject)
        const panel = findPanelById(panels, panelId)
        if (panel) {
          const idx = panel.protections.findIndex((p) => p.id === afterProtectionId)
          if (idx >= 0) {
            if (!protection.circuits) protection.circuits = []
            ensureRcboSensitivityOnProtection(protection)
            panel.protections.splice(idx + 1, 0, protection)
            state.isDirty = true
            maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
          }
        }
      }
    }),

  insertProtectionBefore: (panelId, protection, beforeProtectionId) =>
    set((state) => {
      if (state.currentProject) {
        const panels = getMutableElectricalPanelsForProject(state.currentProject)
        const panel = findPanelById(panels, panelId)
        if (panel) {
          const idx = panel.protections.findIndex((p) => p.id === beforeProtectionId)
          if (idx >= 0) {
            if (!protection.circuits) protection.circuits = []
            ensureRcboSensitivityOnProtection(protection)
            panel.protections.splice(idx, 0, protection)
            state.isDirty = true
            maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
          }
        }
      }
    }),

  duplicateProtectionLeft: (protectionId, mainBusPlacement) =>
    runDuplicateProtectionLeft(
      protectionId,
      {
        getProject: () => get().currentProject,
        withSingleUndoEntry: (fn, opts) => get().withSingleUndoEntry(fn, opts),
        insertProtectionAfter: (...a) => get().insertProtectionAfter(...a),
        addCircuit: (...a) => get().addCircuit(...a),
        setDraft: (recipe) => set(recipe),
        ensureSitplanForEndpoints: (endpointIds) => {
          const project = get().currentProject
          if (!project || endpointIds.length === 0) return
          const ui = useUIStore.getState()
          ensureSitplanPlacementsForEndpoints(
            project,
            endpointIds,
            (id) => get().getEndpointById(id),
            (endpointId, placement) => get().addPlacement(endpointId, placement),
            {
              activeFloorId: ui.activeFloorId,
              viewportLayout: ui.viewportLayout,
              planCanvasViewportPx: ui.planCanvasViewportPx,
              planView: ui.planView,
            }
          )
        },
      },
      mainBusPlacement
    ),

  updateProtection: (id, updates) =>
    set((state) => {
      if (state.currentProject) {
        const owningPanel = findPanelOwningProtection(
          getMutableElectricalPanelsForProject(state.currentProject),
          id
        )
        if (owningPanel) {
          const protection = owningPanel.protections.find((p) => p.id === id)
          if (protection) {
            const oldLabel = protection.label
            const newLabelRaw = updates.label
            const nextUpdates =
              typeof newLabelRaw === 'string'
                ? {
                    ...updates,
                    label: resolveUniqueProtectionLabelOnPanel(
                      owningPanel,
                      id,
                      newLabelRaw,
                      state.currentProject
                    ),
                  }
                : updates
            const newLabel = typeof nextUpdates.label === 'string' ? nextUpdates.label.trim() : null

            // Fast no-op: if this update doesn't actually change anything, skip.
            let hasAnyChange = false
            for (const [k, v] of Object.entries(nextUpdates)) {
              const key = k as keyof ProtectionDevice
              if (key === 'label') {
                const next = typeof v === 'string' ? v : ''
                const curr = typeof protection.label === 'string' ? protection.label : ''
                if (next !== curr) hasAnyChange = true
                continue
              }
              const protectionValue = protection[key as keyof ProtectionDevice]
              if (!Object.is(protectionValue, v)) {
                hasAnyChange = true
                break
              }
            }
            if (!hasAnyChange) return

            const protectionRef: PanelGridModuleRef = { kind: 'protection', id: protection.id }
            const oldPoleWidth = getModuleWidthInCols(protectionRef, state.currentProject)

            // Apply protection updates
            Object.assign(protection, nextUpdates)
            syncManualChronologyForInstallDateUpdate(
              state.currentProject,
              { id, type: 'protection' },
              nextUpdates
            )
            ensureRcboSensitivityOnProtection(protection)

            state.currentProject.project.protectionCreationTemplates = {
              ...(state.currentProject.project.protectionCreationTemplates ?? {}),
              [protection.type]: protectionCreationTemplateFromDevice(protection),
            }

            const newPoleWidth = getModuleWidthInCols(protectionRef, state.currentProject)
            if (oldPoleWidth !== newPoleWidth) {
              clearStaleAutoModuleWidthForModuleRef(
                getMutableElectricalPanelsForProject(state.currentProject),
                protectionRef,
                oldPoleWidth
              )
            }

            // If the protection label changed, update circuit codes to match, including clears.
            if (newLabel !== null && newLabel !== oldLabel) {
              if (protection.circuits?.length) {
                for (const circuit of protection.circuits) {
                  renameCircuitCodeKeepingEndpoints(circuit, newLabel)
                }
              }
            }

            state.lastWorkedCircuitId = protection.circuits?.[0]?.id ?? null
            state.isDirty = true
            return
          }
        }
        logger.info('[updateProtection] Protection not found', { id })
      }
    }),

  deleteProtection: (id, options) =>
    set((state) => {
      if (state.currentProject) {
        const panels = getMutableElectricalPanelsForProject(state.currentProject)
        // Before removing, migrate any subcircuit content back to the parent circuit
        let protectionToDelete: ProtectionDevice | undefined
        for (const panel of panels) {
          protectionToDelete = findProtectionById(panel, id)
          if (protectionToDelete) break
        }
        if (!protectionToDelete) {
          return
        }

        recordSessionAction(
          `delete protection "${protectionToDelete.label?.trim() || protectionToDelete.id}"`
        )

        migrateSubCircuitContentToParent(protectionToDelete, panels)
        const linkedSubPanelId = protectionToDelete.subPanelId
        const deletedProtectionIds = new Set([id])
        if (options?.preserveLinkedPanels && linkedSubPanelId) {
          preserveDeletedProtectionPanelLinks(panels, deletedProtectionIds)
        }

        let affectedPanelId: string | null = null
        const removeProtection = (panel: Panel): boolean => {
          const index = panel.protections.findIndex((p) => p.id === id)
          if (index !== -1) {
            panel.protections.splice(index, 1)
            affectedPanelId = panel.id
            return true
          }
          for (const subPanel of panel.subPanels) {
            if (removeProtection(subPanel)) return true
          }
          return false
        }

        for (const panel of panels) {
          if (removeProtection(panel)) {
            state.isDirty = true
            if (linkedSubPanelId && !options?.preserveLinkedPanels) {
              deleteLinkedSubPanelsIfOrphaned(state.currentProject, [linkedSubPanelId])
            }
            if (affectedPanelId) {
              maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, affectedPanelId)
            }
            pruneEendraadFrames(state.currentProject, { removedMemberIds: [id] })
            return
          }
        }
      }
    }),

  deleteProtections: (ids, options) =>
    set((state) => {
      if (state.currentProject) {
        const panels = getMutableElectricalPanelsForProject(state.currentProject)
        if (ids.length === 1) {
          const onlyId = ids[0]!
          let protLabel: string | undefined
          for (const panel of panels) {
            const prot = findProtectionById(panel, onlyId)
            if (prot) {
              protLabel = prot.label?.trim()
              break
            }
          }
          recordSessionAction(
            protLabel ? `delete protection "${protLabel}"` : `delete protection (${onlyId})`
          )
        } else if (ids.length > 1) {
          recordSessionAction(`delete ${ids.length} protections`)
        }

        const idsSet = new Set(ids)

        // Before removing, migrate subcircuit content for each protection being deleted
        for (const panel of panels) {
          const migrateInPanel = (p: Panel) => {
            for (const prot of p.protections) {
              if (idsSet.has(prot.id)) {
                migrateSubCircuitContentToParent(prot, panels)
              }
            }
            for (const subPanel of p.subPanels) migrateInPanel(subPanel)
          }
          migrateInPanel(panel)
        }

        const linkedSubPanelIds = new Set<string>()
        const collectLinkedSubPanels = (panel: Panel) => {
          for (const prot of panel.protections) {
            if (idsSet.has(prot.id) && prot.subPanelId) {
              linkedSubPanelIds.add(prot.subPanelId)
            }
          }
          for (const subPanel of panel.subPanels) collectLinkedSubPanels(subPanel)
        }
        for (const panel of panels) collectLinkedSubPanels(panel)

        if (options?.preserveLinkedPanels && linkedSubPanelIds.size > 0) {
          preserveDeletedProtectionPanelLinks(panels, idsSet)
        }

        // Remove all matching protections in a single pass
        const removeProtections = (panel: Panel) => {
          panel.protections = panel.protections.filter((p) => !idsSet.has(p.id))
          for (const subPanel of panel.subPanels) {
            removeProtections(subPanel)
          }
        }
        for (const panel of panels) {
          removeProtections(panel)
        }
        if (linkedSubPanelIds.size > 0 && !options?.preserveLinkedPanels) {
          deleteLinkedSubPanelsIfOrphaned(state.currentProject, linkedSubPanelIds)
        }
        pruneEendraadFrames(state.currentProject, { removedMemberIds: ids })
        state.isDirty = true
        applyAutomaticEendraadNamingAllPanelsInProject(state.currentProject)
      }
    }),

  moveCircuitOnMainBus: (panelId, circuitId, direction) =>
    set((state) => {
      logger.info('[moveCircuitOnMainBus]', { panelId, circuitId, direction })
      if (!state.currentProject) {
        logger.warn('[moveCircuitOnMainBus] No current project')
        return
      }
      const panel = findPanelById(
        getMutableElectricalPanelsForProject(state.currentProject),
        panelId
      )
      if (!panel) {
        logger.warn('[moveCircuitOnMainBus] Panel not found', { panelId })
        return
      }

      // Find the circuit - could be in panel.circuits or in a protection's circuits
      let circuit: Circuit | undefined
      let protection: ProtectionDevice | undefined
      let array: Circuit[] | undefined
      let index: number = -1

      // Check direct circuits first
      circuit = panel.circuits.find((c) => c.id === circuitId)
      if (circuit) {
        array = panel.circuits
        index = panel.circuits.indexOf(circuit)
      } else {
        // Check protection circuits
        for (const prot of panel.protections) {
          if (prot.circuits) {
            circuit = prot.circuits.find((c) => c.id === circuitId)
            if (circuit) {
              protection = prot
              array = prot.circuits
              index = prot.circuits.indexOf(circuit)
              break
            }
          }
        }
      }

      if (!circuit || !array || index === -1) {
        logger.warn('[moveCircuitOnMainBus] Circuit not found', {
          circuitId,
          foundCircuit: !!circuit,
          foundArray: !!array,
          index,
        })
        return
      }

      logger.info('[moveCircuitOnMainBus] Found circuit', {
        circuitId,
        isDirect: array === panel.circuits,
        protectionId: protection?.id,
      })

      const mainBusItems = getMainBusItemsWithIndices(panel)
      logger.info('[moveCircuitOnMainBus] Main bus items', {
        items: mainBusItems.map((i) => ({ type: i.type, id: i.id })),
      })

      // Find current item
      const currentItem = mainBusItems.find(
        (item) =>
          (item.type === 'circuit' && item.id === circuitId) ||
          (item.type === 'protection' && protection && item.id === protection.id)
      )

      if (!currentItem) {
        logger.warn('[moveCircuitOnMainBus] Current item not found in main bus items')
        return
      }

      const currentIndex = mainBusItems.indexOf(currentItem)
      logger.info('[moveCircuitOnMainBus] Current position', {
        currentIndex,
        total: mainBusItems.length,
      })

      if (direction === 'left' && currentIndex > 0) {
        // Swap with previous
        const prevItem = mainBusItems[currentIndex - 1]
        logger.info('[moveCircuitOnMainBus] Swapping with previous', { prevItem })
        if (!prevItem) {
          return
        }
        if (currentItem.type === 'circuit' && prevItem.type === 'circuit') {
          // Swap circuits
          const temp = panel.circuits[currentItem.index]
          if (!temp) return
          const prevCircuit = panel.circuits[prevItem.index]
          if (!prevCircuit) return
          panel.circuits[currentItem.index] = prevCircuit
          panel.circuits[prevItem.index] = temp
          logger.info('[moveCircuitOnMainBus] Swapped circuits')
        } else if (currentItem.type === 'protection' && prevItem.type === 'protection') {
          // Swap protections
          const temp = panel.protections[currentItem.index]
          if (!temp) return
          const prevProtection = panel.protections[prevItem.index]
          if (!prevProtection) return
          panel.protections[currentItem.index] = prevProtection
          panel.protections[prevItem.index] = temp
          logger.info('[moveCircuitOnMainBus] Swapped protections')
        }
        state.isDirty = true
        maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
      } else if (direction === 'right' && currentIndex < mainBusItems.length - 1) {
        // Swap with next
        const nextItem = mainBusItems[currentIndex + 1]
        logger.info('[moveCircuitOnMainBus] Swapping with next', { nextItem })
        if (!nextItem) {
          return
        }
        if (currentItem.type === 'circuit' && nextItem.type === 'circuit') {
          // Swap circuits
          const temp = panel.circuits[currentItem.index]
          if (!temp) return
          const nextCircuit = panel.circuits[nextItem.index]
          if (!nextCircuit) return
          panel.circuits[currentItem.index] = nextCircuit
          panel.circuits[nextItem.index] = temp
          logger.info('[moveCircuitOnMainBus] Swapped circuits')
        } else if (currentItem.type === 'protection' && nextItem.type === 'protection') {
          // Swap protections
          const temp = panel.protections[currentItem.index]
          if (!temp) return
          const nextProtection = panel.protections[nextItem.index]
          if (!nextProtection) return
          panel.protections[currentItem.index] = nextProtection
          panel.protections[nextItem.index] = temp
          logger.info('[moveCircuitOnMainBus] Swapped protections')
        }
        state.isDirty = true
        maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
      } else {
        logger.info('[moveCircuitOnMainBus] Cannot move', {
          direction,
          currentIndex,
          total: mainBusItems.length,
        })
      }
    }),

  moveCircuitOnSecondaryBus: (circuitId, direction) =>
    set((state) => {
      logger.info('[moveCircuitOnSecondaryBus]', { circuitId, direction })
      if (!state.currentProject) {
        logger.warn('[moveCircuitOnSecondaryBus] No current project')
        return
      }

      // Find the parent circuit that contains this circuit in subCircuitIds
      for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
        const allCircuits = getAllCircuits(panel)
        for (const parentCircuit of allCircuits) {
          if (parentCircuit.subCircuitIds && parentCircuit.subCircuitIds.includes(circuitId)) {
            const index = parentCircuit.subCircuitIds.indexOf(circuitId)
            logger.info('[moveCircuitOnSecondaryBus] Found in parent circuit', {
              parentCircuitId: parentCircuit.id,
              index,
              total: parentCircuit.subCircuitIds.length,
            })
            if (direction === 'left' && index > 0) {
              // Move left (earlier in array)
              const temp = parentCircuit.subCircuitIds[index]
              if (temp === undefined) return
              const prevId = parentCircuit.subCircuitIds[index - 1]
              if (prevId === undefined) return
              parentCircuit.subCircuitIds[index] = prevId
              parentCircuit.subCircuitIds[index - 1] = temp
              logger.info('[moveCircuitOnSecondaryBus] Moved left', {
                newIndex: index - 1,
                newOrder: parentCircuit.subCircuitIds,
              })
              state.isDirty = true
              const ownerPanel = findPanelContainingCircuit(panel, parentCircuit.id)
              if (ownerPanel) {
                maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, ownerPanel.id)
              }
              return
            } else if (direction === 'right' && index < parentCircuit.subCircuitIds.length - 1) {
              // Move right (later in array)
              const temp = parentCircuit.subCircuitIds[index]
              if (temp === undefined) return
              const nextId = parentCircuit.subCircuitIds[index + 1]
              if (nextId === undefined) return
              parentCircuit.subCircuitIds[index] = nextId
              parentCircuit.subCircuitIds[index + 1] = temp
              logger.info('[moveCircuitOnSecondaryBus] Moved right', {
                newIndex: index + 1,
                newOrder: parentCircuit.subCircuitIds,
              })
              state.isDirty = true
              const ownerPanel = findPanelContainingCircuit(panel, parentCircuit.id)
              if (ownerPanel) {
                maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, ownerPanel.id)
              }
              return
            } else {
              logger.info('[moveCircuitOnSecondaryBus] Cannot move', {
                direction,
                index,
                length: parentCircuit.subCircuitIds.length,
              })
            }
          }
        }
      }
      logger.warn("[moveCircuitOnSecondaryBus] Circuit not found in any parent's subCircuitIds", {
        circuitId,
      })
    }),

  moveCircuitToMainBus: (panelId, circuitId, mainBusInsertIndex) =>
    set((state) => {
      if (!state.currentProject) return
      const targetPanel = findPanelById(
        getMutableElectricalPanelsForProject(state.currentProject),
        panelId
      )
      if (!targetPanel) return

      let protection: ProtectionDevice | undefined
      let sourcePanel: Panel | undefined

      const walkStack: Panel[] = [...getMutableElectricalPanelsForProject(state.currentProject)]
      while (walkStack.length) {
        const p = walkStack.pop()!
        for (const prot of p.protections ?? []) {
          if (prot.circuits?.some((c) => c.id === circuitId)) {
            protection = prot
            sourcePanel = p
            break
          }
        }
        if (protection) break
        if (p.subPanels?.length) walkStack.push(...p.subPanels)
      }

      if (!protection || !sourcePanel) return

      relocateProtectionToPanelMainBus(sourcePanel, targetPanel, protection, mainBusInsertIndex)
      syncLinkedSubPanelHierarchy(state.currentProject)

      dedupePanelProtectionsInPanelTree(sourcePanel)
      dedupePanelProtectionsInPanelTree(targetPanel)

      state.isDirty = true
      maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, sourcePanel.id)
      if (sourcePanel.id !== targetPanel.id) {
        maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, targetPanel.id)
      }
    }),

  moveProtectionToPanelSupplyWire: (protectionId, panelId) => {
    let moved = false
    set((state) => {
      if (!state.currentProject) return

      const panels = getMutableElectricalPanelsForProject(state.currentProject)
      const sourcePanel = findPanelOwningProtection(panels, protectionId)
      const targetPanel = findPanelById(panels, panelId)
      const protection = sourcePanel && findProtectionById(sourcePanel, protectionId)
      const panelCircuit = targetPanel?.circuits.find((circuit) => circuit.code === 'PANEL')

      // A secondary panel has one incoming protection slot. Main-panel supply
      // devices use the separate feed-topology actions.
      if (!sourcePanel || !targetPanel || targetPanel.isMain || !protection || !panelCircuit) return
      if ((panelCircuit.trunkDevices ?? []).some((device) => device.type === 'protection')) return
      const hasChildCircuitRefs = (protection.circuits ?? []).some(
        (circuit) => (circuit.subCircuitIds?.length ?? 0) > 0
      )
      const hasOwnLoadPayload = (protection.circuits ?? []).some(
        (circuit) =>
          circuit.endpoints.length > 0 ||
          (circuit.branches?.length ?? 0) > 0 ||
          (circuit.trunkDevices?.length ?? 0) > 0
      )
      if (hasOwnLoadPayload && !hasChildCircuitRefs) return

      relocateProtectionToPanelMainBus(sourcePanel, targetPanel, protection, 0)
      const incomingDevice = protectionDeviceToSubPanelIncomingTrunkDevice(
        protection,
        protection.id,
        getVoltagePolesConfig(state.currentProject)
      )
      promoteMovedSubPanelRootToIncomingTrunk(targetPanel, protection.id, incomingDevice)
      rewirePromotedIncomingProtectionGridRef(targetPanel, protection.id, panelCircuit.id)

      moved = (panelCircuit.trunkDevices ?? []).some(
        (device) => device.id === protection.id && device.type === 'protection'
      )
      if (!moved) return

      syncLinkedSubPanelHierarchy(state.currentProject)
      dedupePanelProtectionsInPanelTree(sourcePanel)
      dedupePanelProtectionsInPanelTree(targetPanel)
      state.isDirty = true
      maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, sourcePanel.id)
      if (sourcePanel.id !== targetPanel.id) {
        maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, targetPanel.id)
      }
    })
    return moved
  },

  ejectProtectionToNewPanel: (protectionId, opts) => {
    let createdId: string | null = null
    set((state) => {
      if (!state.currentProject) return
      const sourcePanel = findPanelOwningProtection(
        getMutableElectricalPanelsForProject(state.currentProject),
        protectionId
      )
      const protection = sourcePanel && findProtectionById(sourcePanel, protectionId)
      if (!sourcePanel || !protection) return

      const insertIdx = computeMainBusInsertIndexForEjectedProtection(
        sourcePanel,
        protectionId,
        getMutableElectricalPanelsForProject(state.currentProject)
      )
      const movedCircuitIds = collectCircuitClosureDownstreamFromProtection(sourcePanel, protection)
      const representativeCircuitId = pickRepresentativeCircuitIdForMainBusMove(
        sourcePanel,
        protection
      )
      const originalParentInfo = representativeCircuitId
        ? findParentCircuitInfo(
            representativeCircuitId,
            getMutableElectricalPanelsForProject(state.currentProject)
          )
        : null
      const originalParentCircuit = originalParentInfo?.parentCircuit
      const originalParentSubCircuitIndex =
        representativeCircuitId && originalParentCircuit?.subCircuitIds
          ? originalParentCircuit.subCircuitIds.indexOf(representativeCircuitId)
          : -1
      const shouldReattachFeederToOriginalParent =
        !!originalParentCircuit &&
        originalParentSubCircuitIndex >= 0 &&
        !movedCircuitIds.has(originalParentCircuit.id)

      const totalPanelCount = countPanels(
        getMutableElectricalPanelsForProject(state.currentProject)
      )
      const panelNumber = totalPanelCount + 1
      const newPanelId = generateId()
      createdId = newPanelId

      const descriptiveName = deriveDescriptiveNameFromProtectionForNewSubPanel(protection)
      const autoSecondaryName = `Panel ${panelNumber}`
      const derivedPanelName =
        opts?.newPanelName ??
        (descriptiveName && descriptiveName.length > 0 ? descriptiveName : autoSecondaryName)

      const newPanel: Panel = {
        id: newPanelId,
        name: derivedPanelName,
        symbol: 'panel_distribution',
        isMain: false,
        protections: [],
        circuits: [],
        subPanels: [],
      }

      if (!sourcePanel.subPanels) sourcePanel.subPanels = []
      sourcePanel.subPanels.push(newPanel)

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
      const panelPlacement = ensurePanelPlacement(state.currentProject, newPanel, {
        ...(preferredPlanPos ? { preferredPlanPos } : {}),
      })
      if (panelPlacement) {
        const targetPanelForPlacement = findPanelById(
          getMutableElectricalPanelsForProject(state.currentProject),
          newPanelId
        )!
        const panelCircuit = findCircuitById(targetPanelForPlacement, 'PANEL')

        if (!panelCircuit) {
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

          targetPanelForPlacement.circuits.push(dummyCircuit)
          panelPlacement.endpoint.placements = [panelPlacement.placement]
          dummyCircuit.endpoints.push(panelPlacement.endpoint)
        } else {
          const existingEndpoint = panelCircuit.circuit.endpoints.find(
            (e) =>
              e.symbol === 'panel_distribution' &&
              (e.panelId === newPanel.id || e.label === newPanel.name)
          )
          if (existingEndpoint) {
            existingEndpoint.placements.push(panelPlacement.placement)
          } else {
            panelPlacement.endpoint.placements = [panelPlacement.placement]
            panelCircuit.circuit.endpoints.push(panelPlacement.endpoint)
          }
        }
      }

      const voltagePoles = getVoltagePolesConfig(state.currentProject)
      const targetPanel = findPanelById(
        getMutableElectricalPanelsForProject(state.currentProject),
        newPanelId
      )!
      if (!targetPanel.circuits.some((circuit) => circuit.code === 'PANEL')) {
        targetPanel.circuits.push({
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
        })
      }
      relocateProtectionToPanelMainBus(sourcePanel, targetPanel, protection, 0)
      const incomingDevice = protectionDeviceToSubPanelIncomingTrunkDevice(
        protection,
        protection.id,
        voltagePoles
      )
      promoteMovedSubPanelRootToIncomingTrunk(targetPanel, protection.id, incomingDevice)

      const parentProtForMergedFeeder = originalParentInfo?.parentProtection
      if (shouldReattachFeederToOriginalParent && parentProtForMergedFeeder) {
        parentProtForMergedFeeder.subPanelId = newPanelId
        rewirePanelGridProtectionModuleId(sourcePanel, protectionId, parentProtForMergedFeeder.id)
        if (originalParentCircuit.subCircuitIds?.length === 0) {
          originalParentCircuit.subCircuitIds = undefined
        }
      } else {
        const feederCode = getNextAvailableCircuitCode(state.currentProject, sourcePanel.id)
        const feederProtectionId = generateId()
        const mcbDefaults = getDefaultProtectionProps('MCB', voltagePoles)
        const feederProtection: ProtectionDevice = {
          id: feederProtectionId,
          type: 'MCB',
          label: feederCode,
          circuits: [],
          subPanelId: newPanelId,
          ...mcbDefaults,
        }
        ensureRcboSensitivityOnProtection(feederProtection)
        sourcePanel.protections.push(feederProtection)
        feederProtection.circuits = [
          {
            id: generateId(),
            code: feederCode,
            kind: 'other',
            cable: createDefaultAcCircuitCable({ sectionMm2: 6 }),
            endpoints: [],
            ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
          },
        ]
        rewirePanelGridProtectionModuleId(sourcePanel, protectionId, feederProtectionId)
        moveProtectionToMainBusInsertIndex(sourcePanel, feederProtectionId, insertIdx)
      }

      prunePanelGridSlotsForUnresolvedModules(sourcePanel)
      removePanelGridDuplicateRefs(state.currentProject, sourcePanel)

      dedupePanelProtectionsInPanelTree(sourcePanel)
      dedupePanelProtectionsInPanelTree(targetPanel)
      ensureLinkedSubPanelsHaveOwnPanelEndpoint(state.currentProject)
      syncLinkedSubPanelHierarchy(state.currentProject)
      const installation = getMutableElectricalInstallationForProject(state.currentProject)
      if (!installation) return
      ensureInstallationFeedTopology(
        installation,
        getMutableElectricalPanelsForProject(state.currentProject)
      )

      state.isDirty = true
      maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, sourcePanel.id)
      maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, targetPanel.id)
    })
    return createdId
  },

  ejectSecondaryBusProtectionsToNewPanel: (protectionIds, opts): string | null => {
    const current = get().currentProject
    const initialSelection = resolveSecondaryBusEjectSelection(current, protectionIds)
    if (!initialSelection) return null
    if (initialSelection.protectionIds.length === 1) {
      return get().ejectProtectionToNewPanel(initialSelection.protectionIds[0]!, opts)
    }

    let createdId: string | null = null
    set((state) => {
      if (!state.currentProject) return
      const selection = resolveSecondaryBusEjectSelection(state.currentProject, protectionIds)
      if (!selection || selection.protectionIds.length <= 1) return

      const sourcePanel = findPanelById(
        getMutableElectricalPanelsForProject(state.currentProject),
        selection.sourcePanel.id
      )
      if (!sourcePanel) return
      const parentProtection = findProtectionById(sourcePanel, selection.parentProtection.id)
      const parentCircuit = parentProtection?.circuits?.find(
        (circuit) => circuit.id === selection.parentCircuit.id
      )
      if (!parentProtection || !parentCircuit) return

      const protectionsToMove = selection.protectionIds
        .map((id) => findProtectionById(sourcePanel, id))
        .filter((protection): protection is ProtectionDevice => !!protection)
      if (protectionsToMove.length !== selection.protectionIds.length) return

      const totalPanelCount = countPanels(
        getMutableElectricalPanelsForProject(state.currentProject)
      )
      const panelNumber = totalPanelCount + 1
      const newPanelId = generateId()
      createdId = newPanelId

      const descriptiveName = deriveDescriptiveNameFromProtectionForNewSubPanel(
        protectionsToMove[0]!
      )
      const autoSecondaryName = `Panel ${panelNumber}`
      const derivedPanelName =
        opts?.newPanelName ??
        (descriptiveName && descriptiveName.length > 0 ? descriptiveName : autoSecondaryName)

      const newPanel: Panel = {
        id: newPanelId,
        name: derivedPanelName,
        symbol: 'panel_distribution',
        isMain: false,
        protections: [],
        circuits: [],
        subPanels: [],
      }

      if (!sourcePanel.subPanels) sourcePanel.subPanels = []
      sourcePanel.subPanels.push(newPanel)

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
      const panelPlacement = ensurePanelPlacement(state.currentProject, newPanel, {
        ...(preferredPlanPos ? { preferredPlanPos } : {}),
      })
      const targetPanel = findPanelById(
        getMutableElectricalPanelsForProject(state.currentProject),
        newPanelId
      )!
      let panelCircuit = targetPanel.circuits.find((circuit) => circuit.code === 'PANEL')
      if (!panelCircuit) {
        panelCircuit = {
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
        targetPanel.circuits.push(panelCircuit)
      }
      if (panelPlacement) {
        panelPlacement.endpoint.placements = [panelPlacement.placement]
        panelCircuit.endpoints.push(panelPlacement.endpoint)
      }

      for (const protection of protectionsToMove) {
        relocateProtectionToPanelMainBus(
          sourcePanel,
          targetPanel,
          protection,
          getMainBusOrder(targetPanel).length
        )
      }

      parentProtection.subPanelId = newPanelId
      if (parentCircuit.subCircuitIds?.length === 0) {
        parentCircuit.subCircuitIds = undefined
      }

      prunePanelGridSlotsForUnresolvedModules(sourcePanel)
      removePanelGridDuplicateRefs(state.currentProject, sourcePanel)
      dedupePanelProtectionsInPanelTree(sourcePanel)
      dedupePanelProtectionsInPanelTree(targetPanel)
      ensureLinkedSubPanelsHaveOwnPanelEndpoint(state.currentProject)
      syncLinkedSubPanelHierarchy(state.currentProject)
      const installation = getMutableElectricalInstallationForProject(state.currentProject)
      if (!installation) return
      ensureInstallationFeedTopology(
        installation,
        getMutableElectricalPanelsForProject(state.currentProject)
      )

      state.isDirty = true
      maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, sourcePanel.id)
      maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, targetPanel.id)
    })
    return createdId
  },

  moveCircuitToSecondaryBus: (panelId, parentCircuitId, circuitId, insertIndex, options) =>
    set((state) => {
      if (!state.currentProject) return
      const panel = findPanelById(
        getMutableElectricalPanelsForProject(state.currentProject),
        panelId
      )
      if (!panel) return

      const changed = moveCircuitToCircuitContentPosition(
        panel,
        parentCircuitId,
        circuitId,
        insertIndex,
        options
      )
      if (!changed) return
      state.isDirty = true
      maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
    }),

  liftCircuitContentAboveOwnProtection: (panelId, circuitId) => {
    let changed = false
    set((state) => {
      if (!state.currentProject) return
      const panel = findPanelById(
        getMutableElectricalPanelsForProject(state.currentProject),
        panelId
      )
      if (!panel) return

      changed = liftCircuitContentAboveOwnProtection(panel, circuitId)
      if (!changed) return
      state.isDirty = true
      maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
    })
    return changed
  },
})
