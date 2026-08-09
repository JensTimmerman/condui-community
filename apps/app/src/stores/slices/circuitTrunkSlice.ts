import { appendUndoSnapshotInStore, cloneProjectForHistory, projectHistory } from './projectStoreHistory'
import type { ProjectSliceCreator } from './projectStoreTypes'
import { getModuleWidthInCols } from '@/components/canvas/panel/panelGridLayout'
import { recordSessionAction } from '@/lib/diagnostics/sessionActionLog'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { resolveUniqueSupplyProtectionLabelOnPanel } from '@/lib/eendraad/automaticMainBusNaming'
import { migrateEndpointLabelsAfterCircuitCodeChange } from '@/lib/eendraad/circuitEndpointLabels'
import { findParentCircuitInfo } from '@/lib/eendraad/findParentCircuitInfo'
import { collectCircuitFrameRemovalIds, pruneEendraadFrames } from '@/lib/eendraad/frameContent'
import { logger } from '@/lib/logger'
import {
  cleanupPanelGridSlotsForDevice,
  clearStaleAutoModuleWidthForModuleRef,
  ensureRcboSensitivityOnTrunkDevice,
  findCircuitById,
  findPanelContainingCircuit,
  findPanelOwningSupplyDevice,
  findSupplyDeviceContainer,
  getAllCircuits,
  getSupplyFeedListForTarget,
  maybeApplyAutomaticEendraadNamingForPanel,
  migrateCircuitContentToParent,
  refreshAutomaticNamingForPanelsShowingSupplyDevice,
  rewriteRelocatedCircuitTrunkDeviceGridRef,
  syncManualChronologyForInstallDateUpdate,
} from '@/lib/eendraad/projectElectricalDomain'
import { logTrunkDnDCommit, summarizeDropTarget, trunkDnDCommitLogEnabled } from '@/lib/eendraad/trunkDeviceDnDLog'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { clamp } from '@/lib/geometry'
import { mutateTrunkDeviceRelocation } from '@/lib/layout/eendraadPreviewSimulation'
import { findPanelById } from '@/lib/panel/panelTree'
import { healPlanWiring } from '@/lib/plan/planWiring'
import { syncPanelAndSituationPlanDeviceVisibility } from '@/lib/plan/panelPlanPlacementVisibility'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  getMutableElectricalInstallationForProject,
  getMutableElectricalPanelsForProject,
} from '@/lib/projectV2/electrical'
import { getSymbolById } from '@/lib/symbols'
import type { Circuit, Panel, PanelGridModuleRef, ProtectionDevice } from '@/types/schema'

