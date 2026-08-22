/**
 * Alt-drag duplicate on the 1-wire canvas: drop-target placement with source properties,
 * sitplan auto-place, and no delete of the source (unlike move-drag).
 */

import { ensureSitplanPlacementsForEndpoints } from '@/lib/eendraad/duplicateSitplanHelpers'
import { endpointSymbolCanBeDuplicated } from '@/lib/eendraad/duplicateEndpoint'
import {
  getMainBusItemsWithIndices,
  getMainBusOrder,
  pickRepresentativeCircuitIdForMainBusMove,
} from '@/lib/eendraad/mainBusOrder'
import { findDomoticaOutputDropTarget } from '@/lib/layout/findDropTarget'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { LayoutTree } from '@/lib/layout/layoutTree'
import { executeDropBehavior } from '@/handlers/eendraad/dropBehaviors'
import type { DropBehaviorProject } from '@/handlers/eendraad/dropBehaviors'
import { getSymbolById } from '@/lib/symbols'
import type { Circuit, Endpoint, Panel, Placement, ProtectionDevice } from '@/types/schema'
import type { Point, Selection } from '@/types/ui'
import type { TFunction } from 'i18next'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { useDialogStore } from '@/stores/dialogStore'
import { clamp } from '@/lib/geometry'

export type WireSegmentForDrop = {
  panelId?: string
  circuitId?: string
  type?: string
  startPoint: Point
  endPoint: Point
  domain?: string
}

export interface EendraadAltDragDuplicateDeps {
  project: DropBehaviorProject
  layoutTree: LayoutTree
  wireSegments: WireSegmentForDrop[]
  findDropTarget: (tree: LayoutTree, position: Point) => { target: DropTarget }
  t: TFunction
  addCircuit: (panelId: string, circuit: Circuit, protectionId?: string) => void
  addEndpoint: (circuitId: string, endpoint: Endpoint, insertAfterEndpointId?: string | null) => void
  addPlacement: (endpointId: string, placement: Placement) => void
  updateCircuit: (circuitId: string, updates: Partial<Circuit>) => void
  setSelection: (sel: Selection) => void
  getFloorById: (floorId: string) => { id: string; layers?: string[] } | null
  getProtectionById: (protectionId: string) => ProtectionDevice | null
}

function augmentDropTargetWithWireDomain(
  rawTarget: DropTarget,
  position: Point,
  wireSegments: WireSegmentForDrop[],
): DropTarget {
  let dropTarget = rawTarget
  if (
    rawTarget.type === 'circuit' &&
    rawTarget.circuitId &&
    rawTarget.panelId &&
    typeof rawTarget.circuitTrunkSegmentIndex !== 'number'
  ) {
    const panelWires = wireSegments.filter(
      (ws) => ws.panelId === rawTarget.panelId && ws.circuitId === rawTarget.circuitId,
    )
    const verticalCandidates = panelWires.filter(
      (ws) => ws.type === 'vertical' && ws.startPoint.x === ws.endPoint.x,
    )
    const hitVertical = verticalCandidates.find((ws) => {
      const x = ws.startPoint.x
      const minY = Math.min(ws.startPoint.y, ws.endPoint.y)
      const maxY = Math.max(ws.startPoint.y, ws.endPoint.y)
      const withinX = Math.abs(position.x - x) <= 15
      const withinY = position.y >= minY - 10 && position.y <= maxY + 10
      return withinX && withinY
    })
    if (hitVertical) {
      dropTarget = { ...rawTarget, wireDomain: hitVertical.domain as DropTarget['wireDomain'] }
    }
  }
  return dropTarget
}

/**
 * Duplicate an endpoint at the drop target (properties from source, new id/label/placements via drop rules).
 */
