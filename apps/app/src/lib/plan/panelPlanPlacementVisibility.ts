import {
  getDefaultPanelGridModuleRefs,
  getAllCircuits,
  panelGridModuleIsVisibleByDefault,
  panelGridModuleRefKey,
} from '@/lib/eendraad/projectElectricalDomain'
import { walkPanels } from '@/lib/panel/panelTree'
import { getMutableCompatibilityFloorsForProject } from '@/lib/projectV2/buildingFloors'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { ProjectWithOptionalV2Building } from '@/lib/projectV2/buildingFloors'
import type { Endpoint, Placement, TrunkDevice } from '@/types/schema'
import type { Panel, PanelGridModuleRef } from '@/types/schema'

type PanelPlanVisibilityProject = ProjectWithOptionalV2Electrical & ProjectWithOptionalV2Building

type PlacementOwner = {
  placements: Placement[]
  visibleInAnyPanel: boolean
}

type PanelVisibilityIntent =
  | { kind: 'show'; panelId: string; moduleRefKey: string }
  | { kind: 'hide'; panelId: string; moduleRefKey: string }

type PanelModuleOccurrence = {
  panel: Panel
  ref: PanelGridModuleRef
  refKey: string
  visible: boolean
  explicitlyHidden: boolean
  explicitlyShown: boolean
}

function moduleOwnerKey(ref: PanelGridModuleRef): string {
  if (ref.kind === 'protection') return `protection:${ref.id}`
  if (ref.kind === 'trunkDevice') return `trunk:${ref.id}`
  return `endpoint:${ref.endpointId}`
}

function ensurePanelGridView(panel: Panel): NonNullable<Panel['gridView']> {
  panel.gridView ??= {
    rows: 8,
    columns: 12,
    feedFromTop: false,
    slots: [],
  }
  return panel.gridView
}

function collectPanelModuleOccurrences(
  project: PanelPlanVisibilityProject,
): Map<string, PanelModuleOccurrence[]> {
  const rootPanels = getElectricalPanelsFromProject(project)
  const installation = getElectricalInstallationFromProject(project)
  const groups = new Map<string, PanelModuleOccurrence[]>()

  for (const panel of walkPanels(rootPanels)) {
    const hiddenKeys = new Set(panel.gridView?.hiddenModuleKeys ?? [])
    const shownKeys = new Set(panel.gridView?.shownModuleKeys ?? [])
    for (const ref of getDefaultPanelGridModuleRefs(panel, installation, rootPanels)) {
      const refKey = panelGridModuleRefKey(ref)
      const occurrence: PanelModuleOccurrence = {
        panel,
        ref,
        refKey,
        explicitlyHidden: hiddenKeys.has(refKey),
        explicitlyShown: shownKeys.has(refKey),
        visible:
          !hiddenKeys.has(refKey) &&
          (panelGridModuleIsVisibleByDefault(ref, panel, installation, rootPanels) ||
            shownKeys.has(refKey)),
      }
      const key = moduleOwnerKey(ref)
      groups.set(key, [...(groups.get(key) ?? []), occurrence])
    }
  }
  return groups
}