export const createCircuitTrunkSlice: ProjectSliceCreator = (set, get) => ({
    // Circuit actions
    addCircuit: (panelId, circuit, protectionId) =>
      set((state) => {
        if (state.currentProject) {
          const panels = getMutableElectricalPanelsForProject(state.currentProject)
          const panel = findPanelById(panels, panelId)
          if (panel) {
            const protection = protectionId
              ? panel.protections.find((candidate) => candidate.id === protectionId)
              : undefined
            if (protectionId && !protection) {
              logger.error('Refusing to create an orphan circuit: protection was not found', {
                panelId,
                protectionId,
                circuitId: circuit.id,
                circuitCode: circuit.code,
              })
              return
            }
            if (!protectionId && circuit.code !== 'PANEL') {
              logger.error('Refusing to create an orphan circuit without a protection', {
                panelId,
                circuitId: circuit.id,
                circuitCode: circuit.code,
              })
              return
            }

            if (!circuit.endpoints) {
              circuit.endpoints = []
            }

            if (protection) {
              if (!protection.circuits) {
                protection.circuits = []
              }
              protection.circuits.push(circuit)
            } else {
              // PANEL is the one supported direct circuit: it anchors a panel symbol on plan.
              panel.circuits.push(circuit)
            }
            state.isDirty = true
            maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
          }
        }
      }),

    addCircuitToProtection: (panelId, protectionId, circuit) =>
      set((state) => {
        if (state.currentProject) {
          const panels = getMutableElectricalPanelsForProject(state.currentProject)
          const panel = findPanelById(panels, panelId)
          if (panel) {
            const protection = panel.protections.find((p) => p.id === protectionId)
            if (protection) {
              if (!protection.circuits) {
                protection.circuits = []
              }
              protection.circuits.push(circuit)
              state.isDirty = true
              maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
            }
          }
        }
      }),

    updateCircuit: (id, updates) =>
      set((state) => {
        if (state.currentProject) {
          for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
            const result = findCircuitById(panel, id)
            if (result) {
              // Store getters return Immer-frozen snapshots. Shallow-clone nested rows so
              // in-place naming (e.g. duplicate → automatic A1/A2 labels) can mutate them.
              let appliedUpdates = updates
              if (Array.isArray(appliedUpdates.endpoints)) {
                appliedUpdates = {
                  ...appliedUpdates,
                  endpoints: appliedUpdates.endpoints.map((ep) => ({
                    ...ep,
                    placements: (ep.placements ?? []).map((p) => ({ ...p })),
                  })),
                }
              }
              if (Array.isArray(appliedUpdates.branches)) {
                appliedUpdates = {
                  ...appliedUpdates,
                  branches: appliedUpdates.branches.map((b) => ({
                    ...b,
                    endpointIds: [...(b.endpointIds ?? [])],
                  })),
                }
              }

              // Fast no-op: if this update doesn't actually change anything, skip.
              let hasAnyChange = false
              for (const [k, v] of Object.entries(appliedUpdates)) {
                const key = k as keyof Circuit
                if (key === 'code') {
                  const next = typeof v === 'string' ? v : ''
                  const curr = typeof result.circuit.code === 'string' ? result.circuit.code : ''
                  if (next !== curr) hasAnyChange = true
                  continue
                }
                const circuitValue = result.circuit[key as keyof Circuit]
                if (!Object.is(circuitValue, v)) {
                  hasAnyChange = true
                  break
                }
              }
              if (!hasAnyChange) return

              const oldCode = (result.circuit.code || '').trim()
              const newCode =
                typeof appliedUpdates.code === 'string' ? appliedUpdates.code.trim() : null

              if (newCode !== null && newCode !== oldCode) {
                migrateEndpointLabelsAfterCircuitCodeChange(result.circuit, oldCode, newCode)
                Object.assign(result.circuit, { ...appliedUpdates, code: newCode })
                if (result.parent && 'type' in result.parent && 'label' in result.parent) {
                  result.parent.label = newCode
                }
              } else {
                Object.assign(result.circuit, appliedUpdates)
              }
              syncManualChronologyForInstallDateUpdate(
                state.currentProject,
                { id, type: 'circuit' },
                appliedUpdates
              )

              state.lastWorkedCircuitId = result.circuit.id
              state.isDirty = true

              const branchTopologyChanged =
                Object.prototype.hasOwnProperty.call(appliedUpdates, 'branches') ||
                Object.prototype.hasOwnProperty.call(appliedUpdates, 'endpoints') ||
                (newCode !== null && newCode !== oldCode)
              if (branchTopologyChanged) {
                syncSequentialEndpointBranchLabelsToCircuit(result.circuit)
                healPlanWiring(state.currentProject)
              }

              // Nesting, endpoints, or branch topology changes: refresh automatic ééndraad naming
              // (main-bus letters only — branch numbers A1, A2, … are synced above).
              const needsAutoNamingRefresh =
                !!getMutableElectricalInstallationForProject(state.currentProject)?.eendraadAutomaticNaming &&
                (Object.prototype.hasOwnProperty.call(appliedUpdates, 'subCircuitIds') ||
                  Object.prototype.hasOwnProperty.call(appliedUpdates, 'branches') ||
                  Object.prototype.hasOwnProperty.call(appliedUpdates, 'endpoints'))
              if (needsAutoNamingRefresh) {
                for (const rootPanel of getMutableElectricalPanelsForProject(state.currentProject)) {
                  const ownerPanel = findPanelContainingCircuit(rootPanel, id)
                  if (ownerPanel) {
                    maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, ownerPanel.id)
                    break
                  }
                }
              }

              return
            }
          }
        }
      }),

    deleteCircuit: (id) =>
      set((state) => {
        if (state.currentProject) {
          const panels = getMutableElectricalPanelsForProject(state.currentProject)
          let circuitLogLabel: string | null = null
          for (const panel of panels) {
            const hit = findCircuitById(panel, id)
            if (hit) {
              circuitLogLabel = hit.circuit.code?.trim() || id
              break
            }
          }

          let frameRemoval: ReturnType<typeof collectCircuitFrameRemovalIds> | undefined

          // Before removing, migrate subcircuit content back to parent if applicable
          for (const panel of panels) {
            const result = findCircuitById(panel, id)
            if (result) {
              frameRemoval = collectCircuitFrameRemovalIds(result.circuit)
              const parentInfo = findParentCircuitInfo(id, panels)
              if (parentInfo) {
                migrateCircuitContentToParent(result.circuit, parentInfo.parentCircuit)
                // Transfer subPanelId if the protection owning this circuit has one
                if (
                  'type' in result.parent &&
                  (result.parent as ProtectionDevice).subPanelId &&
                  parentInfo.parentProtection
                ) {
                  parentInfo.parentProtection.subPanelId = (
                    result.parent as ProtectionDevice
                  ).subPanelId
                  ;(result.parent as ProtectionDevice).subPanelId = undefined
                }
              }
              break
            }
          }

          // Helper to remove circuit from panel or protection
          const removeCircuit = (panel: Panel): boolean => {
            // Check direct circuits
            const index = panel.circuits.findIndex((c) => c.id === id)
            if (index !== -1) {
              panel.circuits.splice(index, 1)
              return true
            }

            // Check circuits under protections
            for (const protection of panel.protections) {
              if (protection.circuits) {
                const index = protection.circuits.findIndex((c) => c.id === id)
                if (index !== -1) {
                  protection.circuits.splice(index, 1)
                  return true
                }
              }
            }

            // Check sub-panels
            for (const subPanel of panel.subPanels) {
              if (removeCircuit(subPanel)) return true
            }
            return false
          }

          for (const panel of panels) {
            if (removeCircuit(panel)) {
              if (frameRemoval) {
                pruneEendraadFrames(state.currentProject, {
                  removedMemberIds: frameRemoval.memberIds,
                  removedCircuitIds: frameRemoval.circuitIds,
                })
              }
              state.isDirty = true
              if (circuitLogLabel) {
                recordSessionAction(`delete circuit "${circuitLogLabel}"`)
              }
              return
            }
          }
        }
      }),

    // Trunk device actions
    addTrunkDevice: (circuitId, device) =>
      set((state) => {
        if (state.currentProject) {
          const panels = getMutableElectricalPanelsForProject(state.currentProject)
          for (const panel of panels) {
            const result = findCircuitById(panel, circuitId)
            if (result) {
              if (!result.circuit.trunkDevices) {
                result.circuit.trunkDevices = []
              }
              ensureRcboSensitivityOnTrunkDevice(device)
              // Insert in order by trunkPosition
              const insertIdx = result.circuit.trunkDevices.findIndex(
                (d) => d.trunkPosition > device.trunkPosition
              )
              if (insertIdx >= 0) {
                result.circuit.trunkDevices.splice(insertIdx, 0, device)
              } else {
                result.circuit.trunkDevices.push(device)
              }
              syncPanelAndSituationPlanDeviceVisibility(state.currentProject)
              state.isDirty = true
              return
            }
          }
        }
      }),

    updateTrunkDevice: (circuitId, deviceId, updates) =>
      set((state) => {
        if (state.currentProject) {
          const panels = getMutableElectricalPanelsForProject(state.currentProject)
          for (const panel of panels) {
            const result = findCircuitById(panel, circuitId)
            if (result && result.circuit.trunkDevices) {
              const device = result.circuit.trunkDevices.find((d) => d.id === deviceId)
              if (device) {
                const trunkRef: PanelGridModuleRef = {
                  kind: 'trunkDevice',
                  id: deviceId,
                  scope: 'circuit',
                  circuitId,
                }
                const oldPoleWidth = getModuleWidthInCols(trunkRef, state.currentProject)
                const oldLabel = typeof device.label === 'string' ? device.label.trim() : ''
                const nextUpdates =
                  result.circuit.code === 'PANEL' &&
                  device.type === 'protection' &&
                  typeof updates.label === 'string' &&
                  getMutableElectricalInstallationForProject(state.currentProject)?.eendraadAutomaticNaming
                    ? {
                        ...updates,
                        label: resolveUniqueSupplyProtectionLabelOnPanel(
                          panel,
                          state.currentProject,
                          deviceId,
                          updates.label,
                        ),
                      }
                    : updates
                Object.assign(device, nextUpdates)
                syncManualChronologyForInstallDateUpdate(
                  state.currentProject,
                  { id: deviceId, type: 'trunkDevice' },
                  nextUpdates
                )
                ensureRcboSensitivityOnTrunkDevice(device)
                const newPoleWidth = getModuleWidthInCols(trunkRef, state.currentProject)
                if (oldPoleWidth !== newPoleWidth) {
                  clearStaleAutoModuleWidthForModuleRef(
                    panels,
                    trunkRef,
                    oldPoleWidth
                  )
                }
                const newLabel =
                  typeof nextUpdates.label === 'string' ? nextUpdates.label.trim() : oldLabel
                if (
                  result.circuit.code === 'PANEL' &&
                  Object.prototype.hasOwnProperty.call(updates, 'label') &&
                  newLabel !== oldLabel &&
                  getMutableElectricalInstallationForProject(state.currentProject)?.eendraadAutomaticNaming
                ) {
                  maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panel.id)
                }
                state.isDirty = true
                return
              }
            }
          }
        }
      }),

    deleteTrunkDevice: (circuitId, deviceId) =>
      set((state) => {
        if (state.currentProject) {
          const project = state.currentProject
          const installation = getElectricalInstallationFromProject(project)
          const panels = getElectricalPanelsFromProject(project)
          let removedLabel: string | undefined
          for (const panel of panels) {
            const result = findCircuitById(panel, circuitId)
            if (result && result.circuit.trunkDevices) {
              const index = result.circuit.trunkDevices.findIndex((d) => d.id === deviceId)
              if (index !== -1) {
                const [removed] = result.circuit.trunkDevices.splice(index, 1)
                if (removed?.type === 'junction_panel') {
                  removedLabel = removed.label
                }
                const deviceRef: PanelGridModuleRef = {
                  kind: 'trunkDevice',
                  id: deviceId,
                  scope: 'circuit',
                  circuitId,
                }
                cleanupPanelGridSlotsForDevice(panels, deviceRef)
                pruneEendraadFrames(project, { removedMemberIds: [deviceId] })
                state.isDirty = true
                break
              }
            }
          }
          if (removedLabel && installation?.junctionPanelPlacements) {
            const remainingDevices: { label?: string }[] = []
            installation.mainSupply?.supplyTrunkDevices?.forEach((d) => {
              if (d.type === 'junction_panel') remainingDevices.push({ label: d.label })
            })
            installation.groundTrunkDevices?.forEach((d) => {
              if (d.type === 'junction_panel') remainingDevices.push({ label: d.label })
            })
            for (const panel of panels) {
              const circuits = getAllCircuits(panel)
              circuits.forEach((c) =>
                c.trunkDevices?.forEach((d) => {
                  if (d.type === 'junction_panel') remainingDevices.push({ label: d.label })
                })
              )
            }
            const stillUsed = remainingDevices.some((d) => d.label === removedLabel)
            if (!stillUsed) {
              installation.junctionPanelPlacements = installation.junctionPanelPlacements.filter(
                (jp) => jp.label !== removedLabel
              )
            }
          }
        }
      }),

    moveTrunkDeviceInCircuit: (circuitId, deviceId, direction, parentCircuitId) =>
      set((state) => {
        logger.info('[moveTrunkDeviceInCircuit]', {
          circuitId,
          deviceId,
          direction,
          parentCircuitId,
        })
        if (!state.currentProject) {
          logger.warn('[moveTrunkDeviceInCircuit] No current project')
          return
        }

        // If parentCircuitId is provided, this is a single nested circuit case
        // We need to move devices between parent and nested circuits
        if (parentCircuitId) {
          for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
            const nestedResult = findCircuitById(panel, circuitId)
            const parentResult = findCircuitById(panel, parentCircuitId)

            if (!nestedResult || !parentResult) continue

            const nestedCircuit = nestedResult.circuit
            const parentCircuit = parentResult.circuit

            // Get all devices from both circuits
            const nestedDevices = nestedCircuit.trunkDevices || []
            const parentDevices = parentCircuit.trunkDevices || []

            // Combine and sort by trunkPosition
            const allDevices = [...parentDevices, ...nestedDevices]
            const sorted = [...allDevices].sort(
              (a, b) => (a.trunkPosition || 0) - (b.trunkPosition || 0)
            )
            const index = sorted.findIndex((d) => d.id === deviceId)

            if (index === -1) {
              logger.warn('[moveTrunkDeviceInCircuit] Device not found in combined list', {
                deviceId,
                circuitId,
                parentCircuitId,
              })
              return
            }

            logger.info('[moveTrunkDeviceInCircuit] Found device in combined list', {
              index,
              total: sorted.length,
              isInParent: parentDevices.some((d) => d.id === deviceId),
              isInNested: nestedDevices.some((d) => d.id === deviceId),
            })

            if (
              direction === 'up' &&
              (index > 0 || (index === 0 && parentDevices.length === 0 && nestedDevices.length > 0))
            ) {
              // Special case: moving from nested to empty parent (index 0, parent empty)
              if (index === 0 && parentDevices.length === 0 && nestedDevices.length > 0) {
                // Move first nested device to parent
                const device = nestedDevices.find((d) => d.id === deviceId)!
                const idx = nestedDevices.indexOf(device)
                nestedDevices.splice(idx, 1)
                if (!parentCircuit.trunkDevices) parentCircuit.trunkDevices = []
                parentCircuit.trunkDevices.push(device)
                // Set trunkPosition to 0 for the first device in parent
                device.trunkPosition = 0
                logger.info('[moveTrunkDeviceInCircuit] Moved from nested to empty parent', {
                  deviceId,
                })
                state.isDirty = true
                return
              }

              // Normal case: swap with previous device
              const prevDevice = sorted[index - 1]
              const currentDevice = sorted[index]
              if (!prevDevice || !currentDevice) return

              // Swap positions
              const tempPos = currentDevice.trunkPosition || 0
              currentDevice.trunkPosition = prevDevice.trunkPosition || 0
              prevDevice.trunkPosition = tempPos

              // If device moved from nested to parent or vice versa, update which circuit it belongs to
              const wasInParent = parentDevices.some((d) => d.id === deviceId)
              const prevWasInParent = parentDevices.some((d) => d.id === prevDevice.id)

              if (wasInParent && !prevWasInParent) {
                // Moving from parent to nested
                const device = parentDevices.find((d) => d.id === deviceId)!
                const idx = parentDevices.indexOf(device)
                parentDevices.splice(idx, 1)
                if (!nestedCircuit.trunkDevices) nestedCircuit.trunkDevices = []
                nestedCircuit.trunkDevices.push(device)
              } else if (!wasInParent && prevWasInParent) {
                // Moving from nested to parent
                const device = nestedDevices.find((d) => d.id === deviceId)!
                const idx = nestedDevices.indexOf(device)
                nestedDevices.splice(idx, 1)
                if (!parentCircuit.trunkDevices) parentCircuit.trunkDevices = []
                parentCircuit.trunkDevices.push(device)
              }

              logger.info('[moveTrunkDeviceInCircuit] Moved up in combined list', {
                newIndex: index - 1,
              })
              state.isDirty = true
              return
            } else if (direction === 'down' && index < sorted.length - 1) {
              const nextDevice = sorted[index + 1]
              const currentDevice = sorted[index]
              if (!nextDevice || !currentDevice) return

              // Swap positions
              const tempPos = currentDevice.trunkPosition || 0
              currentDevice.trunkPosition = nextDevice.trunkPosition || 0
              nextDevice.trunkPosition = tempPos

              // If device moved from nested to parent or vice versa, update which circuit it belongs to
              const wasInParent = parentDevices.some((d) => d.id === deviceId)
              const nextWasInParent = parentDevices.some((d) => d.id === nextDevice.id)

              if (wasInParent && !nextWasInParent) {
                // Moving from parent to nested
                const device = parentDevices.find((d) => d.id === deviceId)!
                const idx = parentDevices.indexOf(device)
                parentDevices.splice(idx, 1)
                if (!nestedCircuit.trunkDevices) nestedCircuit.trunkDevices = []
                nestedCircuit.trunkDevices.push(device)
              } else if (!wasInParent && nextWasInParent) {
                // Moving from nested to parent
                const device = nestedDevices.find((d) => d.id === deviceId)!
                const idx = nestedDevices.indexOf(device)
                nestedDevices.splice(idx, 1)
                if (!parentCircuit.trunkDevices) parentCircuit.trunkDevices = []
                parentCircuit.trunkDevices.push(device)
              }

              logger.info('[moveTrunkDeviceInCircuit] Moved down in combined list', {
                newIndex: index + 1,
              })
              state.isDirty = true
              return
            } else {
              logger.info('[moveTrunkDeviceInCircuit] Cannot move in combined list', {
                direction,
                index,
                length: sorted.length,
              })
            }
          }
          return
        }

        // Normal case: just move within a single circuit
        for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
          const result = findCircuitById(panel, circuitId)
          if (result && result.circuit.trunkDevices) {
            const devices = result.circuit.trunkDevices
            // Sort by trunkPosition to get current order
            const sorted = [...devices].sort(
              (a, b) => (a.trunkPosition || 0) - (b.trunkPosition || 0)
            )
            const index = sorted.findIndex((d) => d.id === deviceId)
            if (index === -1) {
              logger.warn('[moveTrunkDeviceInCircuit] Device not found', { deviceId, circuitId })
              return
            }
            logger.info('[moveTrunkDeviceInCircuit] Found device', { index, total: sorted.length })

            if (direction === 'up' && index > 0) {
              // Move up (earlier position = lower trunkPosition)
              const prevDevice = sorted[index - 1]
              const currentDevice = sorted[index]
              if (!prevDevice || !currentDevice) return
              const tempPos = currentDevice.trunkPosition || 0
              currentDevice.trunkPosition = prevDevice.trunkPosition || 0
              prevDevice.trunkPosition = tempPos
              logger.info('[moveTrunkDeviceInCircuit] Moved up', {
                newIndex: index - 1,
                positions: sorted.map((d) => ({ id: d.id, pos: d.trunkPosition })),
              })
              state.isDirty = true
              return
            } else if (direction === 'down' && index < sorted.length - 1) {
              // Move down (later position = higher trunkPosition)
              const nextDevice = sorted[index + 1]
              const currentDevice = sorted[index]
              if (!nextDevice || !currentDevice) return
              const tempPos = currentDevice.trunkPosition || 0
              currentDevice.trunkPosition = nextDevice.trunkPosition || 0
              nextDevice.trunkPosition = tempPos
              logger.info('[moveTrunkDeviceInCircuit] Moved down', {
                newIndex: index + 1,
                positions: sorted.map((d) => ({ id: d.id, pos: d.trunkPosition })),
              })
              state.isDirty = true
              return
            } else {
              logger.info('[moveTrunkDeviceInCircuit] Cannot move', {
                direction,
                index,
                length: sorted.length,
              })
            }
          }
        }
      }),

    relocateCircuitTrunkDevice: (deviceId, dropTarget): boolean => {
      const projectBefore = get().currentProject
      if (!projectBefore) return false
      const snapshotBefore = cloneProjectForHistory(projectBefore)
      let ok: boolean = false
      let sourceCircuitIdForLog: string | undefined
      projectHistory.suppressNextDebouncedRun()
      try {
        set((state) => {
          if (!state.currentProject) return
          let sourceCircuitId: string | undefined
          let symbolKey: string | undefined
          for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
            for (const c of getAllCircuits(panel)) {
              const d = c.trunkDevices?.find((x) => x.id === deviceId)
              if (d) {
                sourceCircuitId = c.id
                symbolKey = d.symbol
                break
              }
            }
            if (sourceCircuitId) break
          }
          if (!sourceCircuitId || !symbolKey) return
          sourceCircuitIdForLog = sourceCircuitId
          const symbol = getSymbolById(symbolKey)
          if (!symbol) return
          ok = mutateTrunkDeviceRelocation(
            state.currentProject,
            { id: deviceId, sourceCircuitId },
            dropTarget,
            symbol
          )
          if (ok) {
            rewriteRelocatedCircuitTrunkDeviceGridRef(
              state.currentProject,
              deviceId,
              sourceCircuitId,
              dropTarget.circuitId!
            )
            state.isDirty = true
          }
        })
      } finally {
        projectHistory.clearDebouncedSuppression()
      }
      if (trunkDnDCommitLogEnabled()) {
        logTrunkDnDCommit('relocateCircuitTrunkDevice', {
          deviceId,
          ok,
          sourceCircuitId: sourceCircuitIdForLog,
          targetCircuitId: dropTarget.circuitId,
          dropTarget: summarizeDropTarget(dropTarget),
        })
      }
      if (ok) {
        appendUndoSnapshotInStore(set, snapshotBefore)
        recordSessionAction('relocate circuit trunk device')
      }
      return ok
    },

    // Supply trunk device actions (devices on the main supply wire)
    addSupplyTrunkDevice: (device, insertIndex, target) =>
      set((state) => {
        if (state.currentProject) {
          const scope = target?.feedScope ?? 'shared'
          const devices = getSupplyFeedListForTarget(state.currentProject, target?.panelId, scope)
          const idx = clamp(insertIndex ?? devices.length, 0, devices.length)
          devices.splice(idx, 0, device)
          devices.forEach((item, index) => {
            item.trunkPosition = index
          })
          syncPanelAndSituationPlanDeviceVisibility(state.currentProject)
          state.isDirty = true
        }
      }),

    updateSupplyTrunkDevice: (deviceId, updates) =>
      set((state) => {
        if (state.currentProject) {
          const container = findSupplyDeviceContainer(state.currentProject, deviceId)
          const devices = container?.devices
          if (devices) {
            const device = devices.find((d) => d.id === deviceId)
            if (!device) return
            const supplyRef: PanelGridModuleRef = {
              kind: 'trunkDevice',
              id: deviceId,
              scope: 'supply',
            }
            const oldPoleWidth = getModuleWidthInCols(supplyRef, state.currentProject)
            const oldLabel = typeof device.label === 'string' ? device.label.trim() : ''
            const owningPanel = findPanelOwningSupplyDevice(state.currentProject, deviceId)
            const nextUpdates =
              device.type === 'protection' &&
              typeof updates.label === 'string' &&
              owningPanel &&
              getMutableElectricalInstallationForProject(state.currentProject)?.eendraadAutomaticNaming
                ? {
                    ...updates,
                    label: resolveUniqueSupplyProtectionLabelOnPanel(
                      owningPanel,
                      state.currentProject,
                      deviceId,
                      updates.label,
                    ),
                  }
                : updates
            Object.assign(device, nextUpdates)
            syncManualChronologyForInstallDateUpdate(
              state.currentProject,
              { id: deviceId, type: 'trunkDevice' },
              nextUpdates
            )
            const newPoleWidth = getModuleWidthInCols(supplyRef, state.currentProject)
            if (oldPoleWidth !== newPoleWidth) {
              clearStaleAutoModuleWidthForModuleRef(
                getMutableElectricalPanelsForProject(state.currentProject),
                supplyRef,
                oldPoleWidth
              )
            }
            const newLabel =
              typeof nextUpdates.label === 'string' ? nextUpdates.label.trim() : oldLabel
            if (
              Object.prototype.hasOwnProperty.call(updates, 'label') &&
              newLabel !== oldLabel &&
              getMutableElectricalInstallationForProject(state.currentProject)?.eendraadAutomaticNaming
            ) {
              refreshAutomaticNamingForPanelsShowingSupplyDevice(state.currentProject, deviceId)
            }
            state.isDirty = true
          }
        }
      }),

    deleteSupplyTrunkDevice: (deviceId) =>
      set((state) => {
        if (state.currentProject) {
          const project = state.currentProject
          const installation = getElectricalInstallationFromProject(project)
          const panels = getElectricalPanelsFromProject(project)
          if (!installation) return
          let removedLabel: string | undefined
          const container = findSupplyDeviceContainer(project, deviceId)
          const devices = container?.devices
          if (devices) {
            const index = devices.findIndex((d) => d.id === deviceId)
            if (index !== -1) {
              const [removed] = devices.splice(index, 1)
              if (removed?.type === 'junction_panel') {
                removedLabel = removed.label
              }
              const deviceRef: PanelGridModuleRef = {
                kind: 'trunkDevice',
                id: deviceId,
                scope: 'supply',
              }
              cleanupPanelGridSlotsForDevice(panels, deviceRef)
              pruneEendraadFrames(project, { removedMemberIds: [deviceId] })
              state.isDirty = true
            }
          }
          if (removedLabel && installation.junctionPanelPlacements) {
            const remainingDevices: { label?: string }[] = []
            ensureInstallationFeedTopology(installation, panels).sharedFeed.trunkDevices?.forEach((d) => {
              if (d.type === 'junction_panel') remainingDevices.push({ label: d.label })
            })
            ensureInstallationFeedTopology(installation, panels).rootFeeds.forEach(
              (feed) =>
                (feed.trunkDevices ?? []).forEach((d) => {
                  if (d.type === 'junction_panel') remainingDevices.push({ label: d.label })
                })
            )
            installation.groundTrunkDevices?.forEach((d) => {
              if (d.type === 'junction_panel') remainingDevices.push({ label: d.label })
            })
            for (const panel of panels) {
              const circuits = getAllCircuits(panel)
              circuits.forEach((c) =>
                c.trunkDevices?.forEach((d) => {
                  if (d.type === 'junction_panel') remainingDevices.push({ label: d.label })
                })
              )
            }
            const stillUsed = remainingDevices.some((d) => d.label === removedLabel)
            if (!stillUsed) {
              installation.junctionPanelPlacements = installation.junctionPanelPlacements.filter(
                (jp) => jp.label !== removedLabel
              )
            }
          }
        }
      }),

    moveSupplyTrunkDevice: (deviceId, direction) =>
      set((state) => {
        logger.info('[moveSupplyTrunkDevice]', { deviceId, direction })
        if (!state.currentProject) {
          logger.warn('[moveSupplyTrunkDevice] No current project')
          return
        }
        const container = findSupplyDeviceContainer(state.currentProject, deviceId)
        const devices = container?.devices
        if (!devices) {
          logger.warn('[moveSupplyTrunkDevice] No supply trunk devices')
          return
        }
        const index = devices.findIndex((d) => d.id === deviceId)
        if (index === -1) {
          logger.warn('[moveSupplyTrunkDevice] Device not found', { deviceId })
          return
        }
        logger.info('[moveSupplyTrunkDevice] Found device', { index, total: devices.length })

        // Array order = supply (index 0) to main bus (last). Left = toward main bus; right = toward supply.
        let moved = false
        if (direction === 'left' && index < devices.length - 1) {
          // Move left (toward main bus): swap with next in array (higher index)
          const temp = devices[index]!
          devices[index] = devices[index + 1]!
          devices[index + 1] = temp
          logger.info('[moveSupplyTrunkDevice] Moved left', { newIndex: index + 1 })
          moved = true
          state.isDirty = true
        } else if (direction === 'right' && index > 0) {
          // Move right (toward supply): swap with previous in array (lower index)
          const temp = devices[index]!
          devices[index] = devices[index - 1]!
          devices[index - 1] = temp
          logger.info('[moveSupplyTrunkDevice] Moved right', { newIndex: index - 1 })
          moved = true
          state.isDirty = true
        } else {
          logger.info('[moveSupplyTrunkDevice] Cannot move', {
            direction,
            index,
            length: devices.length,
          })
        }
        if (moved) {
          devices.forEach((item, itemIndex) => {
            item.trunkPosition = itemIndex
          })
        }

        // IMPORTANT: Reordering supply wire must not auto-repack panel slots.
        // Keep manual supply panel positions untouched; only wire order changes.
        if (moved) {
          logger.info('[moveSupplyTrunkDevice] Supply wire order updated without slot repack')
        }
      }),

})
