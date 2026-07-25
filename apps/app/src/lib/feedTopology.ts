import type {
  CableSpec,
  FeedTopology,
  Installation,
  Panel,
  RootPanelFeedPath,
  SharedFeedPath,
  TrunkDevice,
} from '@/types/schema'
import { generateId } from '@/utils'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

export type SupplyFeedScope = 'shared' | 'root'

export function collectRootPanels(panels: Panel[]): Panel[] {
  return panels.filter((panel) => panel.isMain !== false)
}

function normalizeTrunkDevicePositions(devices: TrunkDevice[] | undefined): TrunkDevice[] {
  if (!devices) return []
  let changed = false
  const normalized = devices.map((device, index) => {
    if ((device.trunkPosition ?? 0) === index) return device
    changed = true
    return {
      ...device,
      trunkPosition: index,
    }
  })
  return changed ? normalized : devices
}

function cablesEqual(a: CableSpec | undefined, b: CableSpec | undefined): boolean {
  if (!a || !b) return false
  return (
    a.kind === b.kind &&
    a.conductors === b.conductors &&
    a.sectionMm2 === b.sectionMm2 &&
    (a.hasPE ?? false) === (b.hasPE ?? false) &&
    (a.notes ?? '') === (b.notes ?? '')
  )
}

function buildSharedFeedFromLegacyMainSupply(installation: Installation, connectorId: string): SharedFeedPath {
  const mainSupply = installation.mainSupply
  const trunkDevices = normalizeTrunkDevicePositions(mainSupply.supplyTrunkDevices)
  return {
    id: `shared-feed-${connectorId}`,
    kind: 'shared',
    connectorId,
    cable: mainSupply.cable,
    origin: mainSupply.origin,
    hideWireLabel: mainSupply.hideWireLabel,
    trunkDevices: [...trunkDevices],
    segmentCables: [...(mainSupply.supplyTrunkSegmentCables ?? [])]
      .filter((entry) => entry.panelId === '*')
      .map((entry) => ({
        segmentIndex: entry.segmentIndex,
        cable: entry.cable,
      })),
  }
}

/** `cable` omitted for single-main projects (use `installation.mainSupply.cable`). */
function buildRootFeed(panelId: string, connectorId: string, cable?: CableSpec): RootPanelFeedPath {
  const feed: RootPanelFeedPath = {
    id: `root-feed-${panelId}`,
    kind: 'root_panel',
    connectorId,
    panelId,
    trunkDevices: [],
    segmentCables: [],
  }
  if (cable !== undefined) {
    feed.cable = cable
  }
  return feed
}

/** Cable onto the main panel bus: SSOT is `mainSupply` when there is only one main panel. */
function resolvePanelIncomingSupplyCable(
  installation: Installation,
  panels: Panel[],
  rootFeed: RootPanelFeedPath | null,
  sharedFeed: SharedFeedPath,
): CableSpec {
  if (collectRootPanels(panels).length === 1) {
    return installation.mainSupply.cable
  }
  return rootFeed?.cable ?? sharedFeed.cable ?? installation.mainSupply.cable
}