export function runEendraadEndpointAltDragDuplicate(
  sourceEndpointId: string,
  position: Point,
  deps: EendraadAltDragDuplicateDeps,
): boolean {
  const store = useProjectStore.getState()
  const sourceEndpoint = store.getEndpointById(sourceEndpointId)
  if (!sourceEndpoint?.symbol || !endpointSymbolCanBeDuplicated(sourceEndpoint)) return false

  const symbolMeta = getSymbolById(sourceEndpoint.symbol)
  if (!symbolMeta) return false

  const { target: rawTarget } = deps.findDropTarget(deps.layoutTree, position)
  if (!rawTarget || rawTarget.type === null) return false

  let dropTarget = augmentDropTargetWithWireDomain(rawTarget, position, deps.wireSegments)

  const targetEndpoint = dropTarget.endpointId
    ? store.getEndpointById(dropTarget.endpointId)
    : null
  if (
    sourceEndpoint.domoticaChildProps &&
    !dropTarget.domoticaOutput &&
    !targetEndpoint?.domoticaChildProps
  ) {
    const domoticaSlotTarget = findDomoticaOutputDropTarget(deps.layoutTree, position)
    if (domoticaSlotTarget?.domoticaOutput) {
      dropTarget = domoticaSlotTarget
    }
  }

  const createdEndpointIds: string[] = []
  let dropRejected = false

  executeDropBehavior(symbolMeta as Parameters<typeof executeDropBehavior>[0], dropTarget, deps.project, deps.t, {
    addPanel: store.addPanel,
    addProtection: store.addProtection,
    addCircuit: deps.addCircuit,
    addCircuitToProtection: store.addCircuitToProtection,
    addPlacement: deps.addPlacement,
    setSelection: deps.setSelection,
    getFloorById: deps.getFloorById,
    updateFloor: store.updateFloor,
    getCircuitById: (circuitId) => store.getCircuitById(circuitId) || null,
    getProtectionById: deps.getProtectionById,
    addTrunkDevice: store.addTrunkDevice,
    addSupplyTrunkDevice: store.addSupplyTrunkDevice,
    addGroundTrunkDevice: store.addGroundTrunkDevice,
    ensureJunctionPanelPlacementForLabel: store.ensureJunctionPanelPlacementForLabel,
    updateCircuit: deps.updateCircuit,
    updateProtection: store.updateProtection,
    updateInstallation: store.updateInstallation,
    addSupplyAssembly: store.addSupplyAssembly,
    replaceSupplyAssembly: store.replaceSupplyAssembly,
    moveCircuitOnMainBus: store.moveCircuitOnMainBus,
    moveCircuitToSecondaryBus: store.moveCircuitToSecondaryBus,
    deleteEndpoint: store.deleteEndpoint,
    addEendraadNote: store.addEendraadNote,
    addEndpoint: (circuitId, endpoint, insertAfterEndpointId) => {
      const latestSource = store.getEndpointById(sourceEndpointId) ?? sourceEndpoint
      const clonedSource = JSON.parse(JSON.stringify(latestSource)) as Endpoint
      const isDomoticaChildDrop = !!endpoint.domoticaChildProps
      const merged: Endpoint = {
        ...clonedSource,
        ...endpoint,
        placements: [],
        domoticaChildProps: endpoint.domoticaChildProps,
        id: endpoint.id,
      }
      if (!isDomoticaChildDrop) {
        delete (merged as { label?: string }).label
      }
      store.addEndpoint(circuitId, merged, insertAfterEndpointId)
      createdEndpointIds.push(merged.id)
      deps.setSelection({ type: 'endpoint', ids: [merged.id] })
    },
    onDropRejected: (message) => {
      dropRejected = true
      useDialogStore.getState().openDialog({
        type: 'info',
        title: deps.t('wires.domainMismatchTitle', { defaultValue: 'Cannot connect here' }),
        message,
        confirmLabel: deps.t('common.ok', { defaultValue: 'OK' }),
        variant: 'warning',
      })
    },
  }, {
    canvas: 'eendraad',
    placementMethod: 'alt_drag_duplicate',
  })

  if (dropRejected || createdEndpointIds.length === 0) return false

  const project = store.currentProject
  if (project) {
    const ui = useUIStore.getState()
    ensureSitplanPlacementsForEndpoints(
      project,
      createdEndpointIds,
      (id) => store.getEndpointById(id),
      (endpointId, placement) => store.addPlacement(endpointId, placement),
      {
        activeFloorId: ui.activeFloorId,
        viewportLayout: ui.viewportLayout,
        planCanvasViewportPx: ui.planCanvasViewportPx,
        planView: ui.planView,
      },
    )
  }

  return true
}

/** True when a protection drag would drop on / preview over its own row (invalid). */
export function protectionDropTargetHitsSource(
  sourceProtectionId: string,
  target: DropTarget | null | undefined,
  getProtectionById: (id: string) => ProtectionDevice | null | undefined,
): boolean {
  if (!target || !sourceProtectionId) return false
  if (target.protectionId === sourceProtectionId) return true

  // Main / secondary bus insertion targets carry a parent `circuitId` for the host
  // row — that must not be treated as "dropping on yourself".
  const isBusInsertionTarget =
    target.type === 'mainBus' ||
    (target.type === 'circuit' &&
      typeof target.secondaryBusInsertIndex === 'number' &&
      target.secondaryBusInsertIndex >= 0)
  if (isBusInsertionTarget) return false

  const source = getProtectionById(sourceProtectionId)
  if (!source) return false
  if (
    target.circuitId &&
    (source.circuits ?? []).some((circuit) => circuit.id === target.circuitId)
  ) {
    // The upper self-target is a supported topology rotation: local endpoint
    // content moves above this protection while the circuit remains nested.
    if (target.type === 'circuit' && target.insertAfterCircuitContent === true) return false
    return true
  }
  return false
}