/** Enforce that one physical module can appear in at most one distribution panel. */
function normalizeUniquePanelModuleVisibility(
  project: PanelPlanVisibilityProject,
  intent?: PanelVisibilityIntent,
): boolean {
  const groups = collectPanelModuleOccurrences(project)

  const intendedOccurrence = intent
    ? [...groups.values()].flat().find(
        (item) => item.panel.id === intent.panelId && item.refKey === intent.moduleRefKey,
      )
    : undefined
  const intendedOwnerKey = intendedOccurrence ? moduleOwnerKey(intendedOccurrence.ref) : undefined
  const hiddenPlanPlacementIds = new Set(
    getMutableCompatibilityFloorsForProject(project).flatMap(
      (floor) => floor.hiddenSitplanPlacementIds ?? [],
    ),
  )
  const planOwners = collectPanelPlanPlacementOwners(project)
  let changed = false

  const setHidden = (occurrence: PanelModuleOccurrence, hidden: boolean): void => {
    const grid = ensurePanelGridView(occurrence.panel)
    const hiddenKeys = grid.hiddenModuleKeys ?? []
    const shownKeys = grid.shownModuleKeys ?? []
    if (hidden) {
      if (!hiddenKeys.includes(occurrence.refKey)) {
        grid.hiddenModuleKeys = [...hiddenKeys, occurrence.refKey]
        changed = true
      }
      if (shownKeys.includes(occurrence.refKey)) {
        grid.shownModuleKeys = shownKeys.filter((key) => key !== occurrence.refKey)
        if (grid.shownModuleKeys.length === 0) grid.shownModuleKeys = undefined
        changed = true
      }
      return
    }
    if (hiddenKeys.includes(occurrence.refKey)) {
      grid.hiddenModuleKeys = hiddenKeys.filter((key) => key !== occurrence.refKey)
      if (grid.hiddenModuleKeys.length === 0) grid.hiddenModuleKeys = undefined
      changed = true
    }
  }

  for (const [ownerKey, occurrences] of groups) {
    const matchingIntent = ownerKey === intendedOwnerKey ? intent : undefined
    if (matchingIntent?.kind === 'hide') {
      for (const occurrence of occurrences) setHidden(occurrence, true)
      continue
    }

    let winner = matchingIntent?.kind === 'show'
      ? intendedOccurrence
      : occurrences.find((item) => item.explicitlyShown && item.visible) ??
        occurrences.find((item) => item.visible)
    const hiddenEverywhere =
      !winner &&
      occurrences.some((item) => item.explicitlyHidden) &&
      planOwners.get(ownerKey)?.placements.some((placement) =>
        hiddenPlanPlacementIds.has(placement.id),
      ) === true
    if (hiddenEverywhere) winner = occurrences[0]
    if (!winner) continue

    if (matchingIntent?.kind === 'show' || hiddenEverywhere) {
      const grid = ensurePanelGridView(winner.panel)
      const shownKeys = grid.shownModuleKeys ?? []
      if (!shownKeys.includes(winner.refKey)) {
        grid.shownModuleKeys = [...shownKeys, winner.refKey]
        changed = true
      }
    }

    for (const occurrence of occurrences) {
      setHidden(occurrence, occurrence !== winner)
    }
  }

  return changed
}

/** Move a plan-backed dual-view device into one panel, preferring the active panel when valid. */
export function showSituationPlanPlacementInPanel(
  project: PanelPlanVisibilityProject,
  placementId: string,
  preferredPanelId?: string | null,
): boolean {
  const ownerEntry = [...collectPanelPlanPlacementOwners(project).entries()].find(([, owner]) =>
    owner.placements.some((placement) => placement.id === placementId),
  )
  if (!ownerEntry) return false

  const occurrences = collectPanelModuleOccurrences(project).get(ownerEntry[0]) ?? []
  const target =
    occurrences.find((occurrence) => occurrence.panel.id === preferredPanelId) ?? occurrences[0]
  if (!target) return false

  return syncPanelAndSituationPlanDeviceVisibility(project, {
    kind: 'show',
    panelId: target.panel.id,
    moduleRefKey: target.refKey,
  })
}

/** Move a dual-view device out of every panel so its existing plan placement is shown. */
export function showSituationPlanPlacementOnPlan(
  project: PanelPlanVisibilityProject,
  placementId: string,
): boolean {
  const ownerEntry = [...collectPanelPlanPlacementOwners(project).entries()].find(([, owner]) =>
    owner.placements.some((placement) => placement.id === placementId),
  )
  if (!ownerEntry) return false
  const occurrence = collectPanelModuleOccurrences(project).get(ownerEntry[0])?.[0]
  if (!occurrence) return false
  return syncPanelAndSituationPlanDeviceVisibility(project, {
    kind: 'hide',
    panelId: occurrence.panel.id,
    moduleRefKey: occurrence.refKey,
  })
}

/**
 * Keep physical device visibility mutually exclusive between the distribution-panel view and
 * the situation plan. A device shown in any panel hides all of its plan placements; hiding it
 * from every panel reveals those existing placements again.
 */
