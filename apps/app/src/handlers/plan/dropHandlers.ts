import { generateId } from '@/utils'
import { createDefaultAcCircuitCable } from '@/lib/wires/circuitWireDefaults'
import { getEndpointTypeFromSymbol } from '@/utils'
import { getSymbolById, type SymbolMetadata } from '@/lib/symbols'
import type { Point, Selection } from '@/types/ui'
import type { Placement, Circuit, Endpoint, Floor, Panel, ProtectionDevice } from '@/types/schema'
import { useProjectStore } from '@/stores/projectStore'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import { trackSymbolPlace } from '@/lib/analytics/editorEventAnalytics'
import { collectCircuits } from '@/utils/eendraad/panelHelpers'
import type { PlanDropCircuitChoice, PlanDropKind } from '@/lib/plan/planDropPicker'
import { logger } from '@/lib/logger'
import {
  endpointTypeToPlanDropKind,
  planDropKindToCircuitKind,
} from '@/lib/plan/planDropPicker'
import {
  executeDropBehavior,
  type DropBehaviorCallbacks,
  type DropBehaviorProject,
} from '@/handlers/eendraad/dropBehaviors'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { getElectricalPanelsFromProject } from '@/lib/projectV2/electrical'

export interface CommitPlanSymbolDropParams {
  symbol: SymbolMetadata
  position: Point
  floorId: string
  floorLayer: string
  panelId: string
  circuitChoice: PlanDropCircuitChoice
  setSelection: (selection: Selection) => void
}

export type CreateEmptyCircuitOnPanelOptions = {
  /** Legacy MCB label; leave empty so circuit code sync sets the protection label after first endpoint. */
  protectionLabel?: string
  /** Stored on `Circuit.notes` (optional description). */
  circuitNotes?: string
}

type PlanDropProjectInput = {
  panels: Panel[]
}

function findCircuitInPanelTree(panels: readonly Panel[], circuitId: string): Circuit | null {
  for (const panel of panels) {
    for (const circuit of collectCircuits(panel)) {
      if (circuit.id === circuitId) return circuit
    }
    const nested = findCircuitInPanelTree(panel.subPanels ?? [], circuitId)
    if (nested) return nested
  }
  return null
}

function findPanelInTree(panels: readonly Panel[], panelId: string): Panel | null {
  for (const panel of panels) {
    if (panel.id === panelId) return panel
    const nested = findPanelInTree(panel.subPanels ?? [], panelId)
    if (nested) return nested
  }
  return null
}

function findProtectionInPanelTree(
  panels: readonly Panel[],
  protectionId: string,
): ProtectionDevice | null {
  for (const panel of panels) {
    const protection = panel.protections?.find((candidate) => candidate.id === protectionId)
    if (protection) return protection
    const nested = findProtectionInPanelTree(panel.subPanels ?? [], protectionId)
    if (nested) return nested
  }
  return null
}

function getCircuitForPlanDrop(circuitId: string): Circuit | null {
  const store = useProjectStore.getState()
  return (
    store.getCircuitById(circuitId) ??
    (store.currentProject
      ? findCircuitInPanelTree((store.currentProject as { panels?: Panel[] }).panels ?? [], circuitId)
      : null)
  )
}

function createStoreDropBehaviorCallbacks(
  overrides: Partial<DropBehaviorCallbacks> = {},
): DropBehaviorCallbacks {
  const store = useProjectStore.getState()
  return {
    addPanel: store.addPanel,
    addProtection: store.addProtection,
    addCircuit: store.addCircuit,
    addCircuitToProtection: store.addCircuitToProtection,
    addEndpoint: store.addEndpoint,
    addPlacement: store.addPlacement,
    setSelection: () => {},
    getFloorById: (floorId) => {
      const floor = store.getFloorById(floorId)
      return floor ? { id: floor.id, layers: floor.layers } : null
    },
    getCircuitById: (circuitId) => store.getCircuitById(circuitId) ?? null,
    getProtectionById: (protectionId) => store.getProtectionById(protectionId) ?? null,
    addTrunkDevice: store.addTrunkDevice,
    addSupplyTrunkDevice: store.addSupplyTrunkDevice,
    addGroundTrunkDevice: store.addGroundTrunkDevice,
    ensureJunctionPanelPlacementForLabel: store.ensureJunctionPanelPlacementForLabel,
    updateCircuit: store.updateCircuit,
    updateProtection: store.updateProtection,
    updateInstallation: store.updateInstallation,
    moveCircuitOnMainBus: store.moveCircuitOnMainBus,
    moveCircuitToSecondaryBus: store.moveCircuitToSecondaryBus,
    deleteEndpoint: store.deleteEndpoint,
    addEendraadNote: store.addEendraadNote,
    ...overrides,
  }
}

/**
 * Add a new MCB + empty circuit on a panel (same defaults as plan drop “new circuit”).
 */
