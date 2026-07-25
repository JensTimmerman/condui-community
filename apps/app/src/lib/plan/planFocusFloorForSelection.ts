import type { Circuit, Endpoint, Floor, Panel, Placement, TrunkDevice } from '@/types/schema'
import type { Selection } from '@/types/ui'
import {
  getSitplanNotesFromProject,
  type ProjectWithOptionalV2Annotations,
} from '@/lib/projectV2/annotations'
import {
  getBuildingFloorsFromProject,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { collectCircuits, findPanelById, findPanelByName, walkPanels } from '@/lib/panel/panelTree'

type PlanFocusProject = ProjectWithOptionalV2Building &
  ProjectWithOptionalV2Electrical &
  ProjectWithOptionalV2Annotations

function orderedFloorsForEndpoint(ep: Endpoint): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of ep.placements ?? []) {
    if (!seen.has(p.floorId)) {
      seen.add(p.floorId)
      out.push(p.floorId)
    }
  }
  return out
}

function orderedFloorsForEndpointId(project: PlanFocusProject, endpointId: string): string[] {
  const found = findCircuitForEndpointInProject(project, endpointId)
  if (!found) return []
  const ep = found.circuit.endpoints.find((e) => e.id === endpointId)
  if (!ep) return []
  return orderedFloorsForEndpoint(ep)
}

const collectPanelTreeCircuits = (panel: Panel): Circuit[] =>
  [...walkPanels([panel])].flatMap((currentPanel) => collectCircuits(currentPanel))

function findCircuitForEndpointInProject(
  project: PlanFocusProject,
  endpointId: string
): { circuit: Circuit; panel: Panel } | undefined {
  for (const panel of getElectricalPanelsFromProject(project)) {
    for (const circuit of collectPanelTreeCircuits(panel)) {
      if (circuit.endpoints.some((endpoint) => endpoint.id === endpointId)) {
        return { circuit, panel }
      }
    }
  }
  return undefined
}

function collectPlacementsOnFloorFromProject(
  project: PlanFocusProject,
  floorId: string
): Array<Placement & { endpointId?: string; junctionPanelLabel?: string; isEarthing?: boolean }> {
  const result: Array<
    Placement & { endpointId?: string; junctionPanelLabel?: string; isEarthing?: boolean }
  > = []
  const installation = getElectricalInstallationFromProject(project)

  for (const panel of getElectricalPanelsFromProject(project)) {
    for (const circuit of collectPanelTreeCircuits(panel)) {
      for (const endpoint of circuit.endpoints) {
        for (const placement of endpoint.placements) {
          if (placement.floorId === floorId) result.push({ ...placement, endpointId: endpoint.id })
        }
      }
    }
  }

  for (const jp of installation?.junctionPanelPlacements ?? []) {
    if (jp.floorId === floorId) {
      result.push({
        id: jp.id,
        floorId: jp.floorId,
        layer: jp.layer ?? 'default',
        pos: jp.pos,
        rotationDeg: (jp.rotationDeg ?? 0) as Placement['rotationDeg'],
        scale: jp.scale ?? 1,
        junctionPanelLabel: jp.label,
      })
    }
  }

  for (const ep of installation?.earthingPlacements ?? []) {
    if (ep.floorId === floorId) {
      result.push({
        id: ep.id,
        floorId: ep.floorId,
        layer: ep.layer ?? 'default',
        pos: ep.pos,
        rotationDeg: (ep.rotationDeg ?? 0) as Placement['rotationDeg'],
        scale: ep.scale ?? 1,
        locked: ep.locked,
        isEarthing: true,
      })
    }
  }

  return result
}

function floorForPlacementId(project: PlanFocusProject, placementId: string): string[] {
  for (const floor of getBuildingFloorsFromProject(project)) {
    const rows = collectPlacementsOnFloorFromProject(project, floor.id)
    if (rows.some((r) => r.id === placementId)) return [floor.id]
  }
  return []
}

function resolvePanelForDistributionEndpoint(
  project: PlanFocusProject,
  endpoint: Pick<Endpoint, 'symbol' | 'label' | 'panelId'>
): Panel | null {
  if (endpoint.symbol !== 'panel_distribution') return null
  const panels = getElectricalPanelsFromProject(project)
  if (endpoint.panelId) {
    const byId = findPanelById(panels, endpoint.panelId)
    if (byId) return byId
  }
  return endpoint.label ? findPanelByName(panels, endpoint.label) ?? null : null
}

function orderedFloorsForPanelId(project: PlanFocusProject, panelId: string): string[] {
  for (const root of getElectricalPanelsFromProject(project)) {
    for (const c of collectPanelTreeCircuits(root)) {
      for (const ep of c.endpoints) {
        if (ep.symbol !== 'panel_distribution') continue
        const pan = resolvePanelForDistributionEndpoint(project, ep)
        if (pan?.id === panelId) return orderedFloorsForEndpoint(ep)
      }
    }
  }
  return []
}

