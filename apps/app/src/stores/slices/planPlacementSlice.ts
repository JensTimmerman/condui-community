import { appendUndoSnapshotInStore, cloneProjectForHistory, getProjectStoreApi, projectHistory } from './projectStoreHistory'
import type { ProjectSliceCreator } from './projectStoreTypes'
import { recordSessionAction } from '@/lib/diagnostics/sessionActionLog'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { syncPlugInPropsForDcEndpoints } from '@/lib/eendraad/endpointInsertAfter'
import { pruneEendraadFrames } from '@/lib/eendraad/frameContent'
import { logger } from '@/lib/logger'
import {
  EENDRAAD_NAMING_DEBUG,
  cleanupPanelGridSlotsForDevice,
  deletePanelFromProject,
  findCircuitById,
  findCircuitOwner,
  findEndpointById,
  getAllCircuits,
  getAllEndpoints,
  getDomoticaChildEndpointIds,
  getOwningProtectionForCircuit,
  maybeApplyAutomaticEendraadNamingForPanel,
  normalizeDomoticaCircuit,
  removeEndpointIdsFromCircuit,
  syncManualChronologyForInstallDateUpdate,
} from '@/lib/eendraad/projectElectricalDomain'
import { withCustomPlacementFlag } from '@/lib/plan/customPlacement'
import { isMainPanelDistributionEndpoint, resolvePanelForDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import { healPlanWiring } from '@/lib/plan/planWiring'
import { getBuildingFloorsFromProject } from '@/lib/projectV2/buildingFloors'
import {
  getMutablePlanWiringFromProject,
  syncPlanWiringFromCompatibility,
} from '@/lib/projectV2/planWiring'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  getMutableElectricalInstallationForProject,
  getMutableElectricalPanelsForProject,
} from '@/lib/projectV2/electrical'
import type {
  Circuit,
  Endpoint,
  Installation,
  JunctionPanelPlacement,
  Panel,
  PanelGridModuleRef,
  Placement,
  ProtectionDevice,
} from '@/types/schema'
import { findCircuitForEndpointInPanel, generateId, getNextAvailableCircuitCode } from '@/utils/project'

