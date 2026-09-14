/**
 * Quarantine: move orphaned items to a separate collection instead of deleting.
 * Preserves full data, original parent refs, reason and timestamp.
 * Excluded from normal layout/render; exposed in recovery tool.
 */

import type { Panel, Circuit, Endpoint, OrphanReason } from '@/types/schema'
import {
  getEditableProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import {
  editQuarantinedItems,
  queryQuarantinedItems,
  type ValidationProject,
} from '@/lib/projectV2/validation'
import { findPanelById } from '@/lib/panel/panelTree'

type QuarantineProject = ProjectWithOptionalV2Electrical & ValidationProject

/** Remove circuit from panel tree (panel.circuits or protection.circuits) by id */
function removeCircuitFromPanel(panel: Panel, circuitId: string): Circuit | null {
  const idx = panel.circuits.findIndex((c) => c.id === circuitId)
  if (idx !== -1) {
    const removed = panel.circuits.splice(idx, 1)[0]
    return removed ?? null
  }
  for (const protection of panel.protections) {
    if (protection.circuits) {
      const i = protection.circuits.findIndex((c) => c.id === circuitId)
      if (i !== -1) {
        const removed = protection.circuits.splice(i, 1)[0]
        return removed ?? null
      }
    }
  }
  return null
}

/** Remove endpoint from circuit.endpoints and from branch.endpointIds */
function removeEndpointFromCircuit(circuit: Circuit, endpointId: string): Endpoint | null {
  const idx = circuit.endpoints.findIndex((e) => e.id === endpointId)
  if (idx === -1) return null
  const removed = circuit.endpoints.splice(idx, 1)[0]
  if (circuit.branches) {
    for (const branch of circuit.branches) {
      const bi = branch.endpointIds.indexOf(endpointId)
      if (bi !== -1) branch.endpointIds.splice(bi, 1)
    }
    circuit.branches = circuit.branches.filter((b) => b.endpointIds.length > 0)
  }
  return removed ?? null
}

/** Find circuit by id in panel (panel.circuits or any protection.circuits) */
function findCircuitInPanel(panel: Panel, circuitId: string): Circuit | null {
  const c = panel.circuits.find((x) => x.id === circuitId)
  if (c) return c
  for (const protection of panel.protections) {
    const found = protection.circuits?.find((x) => x.id === circuitId)
    if (found) return found
  }
  return null
}

/** Remove circuit id from any circuit's subCircuitIds in the panel (and subpanels) */
function removeFromSubCircuitIds(panels: Panel[], circuitId: string): void {
  const removeFromCircuit = (c: Circuit) => {
    if (c.subCircuitIds) {
      const i = c.subCircuitIds.indexOf(circuitId)
      if (i !== -1) c.subCircuitIds.splice(i, 1)
    }
  }
  for (const panel of panels) {
    for (const c of panel.circuits) removeFromCircuit(c)
    for (const protection of panel.protections) {
      for (const c of protection.circuits ?? []) removeFromCircuit(c)
    }
    removeFromSubCircuitIds(panel.subPanels ?? [], circuitId)
  }
}

/**
 * Move a circuit into quarantine: remove from panel tree and add to the validation quarantine list.
 * Call inside an immer set() so project mutations are tracked.
 */
export function quarantineCircuit(
  project: QuarantineProject,
  panelId: string,
  circuitId: string,
  reason: OrphanReason,
  originalParentId?: string,
  originalRefId?: string
): boolean {
  const panels = getEditableProjectElectricalPanels(project)
  const panel = findPanelById(panels, panelId)
  if (!panel) return false
  const circuit = removeCircuitFromPanel(panel, circuitId)
  if (!circuit) return false
  removeFromSubCircuitIds(panels, circuitId)
  editQuarantinedItems(project).push({
    id: `quarantine-${circuitId}-${Date.now()}`,
    kind: 'circuit',
    data: JSON.parse(JSON.stringify(circuit)),
    reason,
    timestamp: new Date().toISOString(),
    panelId,
    originalParentId,
    originalRefId,
  })
  return true
}

/**
 * Move an endpoint into quarantine: remove from its circuit and add to the validation quarantine list.
 * Call inside an immer set() so project mutations are tracked.
 */
export function quarantineEndpoint(
  project: QuarantineProject,
  panelId: string,
  circuitId: string,
  endpointId: string,
  reason: OrphanReason,
  originalRefId?: string
): boolean {
  const panel = findPanelById(getEditableProjectElectricalPanels(project), panelId)
  if (!panel) return false
  const circuit = findCircuitInPanel(panel, circuitId)
  if (!circuit) return false
  const endpoint = removeEndpointFromCircuit(circuit, endpointId)
  if (!endpoint) return false
  editQuarantinedItems(project).push({
    id: `quarantine-${endpointId}-${Date.now()}`,
    kind: 'endpoint',
    data: JSON.parse(JSON.stringify(endpoint)),
    reason,
    timestamp: new Date().toISOString(),
    panelId,
    originalParentId: circuitId,
    originalRefId,
  })
  return true
}

/**
 * Remove an item from quarantine (permanently delete from quarantinedItems).
 * Call inside an immer set().
 */
export function removeFromQuarantine(project: QuarantineProject, quarantinedItemId: string): boolean {
  const list = editQuarantinedItems(project)
  const idx = list.findIndex((q) => q.id === quarantinedItemId)
  if (idx === -1) return false
  list.splice(idx, 1)
  return true
}

/**
 * Restore a quarantined circuit back into the panel tree.
 * Puts it under originalParentId (protection id) if provided, else under panel.circuits.
 * Call inside an immer set().
 */
export function restoreCircuitFromQuarantine(
  project: QuarantineProject,
  quarantinedItemId: string
): boolean {
  const list = editQuarantinedItems(project)
  const idx = list.findIndex((q) => q.id === quarantinedItemId && q.kind === 'circuit')
  if (idx === -1) return false
  const item = list[idx]!
  const circuit = item.data as Circuit
  const panel = findPanelById(getEditableProjectElectricalPanels(project), item.panelId)
  if (!panel) return false
  if (item.originalParentId) {
    const protection = panel.protections.find((p) => p.id === item.originalParentId)
    if (protection) {
      if (!protection.circuits) protection.circuits = []
      protection.circuits.push(circuit)
    } else {
      panel.circuits.push(circuit)
    }
  } else {
    panel.circuits.push(circuit)
  }
  list.splice(idx, 1)
  return true
}

/**
 * Restore a quarantined endpoint back into its circuit.
 * Puts it in circuit.endpoints and optionally re-adds to branch (originalRefId = branch id).
 * Call inside an immer set().
 */
export function restoreEndpointFromQuarantine(
  project: QuarantineProject,
  quarantinedItemId: string
): boolean {
  const list = editQuarantinedItems(project)
  const idx = list.findIndex((q) => q.id === quarantinedItemId && q.kind === 'endpoint')
  if (idx === -1) return false
  const item = list[idx]!
  const endpoint = item.data as Endpoint
  const panel = findPanelById(getEditableProjectElectricalPanels(project), item.panelId)
  if (!panel) return false
  const circuitId = item.originalParentId
  if (!circuitId) return false
  const circuit = findCircuitInPanel(panel, circuitId)
  if (!circuit) return false
  circuit.endpoints.push(endpoint)
  if (item.originalRefId && circuit.branches) {
    const branch = circuit.branches.find((b) => b.id === item.originalRefId)
    if (branch) branch.endpointIds.push(endpoint.id)
  }
  list.splice(idx, 1)
  return true
}

export function restoreFromQuarantine(project: QuarantineProject, quarantinedItemId: string): boolean {
  const list = queryQuarantinedItems(project)
  const q = list.find((x) => x.id === quarantinedItemId)
  if (!q) return false
  return q.kind === 'circuit'
    ? restoreCircuitFromQuarantine(project, quarantinedItemId)
    : restoreEndpointFromQuarantine(project, quarantinedItemId)
}
