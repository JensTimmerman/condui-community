import { clamp } from '@/lib/geometry'
import { findParentCircuitInfo } from '@/lib/eendraad/findParentCircuitInfo'
import {
  findPanelOwnDistributionEndpoint,
  resolvePanelSupplyLinkForPanel,
} from '@/lib/eendraad/panelSupplyLink'
import { moveProtectionToMainBusInsertIndex } from '@/lib/eendraad/mainBusOrder'
import type { Circuit, Panel, ProtectionDevice } from '@/types/schema'
import { generateId } from '@/utils/project'

export interface MovePanelAttachmentResult {
  sourcePanelId: string
  feederCircuitId: string
  parentCircuitId?: string
  rcdProtectionId?: string
}

function createDirectFeederCircuit(source: Circuit, targetPanel: Panel): Circuit {
  const ownPanelEndpoint = findPanelOwnDistributionEndpoint(targetPanel)
  return {
    ...source,
    id: generateId(),
    endpoints: [
      ownPanelEndpoint
        ? { ...ownPanelEndpoint, id: generateId(), placements: [] }
        : {
            id: generateId(),
            type: 'fixed_appliance',
            label: targetPanel.name,
            symbol: 'panel_distribution',
            panelId: targetPanel.id,
            placements: [],
          },
    ],
    branches: undefined,
    trunkDevices: undefined,
    subCircuitIds: undefined,
    notes: undefined,
  }
}

function findCircuitOwner(
  panels: Panel[],
  circuitId: string
): { panel: Panel; circuit: Circuit; protection?: ProtectionDevice } | null {
  for (const panel of panels) {
    const directCircuit = panel.circuits.find((circuit) => circuit.id === circuitId)
    if (directCircuit) return { panel, circuit: directCircuit }
    for (const protection of panel.protections) {
      const circuit = protection.circuits?.find((candidate) => candidate.id === circuitId)
      if (circuit) return { panel, circuit, protection }
    }
    const nested = findCircuitOwner(panel.subPanels ?? [], circuitId)
    if (nested) return nested
  }
  return null
}

function detachFeederFromCurrentLocation(
  panels: Panel[],
  protection: ProtectionDevice,
  feederCircuit: Circuit
): void {
  const parentInfo = findParentCircuitInfo(feederCircuit.id, panels)
  if (parentInfo?.parentCircuit.subCircuitIds) {
    parentInfo.parentCircuit.subCircuitIds = parentInfo.parentCircuit.subCircuitIds.filter(
      (id) => id !== feederCircuit.id
    )
    if (parentInfo.parentCircuit.subCircuitIds.length === 0) {
      parentInfo.parentCircuit.subCircuitIds = undefined
    }
  }

  protection.circuits = protection.circuits?.filter((circuit) => circuit.id !== feederCircuit.id)
  protection.subPanelId = undefined
}

function removeFeederFromGroupingProtections(
  panels: Panel[],
  feederCircuitId: string,
  ownerProtectionId: string
): void {
  for (const panel of panels) {
    for (const protection of panel.protections) {
      if (protection.id === ownerProtectionId) continue
      protection.circuits = protection.circuits?.filter((circuit) => circuit.id !== feederCircuitId)
    }
    removeFeederFromGroupingProtections(panel.subPanels ?? [], feederCircuitId, ownerProtectionId)
  }
}

function ensureDirectPanelCarrier(
  panels: Panel[],
  targetPanelId: string
): {
  sourcePanel: Panel
  targetPanel: Panel
  protection: ProtectionDevice
  feederCircuit: Circuit
} | null {
  const link = resolvePanelSupplyLinkForPanel({ panels }, targetPanelId)
  if (!link?.feederCircuit) return null

  if (link.protection.directPanelFeeder) {
    return {
      sourcePanel: link.sourcePanel,
      targetPanel: link.targetPanel,
      protection: link.protection,
      feederCircuit: link.feederCircuit,
    }
  }

  let feederCircuit = link.feederCircuit
  const parentInfo = findParentCircuitInfo(feederCircuit.id, panels)
  if (!parentInfo) {
    feederCircuit = createDirectFeederCircuit(feederCircuit, link.targetPanel)
  }
  detachFeederFromCurrentLocation(panels, link.protection, feederCircuit)
  const protection: ProtectionDevice = {
    id: generateId(),
    type: 'OTHER',
    label: '',
    circuits: [feederCircuit],
    subPanelId: targetPanelId,
    directPanelFeeder: true,
  }
  link.sourcePanel.protections.push(protection)

  return {
    sourcePanel: link.sourcePanel,
    targetPanel: link.targetPanel,
    protection,
    feederCircuit,
  }
}

/**
 * Reorder a directly connected secondary panel among the protections on one
 * secondary bus. Legacy implicit attachments are materialized as a panel-only
 * child circuit so their position can use the existing `subCircuitIds` order.
 */