function collectPanelPlanPlacementOwners(
  project: PanelPlanVisibilityProject
): Map<string, PlacementOwner> {
  const rootPanels = getElectricalPanelsFromProject(project)
  const installation = getElectricalInstallationFromProject(project)
  const endpointsById = new Map<string, Endpoint>()
  const trunkDevicesById = new Map<string, TrunkDevice>()

  for (const device of installation?.mainSupply?.supplyTrunkDevices ?? []) {
    trunkDevicesById.set(device.id, device)
  }
  for (const device of installation?.groundTrunkDevices ?? []) {
    trunkDevicesById.set(device.id, device)
  }
  for (const panel of walkPanels(rootPanels)) {
    for (const circuit of getAllCircuits(panel)) {
      for (const endpoint of circuit.endpoints ?? []) endpointsById.set(endpoint.id, endpoint)
      for (const device of circuit.trunkDevices ?? []) trunkDevicesById.set(device.id, device)
    }
  }

  const owners = new Map<string, PlacementOwner>()
  for (const panel of walkPanels(rootPanels)) {
    const hiddenKeys = new Set(panel.gridView?.hiddenModuleKeys ?? [])
    const shownKeys = new Set(panel.gridView?.shownModuleKeys ?? [])
    for (const ref of getDefaultPanelGridModuleRefs(panel, installation, rootPanels)) {
      const key = panelGridModuleRefKey(ref)
      const visible =
        !hiddenKeys.has(key) &&
        (panelGridModuleIsVisibleByDefault(ref, panel, installation, rootPanels) ||
          shownKeys.has(key))
      const owner =
        ref.kind === 'domotica'
          ? endpointsById.get(ref.endpointId)
          : ref.kind === 'trunkDevice'
            ? trunkDevicesById.get(ref.id)
            : undefined

      // ProtectionDevice has no situation-plan placement model. Protection-style trunk
      // devices (including rotating switches on a supply wire) are handled above.
      if (!owner?.placements?.length) continue
      if (
        (ref.kind === 'domotica' && owner.symbol === 'energy_meter') ||
        (ref.kind === 'trunkDevice' && owner.type === 'energy_meter')
      ) continue

      const ownerKey = ref.kind === 'domotica' ? `endpoint:${owner.id}` : `trunk:${owner.id}`
      const existing = owners.get(ownerKey)
      if (existing) {
        existing.visibleInAnyPanel ||= visible
      } else {
        owners.set(ownerKey, { placements: owner.placements, visibleInAnyPanel: visible })
      }
    }
  }

  return owners
}

/** Placement ids intentionally hidden because their device is currently shown in a panel. */
export function getSituationPlanPlacementIdsHiddenByPanel(
  project: PanelPlanVisibilityProject
): Set<string> {
  const hidden = new Set<string>()
  for (const owner of collectPanelPlanPlacementOwners(project).values()) {
    if (!owner.visibleInAnyPanel) continue
    for (const placement of owner.placements) hidden.add(placement.id)
  }
  return hidden
}

export function syncPanelAndSituationPlanDeviceVisibility(
  project: PanelPlanVisibilityProject,
  intent?: PanelVisibilityIntent,
): boolean {
  const normalizedPanels = normalizeUniquePanelModuleVisibility(project, intent)
  const owners = collectPanelPlanPlacementOwners(project)
  if (owners.size === 0) return normalizedPanels

  const floors = getMutableCompatibilityFloorsForProject(project)
  const placementIds = new Set(
    [...owners.values()].flatMap((owner) => owner.placements.map((placement) => placement.id))
  )
  const desiredHiddenByFloor = new Map<string, Set<string>>()
  for (const owner of owners.values()) {
    if (!owner.visibleInAnyPanel) continue
    for (const placement of owner.placements) {
      const desired = desiredHiddenByFloor.get(placement.floorId) ?? new Set<string>()
      desired.add(placement.id)
      desiredHiddenByFloor.set(placement.floorId, desired)
    }
  }

  let changed = false
  for (const floor of floors) {
    const previous = floor.hiddenSitplanPlacementIds ?? []
    const desired = desiredHiddenByFloor.get(floor.id) ?? new Set<string>()
    const next = previous.filter((id) => !placementIds.has(id) || desired.has(id))
    for (const id of desired) {
      if (!next.includes(id)) next.push(id)
    }
    if (next.length === previous.length && next.every((id, index) => id === previous[index])) {
      continue
    }
    floor.hiddenSitplanPlacementIds = next.length > 0 ? next : undefined
    changed = true
  }

  return changed || normalizedPanels
}