/** Normalize protection hit / main-bus segment into a mainBus drop target (same as move-drag). */
export function resolveProtectionDropTargetForPosition(
  layoutTree: LayoutTree,
  position: Point,
  findDropTarget: (tree: LayoutTree, pos: Point) => { target: DropTarget },
  getPanelById: (panelId: string) => Panel | undefined,
  sourceProtectionId?: string,
  getProtectionById?: (id: string) => ProtectionDevice | null | undefined,
): DropTarget | null {
  let { target } = findDropTarget(layoutTree, position)
  if (!target?.panelId) return null

  const protectionId =
    target.type === 'protection' ? target.protectionId : (target as DropTarget).protectionId
  if (protectionId && target.panelId) {
    const panel = getPanelById(target.panelId)
    if (panel) {
      const mainBusItemsNorm = getMainBusItemsWithIndices(panel)
      const idx = mainBusItemsNorm.findIndex(
        (item) => item.type === 'protection' && item.id === protectionId,
      )
      if (idx >= 0) {
        target = {
          ...target,
          type: 'mainBus',
          panelId: target.panelId,
          mainBusInsertIndex: idx + 1,
        }
      }
    }
  }

  if (
    sourceProtectionId &&
    getProtectionById &&
    protectionDropTargetHitsSource(sourceProtectionId, target, getProtectionById)
  ) {
    return null
  }

  return target
}

/**
 * After duplicateProtectionLeft the new row starts at the end of the bus; move it to the
 * segment the user dropped on (same algorithm as library protection drops).
 */
export function repositionDuplicatedProtectionToDropTarget(
  newProtectionId: string,
  dropTarget: DropTarget,
  getPanelById: (panelId: string) => Panel | undefined,
  getProtectionById: (id: string) => ProtectionDevice | undefined,
  moveCircuitOnMainBus: (panelId: string, circuitId: string, direction: 'left' | 'right') => void,
  moveCircuitToSecondaryBus?: (
    panelId: string,
    parentCircuitId: string,
    circuitId: string,
    insertIndex: number,
  ) => void,
  options?: { skipMainBus?: boolean },
): void {
  if (
    !options?.skipMainBus &&
    dropTarget.type === 'mainBus' &&
    dropTarget.panelId &&
    typeof dropTarget.mainBusInsertIndex === 'number'
  ) {
    const panel = getPanelById(dropTarget.panelId)
    const protection = getProtectionById(newProtectionId)
    if (!panel || !protection) return

    const circuitId = pickRepresentativeCircuitIdForMainBusMove(panel, protection)
    if (!circuitId) return

    const order = getMainBusOrder(panel)
    const currentIndex = order.findIndex(
      (item) =>
        (item.type === 'protection' && item.id === newProtectionId) ||
        (item.type === 'circuit' && item.id === circuitId),
    )
    if (currentIndex < 0) return

    const beforeCount = dropTarget.mainBusItemCount ?? Math.max(0, order.length - 1)
    const totalAfter = beforeCount + 1
    const desiredIndex = clamp(dropTarget.mainBusInsertIndex, 0, totalAfter - 1)
    const movesLeft = Math.max(0, currentIndex - desiredIndex)
    for (let i = 0; i < movesLeft; i++) {
      moveCircuitOnMainBus(dropTarget.panelId, circuitId, 'left')
    }
    return
  }

  if (
    moveCircuitToSecondaryBus &&
    dropTarget.type === 'circuit' &&
    dropTarget.panelId &&
    dropTarget.circuitId &&
    typeof dropTarget.secondaryBusInsertIndex === 'number' &&
    dropTarget.secondaryBusInsertIndex >= 0
  ) {
    const panel = getPanelById(dropTarget.panelId)
    const protection = getProtectionById(newProtectionId)
    const newCircuitId =
      panel && protection ? pickRepresentativeCircuitIdForMainBusMove(panel, protection) : undefined
    if (newCircuitId) {
      moveCircuitToSecondaryBus(
        dropTarget.panelId,
        dropTarget.circuitId,
        newCircuitId,
        dropTarget.secondaryBusInsertIndex,
      )
    }
  }
}