export function ensureInstallationFeedTopology(installation: Installation, panels: Panel[]): FeedTopology {
  const rootPanels = collectRootPanels(panels)
  /** One main panel: mainSupply is the UI/schema source for the incoming supply cable. */
  const soleRootPanelId = rootPanels.length === 1 ? rootPanels[0]!.id : null
  const existing = installation.feedTopology
  const mainSupply = installation.mainSupply
  const liveSharedDevices = normalizeTrunkDevicePositions(mainSupply.supplyTrunkDevices)
  if (liveSharedDevices !== mainSupply.supplyTrunkDevices) {
    try {
      mainSupply.supplyTrunkDevices = liveSharedDevices
    } catch {
      // Read-only snapshots can call this during render; derived topology still returned.
    }
  }
  if (existing) {
    const rootFeeds = existing.rootFeeds.map((feed) => {
      const trunkDevices = normalizeTrunkDevicePositions(feed.trunkDevices)
      let nextFeed: RootPanelFeedPath = trunkDevices === feed.trunkDevices
        ? feed
        : {
            ...feed,
            trunkDevices,
          }
      // Single main panel: never persist root-feed cable (avoids drift vs mainSupply).
      if (soleRootPanelId !== null && feed.panelId === soleRootPanelId) {
        nextFeed = { ...nextFeed }
        delete nextFeed.cable
      } else if (cablesEqual(feed.cable, existing.sharedFeed.cable)) {
        // Root feeds that still match the previous shared cable are effectively inherited.
        // Keep them in sync when the main-supply cable changes through imports or UI edits.
        nextFeed = {
          ...nextFeed,
          cable: mainSupply.cable,
        }
      }
      return nextFeed
    })
    for (const panel of rootPanels) {
      if (!rootFeeds.some((feed) => feed.panelId === panel.id)) {
        rootFeeds.push(
          buildRootFeed(
            panel.id,
            existing.rootConnector.id,
            soleRootPanelId !== null ? undefined : mainSupply.cable,
          ),
        )
      }
    }
    const topology: FeedTopology = {
      ...existing,
      sharedFeed: {
        ...existing.sharedFeed,
        cable: mainSupply.cable,
        origin: mainSupply.origin,
        hideWireLabel: mainSupply.hideWireLabel,
        trunkDevices: [...liveSharedDevices],
        segmentCables: [...(mainSupply.supplyTrunkSegmentCables ?? [])]
          .filter((entry) => entry.panelId === '*')
          .map((entry) => ({
            segmentIndex: entry.segmentIndex,
            cable: entry.cable,
          })),
      },
      rootFeeds,
    }
    try {
      installation.feedTopology = topology
    } catch {
      // Read-only snapshots can call this during render; derived topology still returned.
    }
    return topology
  }

  const connectorId = generateId()
  const topology: FeedTopology = {
    version: 1,
    rootConnector: {
      id: connectorId,
      kind: 'connector',
      role: 'root_split',
    },
    sharedFeed: buildSharedFeedFromLegacyMainSupply(installation, connectorId),
    rootFeeds: rootPanels.map((panel) =>
      buildRootFeed(
        panel.id,
        connectorId,
        rootPanels.length === 1 ? undefined : installation.mainSupply.cable,
      ),
    ),
  }
  try {
    installation.feedTopology = topology
  } catch {
    // Read-only snapshots can call this during render; derived topology still returned.
  }
  return topology
}

export interface PanelFeedProjection {
  sharedFeed: SharedFeedPath
  rootFeed: RootPanelFeedPath | null
  devices: TrunkDevice[]
  sharedDeviceCount: number
  cable: CableSpec
  hideWireLabel: boolean
}

export function getPanelFeedProjection(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
): PanelFeedProjection | null {
  if (panel.isMain !== true) return null
  const topology = ensureInstallationFeedTopology(installation, panels)
  const sharedFeed = topology.sharedFeed
  const rootFeed = topology.rootFeeds.find((feed) => feed.panelId === panel.id) ?? null
  const sharedDevices = sharedFeed.trunkDevices ?? []
  const rootDevices = rootFeed?.trunkDevices ?? []

  return {
    sharedFeed,
    rootFeed,
    devices: [...sharedDevices, ...rootDevices],
    sharedDeviceCount: sharedDevices.length,
    cable: resolvePanelIncomingSupplyCable(installation, panels, rootFeed, sharedFeed),
    hideWireLabel:
      rootFeed?.hideWireLabel ??
      sharedFeed.hideWireLabel ??
      installation.mainSupply.hideWireLabel ??
      true,
  }
}

export function getPanelSupplyTrunkDevices(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
): TrunkDevice[] {
  return getPanelFeedProjection(installation, panels, panel)?.devices ?? []
}

export function getSupplyFeedDevicesForPanel(
  installation: Installation,
  panels: Panel[],
  panelId: string,
  scope: SupplyFeedScope = 'shared',
): TrunkDevice[] {
  const topology = ensureInstallationFeedTopology(installation, panels)
  if (scope === 'shared') {
    return topology.sharedFeed.trunkDevices ?? []
  }
  return topology.rootFeeds.find((feed) => feed.panelId === panelId)?.trunkDevices ?? []
}

export function getPanelSupplyCable(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
): CableSpec {
  return (
    getPanelFeedProjection(installation, panels, panel)?.cable ??
    installation.mainSupply.cable
  )
}

export type SupplyWireRole = 'upstream' | 'crossing' | 'downstream'

/** Resolved hide flag for supply wire segments (`true` = hidden; default hidden until user shows). */
export function getSupplyWireHideWireLabelForRole(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
): boolean {
  const mainSupply = installation.mainSupply
  if (role === 'upstream') {
    return mainSupply.hideWireLabelUpstream ?? true
  }
  if (role === 'crossing') {
    return mainSupply.hideWireLabelCrossing ?? true
  }
  const soleMain = collectRootPanels(panels).length === 1
  if (!soleMain) {
    const projection = getPanelFeedProjection(installation, panels, panel)
    if (projection?.rootFeed?.hideWireLabel !== undefined) {
      return projection.rootFeed.hideWireLabel
    }
  }
  if (mainSupply.hideWireLabelDownstream !== undefined) {
    return mainSupply.hideWireLabelDownstream
  }
  return mainSupply.hideWireLabel ?? true
}