export const createPlanPlacementSlice: ProjectSliceCreator = (set, get) => ({
    // Ground trunk device actions (devices on the ground wire)
    addGroundTrunkDevice: (device, insertIndex) =>
      set((state) => {
        if (state.currentProject) {
          const installation = getMutableElectricalInstallationForProject(state.currentProject)
          if (!installation) return
          if (!installation.groundTrunkDevices) {
            installation.groundTrunkDevices = []
          }
          // Insert at the specified index, or append at end
          const idx = insertIndex ?? installation.groundTrunkDevices.length
          installation.groundTrunkDevices.splice(idx, 0, device)
          state.isDirty = true
        }
      }),

    updateGroundTrunkDevice: (deviceId, updates) =>
      set((state) => {
        if (state.currentProject) {
          const installation = getElectricalInstallationFromProject(state.currentProject)
          const devices = installation?.groundTrunkDevices
          if (devices) {
            const device = devices.find((d) => d.id === deviceId)
            if (device) {
              Object.assign(device, updates)
              syncManualChronologyForInstallDateUpdate(
                state.currentProject,
                { id: deviceId, type: 'trunkDevice' },
                updates
              )
              state.isDirty = true
            }
          }
        }
      }),

    deleteGroundTrunkDevice: (deviceId) =>
      set((state) => {
        if (state.currentProject) {
          const project = state.currentProject
          const installation = getElectricalInstallationFromProject(project)
          const panels = getElectricalPanelsFromProject(project)
          if (!installation) return
          let removedLabel: string | undefined
          if (installation.groundTrunkDevices) {
            const index = installation.groundTrunkDevices.findIndex((d) => d.id === deviceId)
            if (index !== -1) {
              const [removed] = installation.groundTrunkDevices.splice(index, 1)
              if (removed?.type === 'junction_panel') {
                removedLabel = removed.label
              }
              const deviceRef: PanelGridModuleRef = {
                kind: 'trunkDevice',
                id: deviceId,
                scope: 'ground',
              }
              cleanupPanelGridSlotsForDevice(panels, deviceRef)
              pruneEendraadFrames(project, { removedMemberIds: [deviceId] })
              state.isDirty = true
            }
          }
          if (removedLabel && installation.junctionPanelPlacements) {
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

    ensureJunctionPanelPlacementForLabel: (label, floorId) => {
      const state = get()
      const project = state.currentProject
      const installation = project ? getElectricalInstallationFromProject(project) : undefined
      if (!project || !installation) return
      const list = installation.junctionPanelPlacements ?? []
      if (list.some((jp) => jp.label === label)) return
      const floors = getBuildingFloorsFromProject(project)
      const firstFloorId = floorId ?? floors[0]?.id
      if (!firstFloorId) return
      const placement: JunctionPanelPlacement = {
        id: generateId(),
        label,
        floorId: firstFloorId,
        pos: { x: 200, y: 200 },
        rotationDeg: 0,
        scale: 1,
        layer: 'default',
      }
      state.addJunctionPanelPlacement(placement)
    },

    addJunctionPanelPlacement: (placement) =>
      set((state) => {
        if (state.currentProject) {
          const installation = getElectricalInstallationFromProject(state.currentProject)
          if (!installation) return
          if (!installation.junctionPanelPlacements) {
            installation.junctionPanelPlacements = []
          }
          installation.junctionPanelPlacements.push(placement)
          state.isDirty = true
        }
      }),

    updateJunctionPanelPlacement: (id, updates) =>
      set((state) => {
        if (state.currentProject) {
          const list = getElectricalInstallationFromProject(
            state.currentProject
          )?.junctionPanelPlacements
          if (!list) return
          const idx = list.findIndex((jp) => jp.id === id)
          if (idx !== -1) {
            const jp = list[idx]!
            list[idx] = {
              ...jp,
              ...updates,
            }
            state.isDirty = true
          }
        }
      }),

    removeJunctionPanelPlacement: (id) =>
      set((state) => {
        if (state.currentProject) {
          const installation = getElectricalInstallationFromProject(state.currentProject)
          if (!installation?.junctionPanelPlacements) return
          installation.junctionPanelPlacements = installation.junctionPanelPlacements.filter(
            (jp) => jp.id !== id
          )
          state.isDirty = true
        }
      }),

    addEarthingPlacement: (placement) =>
      set((state) => {
        if (state.currentProject) {
          const installation = getElectricalInstallationFromProject(state.currentProject)
          if (!installation) return
          if (!installation.earthingPlacements) {
            installation.earthingPlacements = []
          }
          installation.earthingPlacements.push(placement)
          state.isDirty = true
        }
      }),

    updateEarthingPlacement: (id, updates) =>
      set((state) => {
        const list = state.currentProject
          ? getElectricalInstallationFromProject(state.currentProject)?.earthingPlacements
          : undefined
        if (!list) return
        const idx = list.findIndex((p) => p.id === id)
        if (idx === -1) return
        list[idx] = { ...list[idx]!, ...updates }
        state.isDirty = true
      }),

    removeEarthingPlacement: (id) =>
      set((state) => {
        const inst = state.currentProject
          ? getElectricalInstallationFromProject(state.currentProject)
          : undefined
        if (!inst?.earthingPlacements) return
        inst.earthingPlacements = inst.earthingPlacements.filter((p) => p.id !== id)
        state.isDirty = true
      }),

    getJunctionPanelPlacementByLabel: (label) => {
      const project = getProjectStoreApi().getState().currentProject
      return getElectricalInstallationFromProject(project ?? {})?.junctionPanelPlacements?.find(
        (jp) => jp.label === label
      )
    },

    // Endpoint actions
    addEndpoint: (circuitId, endpoint, insertAfterEndpointId, branchOpts) =>
      set((state) => {
        if (state.currentProject) {
          const panels = getMutableElectricalPanelsForProject(state.currentProject)
          for (const panel of panels) {
            const result = findCircuitById(panel, circuitId)
            if (result) {
              if (!endpoint.placements) {
                endpoint.placements = []
              }
              const circuitCodeBefore = result.circuit.code
              // If this is the first real endpoint on this circuit and the circuit
              // doesn't have a proper alphabetic code yet, assign one now. This is
              // the canonical moment when circuits/protections start to "consume"
              // labels in the global sequence.
              const isFirstEndpoint = result.circuit.endpoints.length === 0
              const hasAlphabeticCode =
                !!result.circuit.code && /^[A-Z]+$/.test(result.circuit.code.trim())
              let assignedCircuitCode: string | null = null

              if (isFirstEndpoint && !hasAlphabeticCode) {
                const project = state.currentProject
                const circuitOwner = project
                  ? findCircuitOwner(getElectricalPanelsFromProject(project), circuitId)
                  : null
                if (project) {
                  const newCode = getNextAvailableCircuitCode(project, circuitOwner?.panel.id)
                  assignedCircuitCode = newCode
                  result.circuit.code = newCode
                }
              }

              // Branch point labels (A1, A2, …) are assigned after branch topology settles below.

              // If this circuit lives under a protection that currently has no label,
              // assign the protection label to match the circuit code once it gains endpoints.
              const parentProtection = getOwningProtectionForCircuit(result, circuitId)
              const protectionHadLabel =
                !!parentProtection?.label && parentProtection.label.trim().length > 0
              const syncedProtectionFromCode =
                !!parentProtection &&
                !protectionHadLabel &&
                !!result.circuit.code &&
                result.circuit.code.trim().length > 0
              if (
                parentProtection &&
                (!parentProtection.label || parentProtection.label.trim() === '')
              ) {
                parentProtection.label = result.circuit.code
              }

              if (EENDRAAD_NAMING_DEBUG) {
                const p = result.parent
                const parentKind =
                  'symbol' in p && (p as Panel).symbol === 'panel_distribution'
                    ? 'panel'
                    : 'protection'
                const parentId =
                  parentKind === 'panel' ? (p as Panel).id : (p as ProtectionDevice).id

                logger.info('[eendraad naming] addEndpoint', {
                  circuitId,
                  endpointId: endpoint.id,
                  loopRootPanelId: panel.id,
                  circuitParentKind: parentKind,
                  circuitParentId: parentId,
                  isFirstEndpoint,
                  hadAlphabeticCircuitCode: hasAlphabeticCode,
                  circuitCodeBefore,
                  circuitCodeAfter: result.circuit.code,
                  assignedNewCircuitCode: assignedCircuitCode,
                  skipNewCodeReason: !isFirstEndpoint
                    ? 'not_first_endpoint_on_circuit'
                    : hasAlphabeticCode
                      ? 'circuit_already_has_A_Z_code'
                      : !state.currentProject
                        ? 'no_project'
                        : null,
                  endpointBranchLabel: endpoint.label,
                  parentProtectionResolved: !!parentProtection,
                  parentProtectionId: parentProtection?.id ?? null,
                  protectionHadLabelBefore: protectionHadLabel,
                  protectionLabelAfter: parentProtection?.label ?? null,
                  syncedProtectionLabelFromCircuitCode: syncedProtectionFromCode,
                  hintIfStillBlank:
                    !parentProtection && parentKind === 'panel'
                      ? 'circuit lives on panel.circuits (not under a protection); MCB letter only syncs for circuits under protection.circuits'
                      : !result.circuit.code?.trim()
                        ? 'circuit.code still empty — no alphabetic code was assigned (see skipNewCodeReason / hadAlphabeticCircuitCode)'
                        : parentProtection &&
                            !protectionHadLabel &&
                            !(parentProtection.label ?? '').trim()
                          ? 'protection resolved but label still empty after sync (check circuit.code above)'
                          : protectionHadLabel
                            ? 'protection already had a label; not overwritten'
                            : null,
                })
              }
              // Insert at position or append (all mutation inside set() so state is writable)
              // null = insert at very start, string = insert after that endpoint, undefined = append
              if (insertAfterEndpointId === null) {
                result.circuit.endpoints.unshift(endpoint)
              } else if (insertAfterEndpointId) {
                const insertIndex = result.circuit.endpoints.findIndex(
                  (e) => e.id === insertAfterEndpointId
                )
                if (insertIndex >= 0) {
                  result.circuit.endpoints.splice(insertIndex + 1, 0, endpoint)
                } else {
                  result.circuit.endpoints.push(endpoint)
                }
              } else {
                result.circuit.endpoints.push(endpoint)
              }

              // Keep branches in sync so the new endpoint appears on the one-line diagram.
              // Callers (e.g. PropertiesPanel enabling domotica control wire) only call addEndpoint;
              // the drop handler additionally calls updateCircuit for branches, but addEndpoint must
              // maintain branch consistency when used alone.
              const endpointId = endpoint.id
              let branches = result.circuit.branches ?? []
              if (branches.length === 0) {
                branches = [
                  {
                    id: generateId(),
                    label: result.circuit.endpoints[0]?.label ?? '',
                    endpointIds: result.circuit.endpoints.map((e) => e.id),
                  },
                ]
                result.circuit.branches = branches
              } else {
                if (
                  branchOpts?.forceNewBranch ||
                  (insertAfterEndpointId === undefined && !endpoint.domoticaChildProps)
                ) {
                  const newBranch = {
                    id: generateId(),
                    label: '',
                    endpointIds: [endpointId],
                  }
                  branches.push(newBranch)
                  result.circuit.branches = branches
                } else if (insertAfterEndpointId === null) {
                  const first = branches[0]
                  if (first) {
                    first.endpointIds.unshift(endpointId)
                  }
                } else if (insertAfterEndpointId) {
                  const branch = branches.find((b) => b.endpointIds.includes(insertAfterEndpointId))
                  if (branch) {
                    const idx = branch.endpointIds.indexOf(insertAfterEndpointId)
                    branch.endpointIds.splice(idx + 1, 0, endpointId)
                  } else {
                    const last = branches[branches.length - 1]
                    if (last) {
                      last.endpointIds.push(endpointId)
                    }
                  }
                } else {
                  const last = branches[branches.length - 1]
                  if (last) {
                    last.endpointIds.push(endpointId)
                  }
                }
              }

              // Skip normalization when adding a domotica child: the drop handler will update the
              // parent's child list at the correct index and then call normalizeDomoticaForCircuit.
              if (!endpoint.domoticaChildProps) {
                normalizeDomoticaCircuit(result.circuit)
              }
              syncPlugInPropsForDcEndpoints(result.circuit)
              syncSequentialEndpointBranchLabelsToCircuit(result.circuit)
              healPlanWiring(state.currentProject)
              const ownerPanel = findCircuitOwner(panels, circuitId)?.panel
              if (ownerPanel) {
                maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, ownerPanel.id)
              }
              state.lastWorkedCircuitId = result.circuit.id
              state.isDirty = true
              return
            }
          }
        }
      }),

    addEndpointWithPlacement: (
      circuitId,
      endpoint,
      placement,
      insertAfterEndpointId,
      branchOpts
    ) => {
      const projectBefore = get().currentProject
      if (!projectBefore) return
      const snapshotBefore = cloneProjectForHistory(projectBefore)
      const { addEndpoint, addPlacement } = get()

      // Prevent split history entries (endpoint first, placement second).
      projectHistory.clearPending()
      projectHistory.runWithoutRecording(() => {
        addEndpoint(circuitId, endpoint, insertAfterEndpointId, branchOpts)
        addPlacement(endpoint.id, placement)
      })

      appendUndoSnapshotInStore(set, snapshotBefore)
      recordSessionAction('add endpoint with placement')
    },

    moveEndpointToCircuit: (endpointId, targetCircuitId) =>
      set((state) => {
        if (!state.currentProject) return
        const panels = getMutableElectricalPanelsForProject(state.currentProject)
        let targetCircuit: { circuit: Circuit; parent: Panel | ProtectionDevice } | null = null
        for (const panel of panels) {
          const found = findCircuitById(panel, targetCircuitId)
          if (found) {
            targetCircuit = found
            break
          }
        }
        if (!targetCircuit || targetCircuit.circuit.code === 'PANEL') return

        let endpoint: Endpoint | null = null
        let sourceCircuit: Circuit | null = null
        for (const panel of panels) {
          const result = findEndpointById(panel, endpointId)
          if (result) {
            endpoint = result.endpoint
            sourceCircuit = result.circuit
            break
          }
        }
        if (!endpoint || !sourceCircuit) return
        const idx = sourceCircuit.endpoints.findIndex((e) => e.id === endpointId)
        if (idx === -1) return
        sourceCircuit.endpoints.splice(idx, 1)
        if (sourceCircuit.branches) {
          sourceCircuit.branches = sourceCircuit.branches
            .map((b) => ({ ...b, endpointIds: b.endpointIds.filter((id) => id !== endpointId) }))
            .filter((b) => b.endpointIds.length > 0)
        }
        for (const panel of panels) {
          if (targetCircuit && targetCircuit.circuit && findCircuitById(panel, targetCircuitId)) {
            // If this is the first endpoint on the target circuit and it doesn't
            // yet have a proper alphabetic code, assign one now.
            const isFirstEndpointOnTarget = targetCircuit.circuit.endpoints.length === 0
            const hasAlphabeticCodeOnTarget =
              !!targetCircuit.circuit.code && /^[A-Z]+$/.test(targetCircuit.circuit.code.trim())
            if (isFirstEndpointOnTarget && !hasAlphabeticCodeOnTarget) {
              const project = state.currentProject
              const circuitOwner = project
                ? findCircuitOwner(getElectricalPanelsFromProject(project), targetCircuitId)
                : null
              if (project) {
                const newCode = getNextAvailableCircuitCode(project, circuitOwner?.panel.id)

                logger.info('[moveEndpointToCircuit] assigning circuit code for first endpoint', {
                  targetCircuitId,
                  newCode,
                })
                targetCircuit.circuit.code = newCode
              }
            }

            endpoint!.label = ''
            targetCircuit.circuit.endpoints.push(endpoint!)
            // New circuits from createEmptyCircuitOnPanel have no branches[]; orphan detection
            // requires every endpoint to appear in branch.endpointIds.
            const existingBranches = targetCircuit.circuit.branches
            if (!existingBranches?.length) {
              const soleBranch = {
                id: generateId(),
                label: '',
                endpointIds: targetCircuit.circuit.endpoints.map((e) => e.id),
              }
              targetCircuit.circuit.branches = [soleBranch]
            } else {
              const newBranch = {
                id: generateId(),
                label: '',
                endpointIds: [endpointId],
              }
              existingBranches.push(newBranch)
            }
            syncSequentialEndpointBranchLabelsToCircuit(sourceCircuit)
            syncSequentialEndpointBranchLabelsToCircuit(targetCircuit.circuit)

            // Ensure the parent protection gets a label once this circuit has endpoints.
            const parentProtection = getOwningProtectionForCircuit(targetCircuit, targetCircuitId)
            if (
              parentProtection &&
              (!parentProtection.label || parentProtection.label.trim() === '')
            ) {
              parentProtection.label = targetCircuit.circuit.code
            }
            normalizeDomoticaCircuit(sourceCircuit)
            normalizeDomoticaCircuit(targetCircuit.circuit)
            syncPlugInPropsForDcEndpoints(sourceCircuit)
            syncPlugInPropsForDcEndpoints(targetCircuit.circuit)
            state.lastWorkedCircuitId = targetCircuit.circuit.id
            state.isDirty = true
            return
          }
        }
      }),

    updateEndpoint: (id, updates: Partial<Endpoint> & { circuitId?: string }) =>
      set((state) => {
        const hasAnyUpdate = Object.keys(updates).length > 0
        if (!hasAnyUpdate) return
        if (state.currentProject) {
          for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
            const result = findEndpointById(panel, id)
            if (result) {
              const nextLabel = updates.label
              const nextCircuitId = updates.circuitId
              const otherUpdateKeys = Object.keys(updates).filter(
                (key) => key !== 'label' && key !== 'circuitId'
              )
              const isNoOpLabel = nextLabel !== undefined && nextLabel === result.endpoint.label
              const isNoOpCircuitMove =
                nextCircuitId !== undefined && nextCircuitId === result.circuit.id
              const hasOtherChanges = otherUpdateKeys.some((key) => {
                const nextValue = (updates as Record<string, unknown>)[key]
                const currentValue = (result.endpoint as unknown as Record<string, unknown>)[key]
                return nextValue !== currentValue
              })
              if (
                (isNoOpLabel || nextLabel === undefined) &&
                (isNoOpCircuitMove || nextCircuitId === undefined) &&
                !hasOtherChanges
              ) {
                return
              }
              const previousCircuit = result.circuit
              // If circuit is changing, we need to move the endpoint
              if (updates.circuitId && updates.circuitId !== result.circuit.id) {
                const newCircuitResult = findCircuitById(panel, updates.circuitId)
                if (newCircuitResult?.circuit.code === 'PANEL') {
                  return
                }
                if (newCircuitResult && newCircuitResult.circuit.code !== 'PANEL') {
                  // Remove from old circuit
                  const index = result.circuit.endpoints.findIndex((e) => e.id === id)
                  if (index !== -1) {
                    result.circuit.endpoints.splice(index, 1)
                  }
                  if (result.circuit.branches) {
                    result.circuit.branches = result.circuit.branches
                      .map((b) => ({
                        ...b,
                        endpointIds: b.endpointIds.filter((bid) => bid !== id),
                      }))
                      .filter((b) => b.endpointIds.length > 0)
                  }

                  // Add to new circuit — branch labels synced sequentially after topology change.
                  const { label: _omitLabel, ...endpointUpdatesWithoutLabel } = updates
                  Object.assign(result.endpoint, endpointUpdatesWithoutLabel)
                  syncManualChronologyForInstallDateUpdate(
                    state.currentProject,
                    { id, type: 'endpoint' },
                    endpointUpdatesWithoutLabel
                  )
                  delete (result.endpoint as Endpoint & { circuitId?: string }).circuitId
                  newCircuitResult.circuit.endpoints.push(result.endpoint)
                  const nb = newCircuitResult.circuit.branches
                  if (!nb?.length) {
                    const soleBranch = {
                      id: generateId(),
                      label: '',
                      endpointIds: newCircuitResult.circuit.endpoints.map((e) => e.id),
                    }
                    newCircuitResult.circuit.branches = [soleBranch]
                  } else {
                    const newBranch = {
                      id: generateId(),
                      label: '',
                      endpointIds: [id],
                    }
                    nb.push(newBranch)
                  }
                  normalizeDomoticaCircuit(previousCircuit)
                  normalizeDomoticaCircuit(newCircuitResult.circuit)
                  syncSequentialEndpointBranchLabelsToCircuit(previousCircuit)
                  syncSequentialEndpointBranchLabelsToCircuit(newCircuitResult.circuit)
                }
              } else {
                Object.assign(result.endpoint, updates)
                syncManualChronologyForInstallDateUpdate(
                  state.currentProject,
                  { id, type: 'endpoint' },
                  updates
                )

                // Propagate label changes to the branch and all sibling endpoints.
                // The branch label is the single source of truth — when one endpoint's
                // label is edited, all endpoints on the same branch must follow.
                if (updates.label !== undefined && result.circuit.branches?.length) {
                  const branch = result.circuit.branches.find((b) => b.endpointIds.includes(id))
                  if (branch) {
                    branch.label = updates.label
                    // Sync label to all sibling endpoints on this branch
                    for (const siblingId of branch.endpointIds) {
                      if (siblingId === id) continue
                      const sibling = result.circuit.endpoints.find((e) => e.id === siblingId)
                      if (sibling) {
                        sibling.label = updates.label
                      }
                    }
                  }
                }
                normalizeDomoticaCircuit(result.circuit)
              }
              if (getMutableElectricalInstallationForProject(state.currentProject)?.eendraadAutomaticNaming) {
                const circuitIdForRefresh =
                  updates.circuitId && updates.circuitId !== previousCircuit.id
                    ? previousCircuit.id
                    : result.circuit.id
                const owner = findCircuitOwner(getMutableElectricalPanelsForProject(state.currentProject), circuitIdForRefresh)
                if (owner) {
                  maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, owner.panel.id)
                }
                if (updates.circuitId && updates.circuitId !== previousCircuit.id) {
                  const destOwner = findCircuitOwner(getMutableElectricalPanelsForProject(state.currentProject), updates.circuitId)
                  if (destOwner && destOwner.panel.id !== owner?.panel.id) {
                    maybeApplyAutomaticEendraadNamingForPanel(
                      state.currentProject,
                      destOwner.panel.id
                    )
                  }
                }
              }
              state.lastWorkedCircuitId =
                updates.circuitId && updates.circuitId !== result.circuit.id
                  ? updates.circuitId
                  : result.circuit.id
              state.isDirty = true
              return
            }
          }
        }
      }),

    deleteEndpoint: (id) =>
      set((state) => {
        if (state.currentProject) {
          const panels = getMutableElectricalPanelsForProject(state.currentProject)
          for (const panel of panels) {
            const result = findEndpointById(panel, id)
            if (result) {
              if (isMainPanelDistributionEndpoint(state.currentProject, result.endpoint)) {

                logger.warn(
                  '[projectStore] deleteEndpoint blocked for main panel distribution symbol',
                  {
                    endpointId: id,
                  }
                )
                return
              }
              if (result.endpoint.symbol === 'panel_distribution') {
                const linkedPanel = resolvePanelForDistributionEndpoint(
                  state.currentProject,
                  result.endpoint
                )
                if (linkedPanel && !linkedPanel.isMain) {
                  if (deletePanelFromProject(state.currentProject, linkedPanel.id)) {
                    state.isDirty = true
                  }
                  return
                }
              }
              const idsToDelete = new Set<string>([id])
              if (result.endpoint.symbol === 'domotica') {
                for (const childId of getDomoticaChildEndpointIds(result.endpoint)) {
                  idsToDelete.add(childId)
                }
                cleanupPanelGridSlotsForDevice(panels, {
                  kind: 'domotica',
                  endpointId: result.endpoint.id,
                  circuitId: result.circuit.id,
                })
              }

              removeEndpointIdsFromCircuit(result.circuit, idsToDelete)
              normalizeDomoticaCircuit(result.circuit)
              syncPlugInPropsForDcEndpoints(result.circuit)
              syncSequentialEndpointBranchLabelsToCircuit(result.circuit)
              healPlanWiring(state.currentProject)
              if (getMutableElectricalInstallationForProject(state.currentProject)?.eendraadAutomaticNaming) {
                const owner = findCircuitOwner(panels, result.circuit.id)
                if (owner) {
                  maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, owner.panel.id)
                }
              }
              pruneEendraadFrames(state.currentProject, { removedMemberIds: idsToDelete })
              state.isDirty = true
              return
            }
          }
        }
      }),

    moveEndpointInBranch: (endpointId, direction) =>
      set((state) => {
        logger.info('[moveEndpointInBranch]', { endpointId, direction })
        if (!state.currentProject) {
          logger.warn('[moveEndpointInBranch] No current project')
          return
        }
        for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
          const result = findEndpointById(panel, endpointId)
          if (result && result.circuit.branches) {
            const branch = result.circuit.branches.find((b) => b.endpointIds.includes(endpointId))
            if (branch) {
              const index = branch.endpointIds.indexOf(endpointId)
              logger.info('[moveEndpointInBranch] Found branch', {
                branchId: branch.id,
                index,
                total: branch.endpointIds.length,
              })
              if (direction === 'left' && index > 0) {
                // Move left (earlier in array)
                const temp = branch.endpointIds[index]!
                branch.endpointIds[index] = branch.endpointIds[index - 1]!
                branch.endpointIds[index - 1] = temp
                logger.info('[moveEndpointInBranch] Moved left', {
                  newIndex: index - 1,
                  newOrder: branch.endpointIds,
                })
                syncPlugInPropsForDcEndpoints(result.circuit)
                healPlanWiring(state.currentProject)
                state.isDirty = true
                return
              } else if (direction === 'right' && index < branch.endpointIds.length - 1) {
                // Move right (later in array)
                const temp = branch.endpointIds[index]!
                branch.endpointIds[index] = branch.endpointIds[index + 1]!
                branch.endpointIds[index + 1] = temp
                logger.info('[moveEndpointInBranch] Moved right', {
                  newIndex: index + 1,
                  newOrder: branch.endpointIds,
                })
                syncPlugInPropsForDcEndpoints(result.circuit)
                healPlanWiring(state.currentProject)
                state.isDirty = true
                return
              } else {
                logger.info('[moveEndpointInBranch] Cannot move', {
                  direction,
                  index,
                  length: branch.endpointIds.length,
                })
              }
            } else {
              logger.warn('[moveEndpointInBranch] Endpoint not found in any branch')
            }
          }
        }
      }),

    moveDomoticaChildOutput: (endpointId, direction) =>
      set((state) => {
        if (!state.currentProject) return
        for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
          const result = findEndpointById(panel, endpointId)
          if (!result) continue
          const { endpoint: child, circuit } = result
          const ref = child.domoticaChildProps
          if (!ref) return
          const parent = circuit.endpoints.find((e) => e.id === ref.parentEndpointId)
          if (!parent?.domoticaProps) return
          const ids: string[] = [...(parent.domoticaProps.endpointChildEndpointIds ?? [])]
          const index = ids.indexOf(endpointId)
          if (index === -1) return
          if (direction === 'up' && index > 0) {
            const prevId = ids[index - 1]
            if (!prevId) return
            ids[index] = prevId
            ids[index - 1] = endpointId
          } else if (direction === 'down' && index < ids.length - 1) {
            const nextId = ids[index + 1]
            if (!nextId) return
            ids[index] = nextId
            ids[index + 1] = endpointId
          } else return
          const nextProps = {
            ...parent.domoticaProps,
            endpointChildEndpointIds: ids,
          }
          parent.domoticaProps = nextProps
          normalizeDomoticaCircuit(circuit)
          state.isDirty = true
          return
        }
      }),

    normalizeDomoticaForCircuit: (circuitId) =>
      set((state) => {
        if (!state.currentProject) return
        for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
          const result = findCircuitById(panel, circuitId)
          if (result) {
            normalizeDomoticaCircuit(result.circuit)
            state.isDirty = true
            return
          }
        }
      }),

    deleteEndpoints: (ids) =>
      set((state) => {
        if (state.currentProject) {
          const project = state.currentProject
          const panels = getElectricalPanelsFromProject(project)
          const filtered: string[] = ids.filter((id) => {
            for (const panel of panels) {
              const result = findEndpointById(panel, id)
              if (result && isMainPanelDistributionEndpoint(project, result.endpoint)) {

                logger.warn(
                  '[projectStore] deleteEndpoints skipped main panel distribution symbol',
                  {
                    endpointId: id,
                  }
                )
                return false
              }
            }
            return true
          })
          if (filtered.length === 0) return
          const prunedMemberIds = new Set<string>(filtered)
          const panelIdsToDelete = new Set<string>()
          for (const endpointId of filtered) {
            for (const panel of getElectricalPanelsFromProject(project)) {
              const result = findEndpointById(panel, endpointId)
              if (!result) continue
              if (result.endpoint.symbol !== 'panel_distribution') continue
              const linkedPanel = resolvePanelForDistributionEndpoint(project, result.endpoint)
              if (linkedPanel && !linkedPanel.isMain) {
                panelIdsToDelete.add(linkedPanel.id)
              }
            }
          }
          for (const panelId of panelIdsToDelete) {
            deletePanelFromProject(project, panelId)
          }
          const idsSet = new Set(filtered)
          const modifiedCircuitIds = new Set<string>()
          const mutablePanels = getMutableElectricalPanelsForProject(state.currentProject)
          for (const panel of mutablePanels) {
            const circuits = getAllCircuits(panel)
            for (const circuit of circuits) {
              const idsToDelete = new Set(idsSet)
              for (const endpoint of circuit.endpoints) {
                if (idsSet.has(endpoint.id) && endpoint.symbol === 'domotica') {
                  for (const childId of getDomoticaChildEndpointIds(endpoint)) {
                    idsToDelete.add(childId)
                    prunedMemberIds.add(childId)
                  }
                  cleanupPanelGridSlotsForDevice(mutablePanels, {
                    kind: 'domotica',
                    endpointId: endpoint.id,
                    circuitId: circuit.id,
                  })
                }
              }

              const before = circuit.endpoints.length
              removeEndpointIdsFromCircuit(circuit, idsToDelete)
              if (circuit.endpoints.length !== before) {
                normalizeDomoticaCircuit(circuit)
                modifiedCircuitIds.add(circuit.id)
              }
            }
          }
          for (const circuitId of modifiedCircuitIds) {
            for (const panel of mutablePanels) {
              const found = findCircuitById(panel, circuitId)
              if (found) {
                syncSequentialEndpointBranchLabelsToCircuit(found.circuit)
                break
              }
            }
          }
          if (getMutableElectricalInstallationForProject(state.currentProject)?.eendraadAutomaticNaming) {
            const panelsToRename = new Set<string>()
            for (const circuitId of modifiedCircuitIds) {
              const owner = findCircuitOwner(mutablePanels, circuitId)
              if (owner) panelsToRename.add(owner.panel.id)
            }
            for (const panelId of panelsToRename) {
              maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
            }
          }
          pruneEendraadFrames(state.currentProject, { removedMemberIds: prunedMemberIds })
          state.isDirty = true
        }
      }),

    // Placement actions
    addPlacement: (endpointId, placement) =>
      set((state) => {
        if (state.currentProject) {
          for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
            const result = findEndpointById(panel, endpointId)
            if (result) {
              result.endpoint.placements.push(placement)
              state.lastWorkedCircuitId = result.circuit.id
              state.isDirty = true
              return
            }
          }
        }
      }),

    updatePlacement: (id, updates) =>
      set((state) => {
        if (state.currentProject) {
          for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
            const endpoints = getAllEndpoints(panel)
            for (const endpoint of endpoints) {
              const placement = endpoint.placements.find((p) => p.id === id)
              if (placement) {
                Object.assign(placement, withCustomPlacementFlag(placement, updates))
                const owner = findCircuitForEndpointInPanel(panel, endpoint.id)
                if (owner?.circuit?.id) {
                  state.lastWorkedCircuitId = owner.circuit.id
                }
                state.isDirty = true
                return
              }
            }
          }
        }
      }),

    updatePlacementsBatch: (updates) =>
      set((state) => {
        if (!state.currentProject || updates.length === 0) return
        for (const { id, updates: patch } of updates) {
          let found = false
          for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
            if (found) break
            const endpoints = getAllEndpoints(panel)
            for (const endpoint of endpoints) {
              const placement = endpoint.placements.find((p) => p.id === id)
              if (placement) {
                Object.assign(placement, withCustomPlacementFlag(placement, patch))
                found = true
                break
              }
            }
          }
        }
        state.isDirty = true
      }),

    movePlanPlacementsToFloor: (moves, floorId) => {
      let applied = false
      set((state) => {
        const project = state.currentProject
        if (!project || moves.length === 0) return
        if (!getBuildingFloorsFromProject(project).some((floor) => floor.id === floorId)) return

        const uniqueMoves = new Map(moves.map((move) => [move.id, move]))
        const installation = getMutableElectricalInstallationForProject(project)
        const panels = getMutableElectricalPanelsForProject(project)
        const resolved: Array<{
          kind: 'endpoint' | 'junctionPanel' | 'earthing'
          placement: Placement | JunctionPanelPlacement | NonNullable<Installation['earthingPlacements']>[number]
          pos?: Placement['pos']
        }> = []

        for (const move of uniqueMoves.values()) {
          const junctionPanelPlacement = installation?.junctionPanelPlacements?.find(
            (placement) => placement.id === move.id
          )
          if (junctionPanelPlacement) {
            resolved.push({
              kind: 'junctionPanel',
              placement: junctionPanelPlacement,
              pos: move.pos,
            })
            continue
          }

          const earthingPlacement = installation?.earthingPlacements?.find(
            (placement) => placement.id === move.id
          )
          if (earthingPlacement) {
            resolved.push({ kind: 'earthing', placement: earthingPlacement, pos: move.pos })
            continue
          }

          let endpointPlacement: Placement | undefined
          for (const panel of panels) {
            if (endpointPlacement) break
            for (const endpoint of getAllEndpoints(panel)) {
              endpointPlacement = endpoint.placements.find((placement) => placement.id === move.id)
              if (endpointPlacement) break
            }
          }
          if (!endpointPlacement) return
          resolved.push({ kind: 'endpoint', placement: endpointPlacement, pos: move.pos })
        }

        // Preserve a manual wire when both of its placement endpoints travel together. Routes
        // with only one moved endpoint are removed by healing below instead of becoming stale.
        const movedPlacementIds = new Set(uniqueMoves.keys())
        const planWiring = getMutablePlanWiringFromProject(project)
        planWiring?.routes.forEach((route) => {
          const fromPlacementId = route.from.placementId
          const toPlacementId = route.to.placementId
          if (
            fromPlacementId &&
            toPlacementId &&
            movedPlacementIds.has(fromPlacementId) &&
            movedPlacementIds.has(toPlacementId)
          ) {
            route.floorId = floorId
          }
        })

        resolved.forEach(({ kind, placement, pos }) => {
          const patch = { floorId, ...(pos ? { pos } : {}) }
          if (kind === 'endpoint') {
            Object.assign(
              placement,
              withCustomPlacementFlag(placement as Placement, patch)
            )
          } else {
            Object.assign(placement, patch)
          }
        })

        healPlanWiring(project)
        syncPlanWiringFromCompatibility(project)
        state.isDirty = true
        applied = true
      })
      return applied
    },

    deletePlacement: (id) =>
      set((state) => {
        const inst = state.currentProject
          ? getMutableElectricalInstallationForProject(state.currentProject)
          : undefined
        if (inst?.earthingPlacements?.some((p) => p.id === id)) {
          inst.earthingPlacements = inst.earthingPlacements.filter((p) => p.id !== id)
          state.isDirty = true
          return
        }
        if (state.currentProject) {
          for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
            const endpoints = getAllEndpoints(panel)
            for (const endpoint of endpoints) {
              const index = endpoint.placements.findIndex((p) => p.id === id)
              if (index !== -1) {
                if (isMainPanelDistributionEndpoint(state.currentProject, endpoint)) {

                  logger.warn(
                    '[projectStore] deletePlacement blocked for main panel distribution symbol',
                    {
                      placementId: id,
                    }
                  )
                  return
                }
                endpoint.placements.splice(index, 1)
                healPlanWiring(state.currentProject)
                state.isDirty = true
                return
              }
            }
          }
        }
      }),

    deletePlacements: (ids) =>
      set((state) => {
        if (state.currentProject) {
          const project = state.currentProject
          const installation = getElectricalInstallationFromProject(project)
          const panels = getElectricalPanelsFromProject(project)
          const blocked = new Set<string>()
          for (const panel of panels) {
            for (const endpoint of getAllEndpoints(panel)) {
              if (!isMainPanelDistributionEndpoint(project, endpoint)) continue
              for (const pl of endpoint.placements) {
                if (ids.includes(pl.id)) blocked.add(pl.id)
              }
            }
          }
          const idsSet = new Set(ids.filter((id) => !blocked.has(id)))
          const earthingIds =
            idsSet.size > 0
              ? (installation?.earthingPlacements ?? [])
                  .filter((p) => idsSet.has(p.id))
                  .map((p) => p.id)
              : []
          if (idsSet.size === 0 && earthingIds.length === 0) {
            if (blocked.size > 0) {

              logger.warn(
                '[projectStore] deletePlacements skipped main panel distribution placement(s)'
              )
            }
            return
          }
          for (const panel of panels) {
            const endpoints = getAllEndpoints(panel)
            for (const endpoint of endpoints) {
              endpoint.placements = endpoint.placements.filter((p) => !idsSet.has(p.id))
            }
          }
          if (earthingIds.length > 0 && installation?.earthingPlacements) {
            const removeSet = new Set(earthingIds)
            installation.earthingPlacements = installation.earthingPlacements.filter(
              (p) => !removeSet.has(p.id)
            )
          }
          healPlanWiring(project)
          state.isDirty = true
        }
      }),

    deletePlacementsByEndpoint: (endpointId) =>
      set((state) => {
        if (state.currentProject) {
          for (const panel of getMutableElectricalPanelsForProject(state.currentProject)) {
            const result = findEndpointById(panel, endpointId)
            if (result) {
              if (isMainPanelDistributionEndpoint(state.currentProject, result.endpoint)) {

                logger.warn(
                  '[projectStore] deletePlacementsByEndpoint blocked for main panel distribution symbol',
                  { endpointId }
                )
                return
              }
              result.endpoint.placements = []
              healPlanWiring(state.currentProject)
              state.isDirty = true
              return
            }
          }
        }
      }),

})