function floorsForTrunkDevice(
  project: PlanFocusProject,
  deviceId: string,
  getTrunkDeviceById: (id: string) => { device: TrunkDevice } | undefined,
): string[] {
  const r = getTrunkDeviceById(deviceId)
  if (!r?.device || r.device.type !== 'junction_panel' || !r.device.label) return []
  const label = r.device.label
  const seen = new Set<string>()
  const out: string[] = []
  for (const jp of getElectricalInstallationFromProject(project)?.junctionPanelPlacements ?? []) {
    if (jp.label === label && !seen.has(jp.floorId)) {
      seen.add(jp.floorId)
      out.push(jp.floorId)
    }
  }
  return out
}

function floorForSitplanNote(project: PlanFocusProject, noteId: string): string[] {
  const n = getSitplanNotesFromProject(project).find((x) => x.id === noteId)
  if (!n?.floorId) return []
  return [n.floorId]
}

function isLegacyFloorWithPlan(floor: Floor | { id: string; name: string }): floor is Floor {
  return 'floorPlan' in floor
}

function floorForWall(project: PlanFocusProject, wallId: string): string[] {
  for (const f of getBuildingFloorsFromProject(project)) {
    if (!isLegacyFloorWithPlan(f)) continue
    if (f.floorPlan?.walls?.some((w) => w.id === wallId)) return [f.id]
  }
  return []
}

function floorForDoor(project: PlanFocusProject, doorId: string): string[] {
  for (const f of getBuildingFloorsFromProject(project)) {
    if (!isLegacyFloorWithPlan(f)) continue
    if (f.floorPlan?.doors?.some((d) => d.id === doorId)) return [f.id]
  }
  return []
}

function floorForWindow(project: PlanFocusProject, windowId: string): string[] {
  for (const f of getBuildingFloorsFromProject(project)) {
    if (!isLegacyFloorWithPlan(f)) continue
    if (f.floorPlan?.windows?.some((w) => w.id === windowId)) return [f.id]
  }
  return []
}

function floorForStair(project: PlanFocusProject, stairId: string): string[] {
  for (const f of getBuildingFloorsFromProject(project)) {
    if (!isLegacyFloorWithPlan(f)) continue
    if (f.floorPlan?.stairs?.some((s) => s.id === stairId)) return [f.id]
  }
  return []
}

/**
 * Map selection to logical ids for sitplan floor lookup (stairPoint uses stair id only).
 */
function planFloorSelectionItems(selection: Selection): Array<{ type: NonNullable<Selection['type']>; id: string }> {
  if (!selection.type || selection.ids.length === 0) return []
  const selectionType = selection.type
  if (selectionType === 'stairPoint') {
    const stairId = selection.ids[0]
    return stairId ? [{ type: 'stair', id: stairId }] : []
  }
  return selection.ids.filter(Boolean).map((id) => ({ type: selectionType, id: id! }))
}

function floorsForSelectionId(
  project: PlanFocusProject,
  type: NonNullable<Selection['type']>,
  id: string,
  getTrunkDeviceById: (id: string) => { device: TrunkDevice } | undefined,
): string[] {
  switch (type) {
    case 'endpoint':
      return orderedFloorsForEndpointId(project, id)
    case 'placement':
      return floorForPlacementId(project, id)
    case 'panel':
    case 'supplyPanel':
      return orderedFloorsForPanelId(project, id)
    case 'trunkDevice':
      return floorsForTrunkDevice(project, id, getTrunkDeviceById)
    case 'note':
      return floorForSitplanNote(project, id)
    case 'wall':
      return floorForWall(project, id)
    case 'wallPoint': {
      const parts = id.split('|')
      if (parts.length === 3 && parts[0] === 'v' && parts[1]) return floorForWall(project, parts[1])
      if (parts.length === 3 && parts[0] === 's' && parts[1]) return floorForStair(project, parts[1])
      return []
    }
    case 'door':
      return floorForDoor(project, id)
    case 'window':
      return floorForWindow(project, id)
    case 'stair':
      return floorForStair(project, id)
    case 'ground':
      if (id !== 'ground') return []
      return (getElectricalInstallationFromProject(project)?.earthingPlacements ?? []).map(
        (p) => p.floorId
      )
    default:
      return []
  }
}

/**
 * If the plan canvas is showing a floor where none of the selected plan entities live,
 * returns a floor id to switch to before fit-to-view (F). Preserves the current floor when
 * any selected entity is already on that floor. When switching, uses the first selection id
 * that has a plan location, and that id's first floor in placement order.
 */
export function pickPlanFloorForSelectionFit(
  project: PlanFocusProject,
  selection: Selection,
  activeFloorId: string | null,
  getTrunkDeviceById: (id: string) => { device: TrunkDevice } | undefined,
): string | null {
  if (!selection.type || selection.ids.length === 0) return null

  const items = planFloorSelectionItems(selection)
  if (items.length === 0) return null

  const floorsUnion = new Set<string>()
  for (const { type, id } of items) {
    for (const f of floorsForSelectionId(project, type, id, getTrunkDeviceById)) {
      floorsUnion.add(f)
    }
  }
  if (floorsUnion.size === 0) return null
  if (activeFloorId && floorsUnion.has(activeFloorId)) return null

  for (const { type, id } of items) {
    const fs = floorsForSelectionId(project, type, id, getTrunkDeviceById)
    if (fs.length > 0) return fs[0]!
  }
  return null
}
