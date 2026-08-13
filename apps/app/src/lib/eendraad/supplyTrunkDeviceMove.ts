import { clamp } from '@/lib/geometry'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { TrunkDevice, WireSegment } from '@/types/schema'
import type { Point } from '@/types/ui'
import type { ElectricalEnclosureRef } from '@/types/supplyAssembly'
import type { BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import { getPanelDiagramId } from '@/lib/layout/bottomUpLayout'
import { getSupplyEnclosureBoundaryCenter } from '@/lib/layout/supplyEnclosureBoundaryGeometry'
import {
  moveSupplyDeviceToEnclosureAutomatically,
  resolveSupplyDeviceMounting,
} from '@/lib/panel/auxiliarySupplyEnclosures'

const SUPPLY_PROTECTION_TARGETS = new Set<DropTarget['type']>([
  'supplyWire',
  'supplyBackupWire',
  'supplyBackupOutputWire',
  'supplyChangeoverGridWire',
  'supplyConverterGridWire',
  'supplyConverterDcWire',
])

const SUPPLY_METER_TARGETS = SUPPLY_PROTECTION_TARGETS

export interface SupplyTrunkDeviceMoveResult {
  device: TrunkDevice
  sourcePanelId?: string
  targetPanelId?: string
}

function supplyDeviceMatchesTargetLane(device: TrunkDevice, target: DropTarget): boolean {
  const path = device.supplyPath
  if (target.type === 'supplyConverterDcWire') {
    return path === (target.supplyConverterDcBranch === 'top' ? 'converter-dc-top' : 'converter-dc')
  }
  if (target.type === 'supplyConverterGridWire') {
    return path === 'converter-grid' || path === 'backup' || path === 'converter-branch'
  }
  if (target.type === 'supplyBackupWire' || target.type === 'supplyBackupOutputWire') {
    return path === 'backup-output' || path === 'backup'
  }
  if (target.type === 'supplyChangeoverGridWire') {
    return path === 'changeover-grid' || device.symbol === 'source_changeover'
  }
  return path == null || path === 'serial' || device.symbol === 'source_changeover'
}

/** Infer the enclosure region under a one-wire drop from nearby mounted devices. */
export function resolveSupplyDropMounting(
  project: ProjectWithOptionalV2Electrical,
  panelLayout: BottomUpPanelLayout,
  target: DropTarget,
  position: Point,
  wireSegments: WireSegment[] = []
): ElectricalEnclosureRef {
  const ownerPanelId = panelLayout.ownerPanelId ?? panelLayout.panel.id
  const candidates: Array<{
    mounting: ElectricalEnclosureRef
    distance: number
    x: number
    y: number
  }> = (panelLayout.supplyDevices ?? [])
    .filter(({ device }) => supplyDeviceMatchesTargetLane(device, target))
    .map(({ device, x, y }) => ({
      mounting: resolveSupplyDeviceMounting(project, device.id),
      distance: Math.hypot(position.x - x, position.y - y),
      x,
      y,
    }))
    .filter(
      (
        candidate
      ): candidate is {
        mounting: ElectricalEnclosureRef
        distance: number
        x: number
        y: number
      } => candidate.mounting != null
    )

  if (target.type === 'supplyWire') {
    if (target.supplyFeedScope === 'shared') {
      candidates.push({
        mounting: { kind: 'grid' },
        distance: Math.hypot(position.x - panelLayout.supply.x, position.y - panelLayout.supply.y),
        x: panelLayout.supply.x,
        y: panelLayout.supply.y,
      })
    } else {
      candidates.push({
        mounting: { kind: 'panel', panelId: ownerPanelId },
        distance: Math.hypot(
          position.x - panelLayout.mainBus.x,
          position.y - panelLayout.mainBus.y
        ),
        x: panelLayout.mainBus.x,
        y: panelLayout.mainBus.y,
      })
    }
  }

  const diagramId = getPanelDiagramId(panelLayout)
  const nearbyBoundary = wireSegments
    .filter(
      (segment) => segment.diagramId === diagramId && segment.supplyEnclosureBoundary === true
    )
    .map((segment) => {
      const center = getSupplyEnclosureBoundaryCenter(segment)
      const horizontalWire =
        Math.abs(segment.endPoint.x - segment.startPoint.x) >=
        Math.abs(segment.endPoint.y - segment.startPoint.y)
      const perpendicularDistance = horizontalWire
        ? Math.abs(position.y - center.y)
        : Math.abs(position.x - center.x)
      const axisDistance = horizontalWire
        ? Math.abs(position.x - center.x)
        : Math.abs(position.y - center.y)
      return { center, horizontalWire, perpendicularDistance, axisDistance }
    })
    .filter((boundary) => boundary.perpendicularDistance <= 24)
    .sort(
      (left, right) =>
        left.perpendicularDistance - right.perpendicularDistance ||
        left.axisDistance - right.axisDistance
    )[0]

  if (nearbyBoundary) {
    const boundaryAxis = nearbyBoundary.horizontalWire
      ? nearbyBoundary.center.x
      : nearbyBoundary.center.y
    const pointerAxis = nearbyBoundary.horizontalWire ? position.x : position.y
    const sameLane = candidates.filter((candidate) =>
      nearbyBoundary.horizontalWire
        ? Math.abs(candidate.y - nearbyBoundary.center.y) <= 50
        : Math.abs(candidate.x - nearbyBoundary.center.x) <= 50
    )
    const sideCandidates = sameLane.filter((candidate) => {
      const candidateAxis = nearbyBoundary.horizontalWire ? candidate.x : candidate.y
      return pointerAxis <= boundaryAxis
        ? candidateAxis <= boundaryAxis
        : candidateAxis >= boundaryAxis
    })
    sideCandidates.sort((left, right) => left.distance - right.distance)
    if (sideCandidates[0]) return sideCandidates[0].mounting
  }

  candidates.sort((left, right) => left.distance - right.distance)
  return (
    candidates[0]?.mounting ??
    (target.supplyFeedScope === 'shared'
      ? { kind: 'grid' }
      : { kind: 'panel', panelId: ownerPanelId })
  )
}

export function isSupplyTrunkDeviceDropTarget(device: TrunkDevice, target: DropTarget): boolean {
  const isDcBranchDevice =
    device.supplyPath === 'converter-dc' || device.supplyPath === 'converter-dc-top'
  const validTarget =
    (isDcBranchDevice && target.type === 'supplyConverterDcWire') ||
    (!isDcBranchDevice &&
      device.type === 'protection' &&
      SUPPLY_PROTECTION_TARGETS.has(target.type)) ||
    (!isDcBranchDevice &&
      device.type === 'energy_meter' &&
      SUPPLY_METER_TARGETS.has(target.type)) ||
    (!isDcBranchDevice && device.type !== 'protection' && target.type === 'supplyWire')
  if (!validTarget || device.supplyPath === 'backup') return false

  const targetScope = target.supplyFeedScope ?? 'shared'
  if (targetScope === 'root' && !target.panelId) return false
  return !(
    (device.symbol === 'source_changeover' || device.supplyPath === 'converter-branch') &&
    targetScope !== 'root'
  )
}

function getSupplyContainers(project: ProjectWithOptionalV2Electrical) {
  const installation = getElectricalInstallationFromProject(project)
  if (!installation) return null
  const topology = ensureInstallationFeedTopology(
    installation,
    getElectricalPanelsFromProject(project)
  )
  return { installation, topology }
}

/**
 * Move an existing supply-frame device through the same feed lanes and insertion
 * slots used by library drops. The project is mutated only after the complete
 * source/target move has been validated.
 */
export function moveSupplyTrunkDeviceAtDropTarget(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string,
  target: DropTarget,
  targetMounting?: ElectricalEnclosureRef
): SupplyTrunkDeviceMoveResult | null {
  const containers = getSupplyContainers(project)
  if (!containers) return null
  const sharedDevices =
    containers.installation.mainSupply.supplyTrunkDevices ??
    (containers.installation.mainSupply.supplyTrunkDevices = [])
  const rootFeed = containers.topology.rootFeeds.find((feed) =>
    (feed.trunkDevices ?? []).some((device) => device.id === deviceId)
  )
  const source = sharedDevices.some((device) => device.id === deviceId)
    ? { devices: sharedDevices, scope: 'shared' as const, panelId: undefined }
    : rootFeed
      ? { devices: rootFeed.trunkDevices ?? [], scope: 'root' as const, panelId: rootFeed.panelId }
      : null
  const sourceIndex = source?.devices.findIndex((device) => device.id === deviceId) ?? -1
  const device = sourceIndex >= 0 ? source?.devices[sourceIndex] : undefined
  if (!source || !device) return null

  if (!isSupplyTrunkDeviceDropTarget(device, target)) return null

  const targetScope = target.supplyFeedScope ?? 'shared'

  const targetRootFeed =
    targetScope === 'root'
      ? containers.topology.rootFeeds.find((feed) => feed.panelId === target.panelId)
      : undefined
  if (targetScope === 'root' && !targetRootFeed) return null
  const targetDevices =
    targetScope === 'shared'
      ? sharedDevices
      : (targetRootFeed!.trunkDevices ?? (targetRootFeed!.trunkDevices = []))
  const sameContainer = source.devices === targetDevices
  const targetSupplyPath: TrunkDevice['supplyPath'] =
    target.type === 'supplyConverterDcWire'
      ? target.supplyConverterDcBranch === 'top'
        ? 'converter-dc-top'
        : 'converter-dc'
      : device.type === 'protection' || device.type === 'energy_meter'
        ? target.type === 'supplyBackupOutputWire' || target.type === 'supplyBackupWire'
          ? 'backup-output'
          : target.type === 'supplyChangeoverGridWire'
            ? 'changeover-grid'
            : target.type === 'supplyConverterGridWire'
              ? 'converter-grid'
              : 'serial'
        : device.supplyPath
  let insertIndex = clamp(
    target.supplyDeviceInsertIndex ?? targetDevices.length,
    0,
    targetDevices.length
  )
  if (sameContainer && insertIndex > sourceIndex) insertIndex -= 1
  if (
    sameContainer &&
    insertIndex === sourceIndex &&
    (device.supplyPath ?? 'serial') === (targetSupplyPath ?? 'serial')
  ) {
    if (
      targetMounting &&
      !moveSupplyDeviceToEnclosureAutomatically(
        project,
        deviceId,
        targetMounting,
        target.panelId ?? source.panelId ?? ''
      )
    ) {
      return null
    }
    return { device, sourcePanelId: source.panelId, targetPanelId: target.panelId }
  }

  source.devices.splice(sourceIndex, 1)
  device.supplyPath = targetSupplyPath

  const safeInsertIndex = clamp(insertIndex, 0, targetDevices.length)
  targetDevices.splice(safeInsertIndex, 0, device)
  source.devices.forEach((item, index) => {
    item.trunkPosition = index
  })
  if (!sameContainer) {
    targetDevices.forEach((item, index) => {
      item.trunkPosition = index
    })
  }

  if (
    targetMounting &&
    !moveSupplyDeviceToEnclosureAutomatically(
      project,
      deviceId,
      targetMounting,
      target.panelId ?? source.panelId ?? ''
    )
  ) {
    return null
  }

  return { device, sourcePanelId: source.panelId, targetPanelId: target.panelId }
}