export function createEmptyCircuitOnPanel(
  panelId: string,
  dropKind: PlanDropKind,
  options?: CreateEmptyCircuitOnPanelOptions | string
): string | null {
  const store = useProjectStore.getState()
  if (!store.currentProject) return null

  const normalized: CreateEmptyCircuitOnPanelOptions =
    typeof options === 'string' ? { protectionLabel: options } : options ?? {}

  const symbol = getSymbolById('mcb')
  if (!symbol) return null

  const circuitKind = planDropKindToCircuitKind(dropKind)
  const label = (normalized.protectionLabel ?? '').trim()
  const notesTrimmed = (normalized.circuitNotes ?? '').trim()
  let newCircuitId: string | null = null
  const callbacks = createStoreDropBehaviorCallbacks({
    addProtection: (targetPanelId, protection) => {
      const planProtection: ProtectionDevice = {
        ...protection,
        label,
        ratingA: circuitKind === 'lighting' ? 10 : 16,
        curve: 'C',
        polesConfig: '2P',
        poles: 2,
      }
      store.addProtection(targetPanelId, planProtection)
      if (findProtectionInPanelTree((store.currentProject as { panels?: Panel[] }).panels ?? [], planProtection.id)) {
        return
      }
      useProjectStore.setState((state) => {
        const panel = state.currentProject
          ? findPanelInTree((state.currentProject as { panels?: Panel[] }).panels ?? [], targetPanelId)
          : null
        if (!panel) return
        panel.protections.push(planProtection)
        state.isDirty = true
      })
    },
    addCircuit: (targetPanelId, circuit, protectionId) => {
      const planCircuit: Circuit = {
        ...circuit,
        code: '',
        kind: circuitKind,
        cable: createDefaultAcCircuitCable({
          sectionMm2: circuitKind === 'lighting' ? 1.5 : 2.5,
        }),
        ...(notesTrimmed ? { notes: notesTrimmed } : {}),
      }
      newCircuitId = planCircuit.id
      store.addCircuit(targetPanelId, planCircuit, protectionId)
      if (getCircuitForPlanDrop(planCircuit.id)) return
      useProjectStore.setState((state) => {
        const panels = (state.currentProject as { panels?: Panel[] } | null)?.panels ?? []
        const protection = protectionId ? findProtectionInPanelTree(panels, protectionId) : null
        if (protection) {
          protection.circuits = [...(protection.circuits ?? []), planCircuit]
          state.isDirty = true
          return
        }
        logger.error('Unable to create plan-drop circuit because its protection is missing', {
          panelId: targetPanelId,
          protectionId,
          circuitId: planCircuit.id,
        })
      })
    },
  })

  executeDropBehavior(
    symbol,
    { type: 'mainBus', panelId } as DropTarget,
    store.currentProject as DropBehaviorProject,
    ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never,
    callbacks,
    false,
  )
  return newCircuitId && getCircuitForPlanDrop(newCircuitId) ? newCircuitId : null
}

/**
 * Place symbol on the plan and assign to a circuit. Selects the new placement on the situation plan.
 */
export function commitPlanSymbolDrop(
  params: CommitPlanSymbolDropParams
): { endpointId: string; placementId: string; circuitId: string; panelId: string } | null {
  const {
    symbol,
    position,
    floorId,
    floorLayer,
    panelId,
    circuitChoice,
    setSelection,
  } = params

  const store = useProjectStore.getState()
  if (!store.currentProject) return null

  const endpointType = getEndpointTypeFromSymbol(symbol)
  if (!endpointType) return null

  const dropKind = endpointTypeToPlanDropKind(endpointType)

  let circuitId: string

  if (circuitChoice.mode === 'existing') {
    circuitId = circuitChoice.circuitId
  } else {
    const created = createEmptyCircuitOnPanel(panelId, dropKind, {
      protectionLabel: circuitChoice.protectionLabel,
      circuitNotes: circuitChoice.circuitNotes,
    })
    if (!created) return null
    circuitId = created
  }

  const circuit = getCircuitForPlanDrop(circuitId)
  if (!circuit || circuit.code === 'PANEL') return null

  const newPlacement: Placement = {
    id: generateId(),
    floorId,
    layer: floorLayer,
    pos: position,
    rotationDeg: 0,
    scale: 1,
  }

  let endpointId: string | null = null
  const callbacks = createStoreDropBehaviorCallbacks({
    addEndpoint: (targetCircuitId, endpoint, insertAfterEndpointId, branchOpts) => {
      endpointId = endpoint.id
      store.addEndpointWithPlacement(
        targetCircuitId,
        endpoint,
        newPlacement,
        insertAfterEndpointId ?? undefined,
        branchOpts,
      )
    },
    addPlacement: () => {},
    setSelection: () => {},
  })
  executeDropBehavior(
    symbol,
    {
      type: 'circuit',
      panelId,
      circuitId,
      insertAfterEndpointId: circuit.endpoints[circuit.endpoints.length - 1]?.id,
    } as DropTarget,
    store.currentProject as DropBehaviorProject,
    ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never,
    callbacks,
    false,
  )
  if (!endpointId) return null
  setSelection({ type: 'placement', ids: [newPlacement.id] })
  trackSymbolPlace({
    canvas: 'plan',
    symbol,
    placementMethod: 'library_drop',
    endpointType,
    dropKind,
    assignmentMode: circuitChoice.mode,
  })
  return { endpointId, placementId: newPlacement.id, circuitId, panelId }
}

