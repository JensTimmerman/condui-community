import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import {
  isPanelDistributionEndpointForPanel,
  resolvePanelSupplyLinkForPanel,
} from '@/lib/eendraad/panelSupplyLink'
import {
  findProtectionSupplyingPanel,
  removePanelFromHierarchy,
} from '@/lib/eendraad/projectElectricalDomain'
import { findPanelById } from '@/lib/panel/panelTree'
import type { Installation, Panel, PanelGridModuleRef, PanelGridSlot } from '@/types/schema'

export interface PromotePanelToRootSupplyResult {
  panelId: string
  previousSourcePanelId?: string
  previousFeederProtectionId?: string
  movedIncomingDeviceIds: string[]
}

function rewriteIncomingGridRef(
  ref: PanelGridModuleRef,
  panelCircuitId: string,
  incomingDeviceIds: ReadonlySet<string>
): PanelGridModuleRef {
  if (
    ref.kind !== 'trunkDevice' ||
    ref.scope !== 'circuit' ||
    ref.circuitId !== panelCircuitId ||
    !incomingDeviceIds.has(ref.id)
  ) {
    return ref
  }
  return { kind: 'trunkDevice', id: ref.id, scope: 'supply' }
}

function rewriteIncomingGridSlots(
  slots: PanelGridSlot[] | undefined,
  panelCircuitId: string,
  incomingDeviceIds: ReadonlySet<string>
): PanelGridSlot[] | undefined {
  if (!slots) return undefined
  return slots.map((slot) => ({
    ...slot,
    module: rewriteIncomingGridRef(slot.module, panelCircuitId, incomingDeviceIds),
  }))
}

function rewriteIncomingVisibilityKeys(
  keys: string[] | undefined,
  panelCircuitId: string,
  incomingDeviceIds: ReadonlySet<string>
): string[] | undefined {
  if (!keys) return undefined
  const oldKeys = new Map(
    [...incomingDeviceIds].map((id) => [
      `trunkDevice:${id}:circuit${panelCircuitId}`,
      `trunkDevice:${id}:supply`,
    ])
  )
  return [...new Set(keys.map((key) => oldKeys.get(key) ?? key))]
}

function detachPreviousPanelLink(
  panels: Panel[],
  panel: Panel
): {
  previousSourcePanelId?: string
  previousFeederProtectionId?: string
} {
  const link = resolvePanelSupplyLinkForPanel({ panels }, panel.id)
  const fallback = findProtectionSupplyingPanel(panels, panel.id)
  const protection = link?.protection ?? fallback?.protection
  if (!protection) return {}

  protection.subPanelId = undefined
  for (const circuit of protection.circuits ?? []) {
    circuit.endpoints = circuit.endpoints.filter(
      (endpoint) => !isPanelDistributionEndpointForPanel(endpoint, panel)
    )
  }

  return {
    previousSourcePanelId: link?.sourcePanel.id ?? fallback?.panel.id,
    previousFeederProtectionId: protection.id,
  }
}

/**
 * Promote a nested/secondary panel onto the installation's parallel root supply.
 *
 * The operation preserves local incoming devices by moving them from the
 * secondary-panel `PANEL` circuit to the new root feed. The former feeder
 * protection remains in its source panel, but no longer links to or renders the
 * promoted panel.
 */
export function promotePanelToRootSupply(
  panels: Panel[],
  installation: Installation,
  panelId: string
): PromotePanelToRootSupplyResult | null {
  const panel = findPanelById(panels, panelId)
  if (!panel || (panels.includes(panel) && panel.isMain === true)) return null

  const previousLink = detachPreviousPanelLink(panels, panel)
  const detachedPanel = removePanelFromHierarchy(panels, panelId)
  if (!detachedPanel) return null

  const panelCircuit = detachedPanel.circuits.find((circuit) => circuit.code === 'PANEL')
  const incomingDevices = [...(panelCircuit?.trunkDevices ?? [])].sort(
    (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
  )

  detachedPanel.isMain = true
  panels.push(detachedPanel)

  const topology = ensureInstallationFeedTopology(installation, panels)
  topology.rootFeeds = topology.rootFeeds.filter((feed) => {
    const rootPanel = panels.find((panel) => panel.id === feed.panelId)
    return rootPanel?.isMain === true
  })
  const rootFeed = topology.rootFeeds.find((feed) => feed.panelId === detachedPanel.id)
  if (!rootFeed) return null

  if (incomingDevices.length > 0 && panelCircuit) {
    const merged = [
      ...incomingDevices,
      ...(rootFeed.trunkDevices ?? []).filter(
        (device) => !incomingDevices.some((incoming) => incoming.id === device.id)
      ),
    ]
    rootFeed.trunkDevices = merged.map((device, index) => ({
      ...device,
      trunkPosition: index,
    }))
    panelCircuit.trunkDevices = undefined

    const movedIds = new Set(incomingDevices.map((device) => device.id))
    detachedPanel.gridView &&= {
      ...detachedPanel.gridView,
      slots:
        rewriteIncomingGridSlots(detachedPanel.gridView.slots, panelCircuit.id, movedIds) ?? [],
      supplyPanelSlots: rewriteIncomingGridSlots(
        detachedPanel.gridView.supplyPanelSlots,
        panelCircuit.id,
        movedIds
      ),
      shownModuleKeys: rewriteIncomingVisibilityKeys(
        detachedPanel.gridView.shownModuleKeys,
        panelCircuit.id,
        movedIds
      ),
      hiddenModuleKeys: rewriteIncomingVisibilityKeys(
        detachedPanel.gridView.hiddenModuleKeys,
        panelCircuit.id,
        movedIds
      ),
    }
  }

  return {
    panelId: detachedPanel.id,
    ...previousLink,
    movedIncomingDeviceIds: incomingDevices.map((device) => device.id),
  }
}