export function movePanelAttachmentOnSecondaryBus(
  panels: Panel[],
  targetPanelId: string,
  parentCircuitId: string,
  insertIndex: number
): MovePanelAttachmentResult | null {
  const link = resolvePanelSupplyLinkForPanel({ panels }, targetPanelId)
  if (!link?.feederCircuit) return null

  const protection = link.protection
  const existingParent = findParentCircuitInfo(link.feederCircuit.id, panels)
  const targetOwner = findCircuitOwner(panels, parentCircuitId)
  const targetProtection = targetOwner?.protection
  if (!targetOwner || !targetProtection) return null

  let feederCircuit = link.feederCircuit
  let parentCircuit = existingParent?.parentCircuit

  if (protection.directPanelFeeder) {
    removeFeederFromGroupingProtections(panels, feederCircuit.id, protection.id)
    detachFeederFromCurrentLocation(panels, protection, feederCircuit)
    link.sourcePanel.protections = link.sourcePanel.protections.filter(
      (candidate) => candidate.id !== protection.id
    )
    parentCircuit = targetOwner.circuit
    targetProtection.subPanelId = targetPanelId
    targetProtection.circuits ??= []
    if (!targetProtection.circuits.some((circuit) => circuit.id === feederCircuit.id)) {
      targetProtection.circuits.push(feederCircuit)
    }
  } else if (!parentCircuit) {
    if (link.feederCircuit.id !== parentCircuitId) return null
    parentCircuit = link.feederCircuit
    feederCircuit = createDirectFeederCircuit(parentCircuit, link.targetPanel)
    protection.circuits ??= []
    protection.circuits.push(feederCircuit)
  } else if (parentCircuit.id !== parentCircuitId) {
    return null
  }

  const order = parentCircuit.subCircuitIds ?? []
  const currentIndex = order.indexOf(feederCircuit.id)
  if (currentIndex >= 0) order.splice(currentIndex, 1)

  const adjustedIndex =
    currentIndex >= 0 && insertIndex > currentIndex ? insertIndex - 1 : insertIndex
  order.splice(clamp(adjustedIndex, 0, order.length), 0, feederCircuit.id)
  parentCircuit.subCircuitIds = order

  return {
    sourcePanelId: link.sourcePanel.id,
    feederCircuitId: feederCircuit.id,
    parentCircuitId: parentCircuit.id,
  }
}

/** Move a secondary-panel attachment onto an RCD/RCBO grouping bus. */
export function movePanelAttachmentOnRcdBus(
  panels: Panel[],
  targetPanelId: string,
  rcdProtectionId: string,
  insertIndex: number
): MovePanelAttachmentResult | null {
  const carrier = ensureDirectPanelCarrier(panels, targetPanelId)
  if (!carrier) return null

  const targetRcd = carrier.sourcePanel.protections.find(
    (protection) =>
      protection.id === rcdProtectionId && (protection.type === 'RCD' || protection.type === 'RCBO')
  )
  if (!targetRcd || targetRcd.id === carrier.protection.id) return null

  const parentInfo = findParentCircuitInfo(carrier.feederCircuit.id, panels)
  if (parentInfo?.parentCircuit.subCircuitIds) {
    parentInfo.parentCircuit.subCircuitIds = parentInfo.parentCircuit.subCircuitIds.filter(
      (id) => id !== carrier.feederCircuit.id
    )
  }
  removeFeederFromGroupingProtections(panels, carrier.feederCircuit.id, carrier.protection.id)

  targetRcd.circuits ??= []
  const order = targetRcd.circuits.filter((circuit) => circuit.id !== carrier.feederCircuit.id)
  order.splice(clamp(insertIndex, 0, order.length), 0, carrier.feederCircuit)
  targetRcd.circuits = order

  // The layout's first circuit owner must remain the structural carrier while
  // the RCD merely references the same feeder circuit for bus grouping.
  const carrierIndex = carrier.sourcePanel.protections.findIndex(
    (protection) => protection.id === carrier.protection.id
  )
  const rcdIndex = carrier.sourcePanel.protections.findIndex(
    (protection) => protection.id === targetRcd.id
  )
  if (carrierIndex > rcdIndex && rcdIndex >= 0) {
    carrier.sourcePanel.protections.splice(carrierIndex, 1)
    carrier.sourcePanel.protections.splice(rcdIndex, 0, carrier.protection)
  }

  return {
    sourcePanelId: carrier.sourcePanel.id,
    feederCircuitId: carrier.feederCircuit.id,
    rcdProtectionId: targetRcd.id,
  }
}

/** Move a secondary-panel attachment directly onto its source panel's main bus. */
export function movePanelAttachmentToMainBus(
  panels: Panel[],
  targetPanelId: string,
  sourcePanelId: string,
  insertIndex: number
): MovePanelAttachmentResult | null {
  const link = resolvePanelSupplyLinkForPanel({ panels }, targetPanelId)
  if (!link?.feederCircuit || link.sourcePanel.id !== sourcePanelId) return null

  let feederCircuit = link.feederCircuit
  let directProtection = link.protection

  if (!directProtection.directPanelFeeder) {
    const parentInfo = findParentCircuitInfo(feederCircuit.id, panels)
    if (!parentInfo) {
      feederCircuit = createDirectFeederCircuit(feederCircuit, link.targetPanel)
    }
    detachFeederFromCurrentLocation(panels, link.protection, feederCircuit)
    directProtection = {
      id: generateId(),
      type: 'OTHER',
      label: '',
      circuits: [feederCircuit],
      subPanelId: targetPanelId,
      directPanelFeeder: true,
    }
    link.sourcePanel.protections.push(directProtection)
  }

  removeFeederFromGroupingProtections(panels, feederCircuit.id, directProtection.id)
  moveProtectionToMainBusInsertIndex(link.sourcePanel, directProtection.id, insertIndex)

  return {
    sourcePanelId: link.sourcePanel.id,
    feederCircuitId: feederCircuit.id,
  }
}
