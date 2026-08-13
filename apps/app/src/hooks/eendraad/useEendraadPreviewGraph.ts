import { useMemo } from 'react'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useUIStore, type UIState } from '@/stores/uiStore'
import { calculateBottomUpLayout, type BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import { buildLayoutTree, type LayoutTree } from '@/lib/layout/layoutTree'
import { deriveWires } from '@/lib/layout/deriveWires'
import { resolveSupplyDeviceMounting } from '@/lib/panel/auxiliarySupplyEnclosures'
import {
  simulatePanelAttachmentMoveOnProject,
  simulateDropOnProject,
  simulateEndpointSelectionMoveOnProject,
  simulateSupplyTrunkDeviceRelocationOnProject,
  simulateTrunkDeviceRelocationOnProject,
  type EendraadPreviewChangeSet,
} from '@/lib/layout/eendraadPreviewSimulation'
import type { WireSegment, Endpoint, ProtectionDevice, TrunkDevice, Panel } from '@/types/schema'
import type { DragPreviewState } from './useEendraadDragPreview'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  getSupplyAssembliesFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

export interface EendraadPreviewGraph {
  layout: BottomUpLayoutResult
  layoutTree: LayoutTree
  wireSegments: WireSegment[]
  /** Simulated project after applying the hypothetical drop. */
  project: ProjectWithOptionalV2Electrical
  /** Lookup tables for preview symbols. */
  endpointsById: Map<string, Endpoint>
  protectionsById: Map<string, ProtectionDevice>
  trunkDevicesById: Map<string, TrunkDevice>
  /** IDs of panels whose layout changed. */
  affectedPanelIds: string[]
  /** Circuits that changed (new or structurally updated). */
  affectedCircuitIds: string[]
  /** Endpoints created by this preview. */
  createdEndpointIds: string[]
  /** Protections created by this preview. */
  createdProtectionIds: string[]
  /** Trunk devices created by this preview. */
  createdTrunkDeviceIds: string[]
}

/**
 * Compute a full layout+wire preview graph for the current drag preview,
 * using a simulated project that includes the hypothetical drop.
 */
export function useEendraadPreviewGraph(
  dragPreview: DragPreviewState | null,
): EendraadPreviewGraph | null {
  const currentProject = useProjectStore((s: ProjectState) => s.currentProject)
  const eendraadLayoutOverrides = useUIStore((s: UIState) => s.eendraadLayoutOverrides)

  return useMemo(() => {
    if (!currentProject || !dragPreview || !dragPreview.symbolData) return null

    let sim: EendraadPreviewChangeSet | null = null
    if (dragPreview.movingPanelAttachment) {
      sim = simulatePanelAttachmentMoveOnProject(
        currentProject,
        dragPreview.movingPanelAttachment,
        dragPreview.dropTarget ?? { type: null },
      )
    } else if (dragPreview.movingEndpointSelection) {
      sim = simulateEndpointSelectionMoveOnProject(
        currentProject,
        dragPreview.movingEndpointSelection,
        dragPreview.dropTarget ?? { type: null },
      )
    } else if (dragPreview.relocatingSupplyTrunkDevice) {
      sim = simulateSupplyTrunkDeviceRelocationOnProject(
        currentProject,
        dragPreview.relocatingSupplyTrunkDevice,
        dragPreview.dropTarget ?? { type: null },
      )
    } else if (dragPreview.relocatingTrunkDevice) {
      sim = simulateTrunkDeviceRelocationOnProject(
        currentProject,
        dragPreview.relocatingTrunkDevice,
        dragPreview.symbolData,
        dragPreview.dropTarget ?? { type: null },
      )
    } else {
      sim = simulateDropOnProject(
        currentProject,
        dragPreview.symbolData,
        dragPreview.dropTarget ?? { type: null },
      )
    }
    if (!sim) return null

    // Convert overrides Map<string, PointLike> from uiStore to a plain Map for the layout engine.
    const overrides = new Map<string, { x: number; y: number }>()
    eendraadLayoutOverrides.forEach((value, key) => {
      overrides.set(key, value)
    })

    const layout = calculateBottomUpLayout(sim.project, overrides)
    if (!layout) return null

    const layoutTree = buildLayoutTree(layout)
    const wireSegments = deriveWires(
      layoutTree,
      getElectricalPanelsFromProject(sim.project),
      getElectricalInstallationFromProject(sim.project),
      getSupplyAssembliesFromProject(sim.project),
      (deviceId) => resolveSupplyDeviceMounting(sim.project, deviceId),
    )

    // Build lookup maps for preview symbols
    const endpointsById = new Map<string, Endpoint>()
    const protectionsById = new Map<string, ProtectionDevice>()
    const trunkDevicesById = new Map<string, TrunkDevice>()

    const panelStack: Panel[] = [...getElectricalPanelsFromProject(sim.project)]
    while (panelStack.length) {
      const panel = panelStack.pop()!

      panel.circuits.forEach((circuit) => {
        circuit.endpoints.forEach((ep) => endpointsById.set(ep.id, ep))
        circuit.trunkDevices?.forEach((td) => trunkDevicesById.set(td.id, td))
      })

      panel.protections?.forEach((prot) => {
        protectionsById.set(prot.id, prot)
        prot.circuits?.forEach((circuit) => {
          circuit.endpoints.forEach((ep) => endpointsById.set(ep.id, ep))
          circuit.trunkDevices?.forEach((td) => trunkDevicesById.set(td.id, td))
        })
      })

      if (panel.subPanels?.length) {
        panelStack.push(...panel.subPanels)
      }
    }

    // Include supply and ground trunk devices in lookup so preview can
    // highlight them when added on supply/ground wires.
    const installation = getElectricalInstallationFromProject(sim.project)
    if (installation?.mainSupply?.supplyTrunkDevices) {
      installation.mainSupply.supplyTrunkDevices.forEach((d) => {
        trunkDevicesById.set(d.id, d)
      })
    }
    if (installation?.groundTrunkDevices) {
      installation.groundTrunkDevices.forEach((d) => {
        trunkDevicesById.set(d.id, d)
      })
    }

    return {
      layout,
      layoutTree,
      wireSegments,
      project: sim.project,
      endpointsById,
      protectionsById,
      trunkDevicesById,
      affectedPanelIds: Array.from(new Set(sim.affectedPanelIds)),
      affectedCircuitIds: Array.from(new Set(sim.affectedCircuitIds)),
      createdEndpointIds: Array.from(new Set(sim.createdEndpointIds)),
      createdProtectionIds: Array.from(new Set(sim.createdProtectionIds)),
      createdTrunkDeviceIds: Array.from(
        new Set([...sim.createdTrunkDeviceIds, ...sim.movedTrunkDeviceIds]),
      ),
    }
  }, [currentProject, dragPreview, eendraadLayoutOverrides])
}