/**
 * @deprecated Use commitPlanSymbolDrop with PlanDropCircuitPanel. Kept for tests / callers that bypass the picker.
 */
export function createPlanDropHandler(
  currentProject: PlanDropProjectInput | null | undefined,
  activeFloorId: string | null,
  getFloorById: (id: string) => Floor | null | undefined,
  addCircuit: (panelId: string, circuit: Circuit, protectionId: string) => void,
  addEndpoint: (circuitId: string, endpoint: Endpoint, insertAfterEndpointId?: string | null, branchOpts?: { forceNewBranch?: boolean }) => void,
  addPlacement: (endpointId: string, placement: Placement) => void,
  setSelection: (selection: Selection) => void,
  addEndpointWithPlacement?: (
    circuitId: string,
    endpoint: Endpoint,
    placement: Placement,
    insertAfterEndpointId?: string | null,
    branchOpts?: { forceNewBranch?: boolean }
  ) => void
) {
  return (position: Point, symbolData: unknown) => {
    if (!currentProject) {
      logger.warn('PlanCanvas: No current project')
      return
    }

    if (!activeFloorId) {
      logger.warn('PlanCanvas: No active floor selected')
      return
    }

    const symbol = symbolData as SymbolMetadata
    if (!symbol || !symbol.id) {
      logger.warn('PlanCanvas: Invalid symbol data:', symbolData)
      return
    }

    if (symbol.scope === 'eendraad') {
      logger.warn('PlanCanvas: Symbol scope is eendraad only:', symbol.id)
      return
    }

    const activeFloor = getFloorById(activeFloorId)
    if (!activeFloor) return

    if (symbol.id === 'note') {
      const noteId = `note-${Date.now()}`
      useProjectStore.getState().addSitplanNote({
        id: noteId,
        text: 'New note',
        fontSize: 14,
        pos: position,
        floorId: activeFloorId,
      })
      setSelection({ type: 'note', ids: [noteId] })
      trackGoogleAnalyticsEvent('note_place', {
        canvas: 'plan',
        source: 'symbol_drop',
      })
      return
    }

    const defaultPanel = getElectricalPanelsFromProject(currentProject)[0]
    if (!defaultPanel) return

    const endpointType = getEndpointTypeFromSymbol(symbol)
    if (!endpointType) return

    const dropKind = endpointTypeToPlanDropKind(endpointType)
    const circuitKind = planDropKindToCircuitKind(dropKind)

    const panelCircuits = collectCircuits(defaultPanel)
    const lastWorkedCircuitId = useProjectStore.getState().lastWorkedCircuitId
    const preferredCircuit =
      lastWorkedCircuitId
        ? panelCircuits.find((c) => c.id === lastWorkedCircuitId && c.code !== 'PANEL')
        : undefined
    let circuit = preferredCircuit ?? panelCircuits.find((c) => c.kind === circuitKind)

    if (!circuit) {
      const circuitId = createEmptyCircuitOnPanel(defaultPanel.id, dropKind)
      if (!circuitId) return
      circuit = getCircuitForPlanDrop(circuitId) ?? undefined
      if (!circuit) return
    }

    const newPlacement: Placement = {
      id: generateId(),
      floorId: activeFloorId,
      layer: activeFloor.layers?.[0] || 'electrical',
      pos: position,
      rotationDeg: 0,
      scale: 1,
    }

    let endpointId: string | null = null
    const store = useProjectStore.getState()
    const callbacks = createStoreDropBehaviorCallbacks({
      addCircuit: (panelId, circuitToAdd, protectionId) => {
        if (protectionId) addCircuit(panelId, circuitToAdd, protectionId)
      },
      addEndpoint: (targetCircuitId, endpoint, insertAfterEndpointId, branchOpts) => {
        endpointId = endpoint.id
        if (addEndpointWithPlacement) {
          addEndpointWithPlacement(
            targetCircuitId,
            endpoint,
            newPlacement,
            insertAfterEndpointId ?? undefined,
            branchOpts,
          )
        } else {
          addEndpoint(targetCircuitId, endpoint, insertAfterEndpointId ?? undefined, branchOpts)
          addPlacement(endpoint.id, newPlacement)
        }
      },
      addPlacement: () => {},
      setSelection: () => {},
    })
    executeDropBehavior(
      symbol,
      {
        type: 'circuit',
        panelId: defaultPanel.id,
        circuitId: circuit.id,
        insertAfterEndpointId: circuit.endpoints[circuit.endpoints.length - 1]?.id,
      } as DropTarget,
      (store.currentProject ?? currentProject) as DropBehaviorProject,
      ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never,
      callbacks,
      false,
    )
    if (!endpointId) return

    setSelection({ type: 'endpoint', ids: [endpointId] })
  }
}