export function isSupplyWireLabelVisibleForRole(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
): boolean {
  return getSupplyWireHideWireLabelForRole(installation, panels, panel, role) === false
}

export function getSupplyWireShowFireClassLabelForRole(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
): boolean | undefined {
  const mainSupply = installation.mainSupply
  if (role === 'upstream') {
    return mainSupply.showFireClassLabelUpstream
  }
  if (role === 'crossing') {
    return mainSupply.showFireClassLabelCrossing
  }
  const soleMain = collectRootPanels(panels).length === 1
  if (!soleMain) {
    const projection = getPanelFeedProjection(installation, panels, panel)
    if (projection?.rootFeed?.showFireClassLabel !== undefined) {
      return projection.rootFeed.showFireClassLabel
    }
  }
  return mainSupply.showFireClassLabelDownstream
}

export function isSupplyWireFireClassLabelVisibleForRole(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
): boolean {
  return getSupplyWireShowFireClassLabelForRole(installation, panels, panel, role) === true
}

export function buildSupplyWireFireClassVisibilityUpdate(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
  visible: boolean,
): Partial<Installation> {
  const mainSupply = installation.mainSupply
  const soleMain = collectRootPanels(panels).length === 1
  const hideKey =
    role === 'upstream'
      ? 'hideWireLabelUpstream'
      : role === 'crossing'
        ? 'hideWireLabelCrossing'
        : 'hideWireLabelDownstream'
  const showFireKey =
    role === 'upstream'
      ? 'showFireClassLabelUpstream'
      : role === 'crossing'
        ? 'showFireClassLabelCrossing'
        : 'showFireClassLabelDownstream'

  if (role === 'downstream' && !soleMain) {
    const topology = ensureInstallationFeedTopology(installation, panels)
    return {
      feedTopology: {
        ...topology,
        rootFeeds: topology.rootFeeds.map((feed) =>
          feed.panelId === panel.id
            ? {
                ...feed,
                showFireClassLabel: visible,
                ...(visible ? { hideWireLabel: false } : {}),
              }
            : feed,
        ),
      },
    }
  }

  return {
    mainSupply: {
      ...mainSupply,
      [showFireKey]: visible,
      ...(visible
        ? {
            [hideKey]: false,
            ...(role === 'downstream' ? { hideWireLabel: false } : {}),
          }
        : {}),
    },
  }
}

export function buildSupplyWireLabelVisibilityUpdate(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
  visible: boolean,
): Partial<Installation> {
  const hide = visible ? false : true
  const mainSupply = installation.mainSupply
  const soleMain = collectRootPanels(panels).length === 1

  if (role === 'downstream' && !soleMain) {
    const topology = ensureInstallationFeedTopology(installation, panels)
    return {
      feedTopology: {
        ...topology,
        rootFeeds: topology.rootFeeds.map((feed) =>
          feed.panelId === panel.id ? { ...feed, hideWireLabel: hide } : feed,
        ),
      },
    }
  }

  const roleKey =
    role === 'upstream'
      ? 'hideWireLabelUpstream'
      : role === 'crossing'
        ? 'hideWireLabelCrossing'
        : 'hideWireLabelDownstream'

  return {
    mainSupply: {
      ...mainSupply,
      [roleKey]: hide,
      ...(role === 'downstream' ? { hideWireLabel: hide } : {}),
    },
  }
}

export function getPanelSupplyHideWireLabel(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
): boolean {
  return getSupplyWireHideWireLabelForRole(installation, panels, panel, 'downstream')
}

export function getPanelSupplySegmentCable(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  segmentIndex: number,
): CableSpec | null {
  const projection = getPanelFeedProjection(installation, panels, panel)
  if (!projection || segmentIndex < 1) return null

  const sharedOverrides = projection.sharedFeed.segmentCables ?? []
  const rootOverrides = projection.rootFeed?.segmentCables ?? []
  const sharedSpan = Math.max(0, projection.sharedDeviceCount - 1)

  if (segmentIndex <= sharedSpan) {
    return sharedOverrides.find((entry) => entry.segmentIndex === segmentIndex)?.cable ?? null
  }

  const rootSegmentIndex = segmentIndex - sharedSpan
  return rootOverrides.find((entry) => entry.segmentIndex === rootSegmentIndex)?.cable ?? null
}

type SupplyWireLengthKey =
  | 'wireLengthMUpstream'
  | 'wireLengthMCrossing'
  | 'wireLengthMDownstream'

type SupplyWireLengthVisibilityKey =
  | 'showWireLengthLabelUpstream'
  | 'showWireLengthLabelCrossing'
  | 'showWireLengthLabelDownstream'

function supplyWireLengthKeyForRole(role: SupplyWireRole): SupplyWireLengthKey {
  if (role === 'upstream') return 'wireLengthMUpstream'
  if (role === 'crossing') return 'wireLengthMCrossing'
  return 'wireLengthMDownstream'
}

function supplyWireLengthVisibilityKeyForRole(role: SupplyWireRole): SupplyWireLengthVisibilityKey {
  if (role === 'upstream') return 'showWireLengthLabelUpstream'
  if (role === 'crossing') return 'showWireLengthLabelCrossing'
  return 'showWireLengthLabelDownstream'
}

export function getSupplyWireLengthMForRole(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
): number | undefined {
  const mainSupply = installation.mainSupply
  if (role === 'downstream') {
    const soleMain = collectRootPanels(panels).length === 1
    if (!soleMain) {
      const projection = getPanelFeedProjection(installation, panels, panel)
      if (projection?.rootFeed?.wireLengthM !== undefined) {
        return projection.rootFeed.wireLengthM
      }
    }
  }
  return mainSupply[supplyWireLengthKeyForRole(role)]
}

export function getSupplyWireShowWireLengthLabelForRole(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
): boolean | undefined {
  const mainSupply = installation.mainSupply
  if (role === 'downstream') {
    const soleMain = collectRootPanels(panels).length === 1
    if (!soleMain) {
      const projection = getPanelFeedProjection(installation, panels, panel)
      if (projection?.rootFeed?.showWireLengthLabel !== undefined) {
        return projection.rootFeed.showWireLengthLabel
      }
    }
  }
  return mainSupply[supplyWireLengthVisibilityKeyForRole(role)]
}

export function isSupplyWireLengthLabelVisibleForRole(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
): boolean {
  const lengthM = getSupplyWireLengthMForRole(installation, panels, panel, role)
  if (lengthM == null || lengthM <= 0) return false
  return getSupplyWireShowWireLengthLabelForRole(installation, panels, panel, role) === true
}

export function buildSupplyWireLengthUpdate(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
  wireLengthM: number | undefined,
): Partial<Installation> {
  const mainSupply = installation.mainSupply
  const soleMain = collectRootPanels(panels).length === 1
  const lengthKey = supplyWireLengthKeyForRole(role)
  const showKey = supplyWireLengthVisibilityKeyForRole(role)

  if (role === 'downstream' && !soleMain) {
    const topology = ensureInstallationFeedTopology(installation, panels)
    return {
      feedTopology: {
        ...topology,
        rootFeeds: topology.rootFeeds.map((feed) =>
          feed.panelId === panel.id
            ? {
                ...feed,
                wireLengthM,
                ...(wireLengthM == null ? { showWireLengthLabel: false } : {}),
              }
            : feed,
        ),
      },
    }
  }

  return {
    mainSupply: {
      ...mainSupply,
      [lengthKey]: wireLengthM,
      ...(wireLengthM == null ? { [showKey]: false } : {}),
    },
  }
}

export function buildSupplyWireLengthVisibilityUpdate(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
  visible: boolean,
): Partial<Installation> {
  const mainSupply = installation.mainSupply
  const soleMain = collectRootPanels(panels).length === 1
  const showKey = supplyWireLengthVisibilityKeyForRole(role)

  if (role === 'downstream' && !soleMain) {
    const topology = ensureInstallationFeedTopology(installation, panels)
    return {
      feedTopology: {
        ...topology,
        rootFeeds: topology.rootFeeds.map((feed) =>
          feed.panelId === panel.id ? { ...feed, showWireLengthLabel: visible } : feed,
        ),
      },
    }
  }

  return {
    mainSupply: {
      ...mainSupply,
      [showKey]: visible,
    },
  }
}

export function getAllSupplyTrunkDevices(project: ProjectWithOptionalV2Electrical): TrunkDevice[] {
  const installation = getElectricalInstallationFromProject(project)
  if (!installation) return []
  const topology = ensureInstallationFeedTopology(installation, getElectricalPanelsFromProject(project))
  const all: TrunkDevice[] = []
  const seen = new Set<string>()
  const push = (device: TrunkDevice) => {
    if (seen.has(device.id)) return
    seen.add(device.id)
    all.push(device)
  }

  for (const device of topology.sharedFeed.trunkDevices ?? []) push(device)
  for (const feed of topology.rootFeeds) {
    for (const device of feed.trunkDevices ?? []) push(device)
  }
  return all
}
