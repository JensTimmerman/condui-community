/**
 * Parent/child relation edges for panel grid modules (for drawing relation wires).
 */
import type {
  Panel,
  PanelGridModuleRef,
  ProtectionDevice,
  Circuit,
  TrunkDevice,
} from '@/types/schema'
import { ensureInstallationFeedTopology, getPanelFeedProjection } from '@/lib/feedTopology'
import { getPanelIncomingMainBusFeedDevice } from '@/lib/panel/subPanelFeed'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'

/** Trunk chain order on a circuit (matches eendraad trunkPosition). */
function orderedTrunkDevices(circuit: Circuit | null | undefined): TrunkDevice[] {
  const list = circuit?.trunkDevices ?? []
  if (list.length <= 1) return [...list]
  return [...list].sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
}

function findProtectionForCircuit(panel: Panel, circuitId: string): ProtectionDevice | null {
  for (const pr of panel.protections) {
    if (pr.circuits?.some((c) => c.id === circuitId)) return pr
  }
  for (const sub of panel.subPanels ?? []) {
    const found = findProtectionForCircuit(sub, circuitId)
    if (found) return found
  }
  return null
}

function findCircuitInPanel(panel: Panel, circuitId: string): Circuit | null {
  for (const pr of panel.protections) {
    const c = pr.circuits?.find((ci) => ci.id === circuitId)
    if (c) return c
  }
  const c = panel.circuits.find((ci) => ci.id === circuitId)
  if (c) return c
  for (const sub of panel.subPanels ?? []) {
    const found = findCircuitInPanel(sub, circuitId)
    if (found) return found
  }
  return null
}

function flattenPanelsDepthFirst(panels: Panel[]): Panel[] {
  const out: Panel[] = []
  const walk = (p: Panel) => {
    out.push(p)
    for (const s of p.subPanels ?? []) walk(s)
  }
  for (const p of panels) walk(p)
  return out
}

function projectPanels(project: ProjectWithOptionalV2Electrical): Panel[] {
  return getElectricalPanelsFromProject(project)
}

function projectInstallation(project: ProjectWithOptionalV2Electrical) {
  return getElectricalInstallationFromProject(project)
}

function findSupplyTrunkDeviceByIdInProject(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string
): TrunkDevice | null {
  const installation = projectInstallation(project)
  if (!installation) return null
  const topology = ensureInstallationFeedTopology(installation, projectPanels(project))
  for (const d of topology.sharedFeed.trunkDevices ?? []) {
    if (d.id === deviceId) return d
  }
  for (const rf of topology.rootFeeds) {
    for (const d of rf.trunkDevices ?? []) {
      if (d.id === deviceId) return d
    }
  }
  return installation.mainSupply?.supplyTrunkDevices?.find((d) => d.id === deviceId) ?? null
}

/**
 * First supply trunk on this panel's grid that is not part of the global shared feed
 * (root-local / board-specific chain).
 */
function firstSupplyTrunkOnPanelGridNotInShared(
  project: ProjectWithOptionalV2Electrical,
  panel: Panel,
  sharedIds: Set<string>
): TrunkDevice | null {
  type Cand = { pri: number; row: number; col: number; id: string }
  const cands: Cand[] = []
  for (const s of panel.gridView?.slots ?? []) {
    const m = s.module
    if (m?.kind === 'trunkDevice' && m.scope === 'supply' && !sharedIds.has(m.id)) {
      cands.push({ pri: 0, row: s.row, col: s.col, id: m.id })
    }
  }
  for (const s of panel.gridView?.supplyPanelSlots ?? []) {
    const m = s.module
    if (m?.kind === 'trunkDevice' && m.scope === 'supply' && !sharedIds.has(m.id)) {
      cands.push({ pri: 1, row: s.row, col: s.col, id: m.id })
    }
  }
  cands.sort((a, b) => a.pri - b.pri || a.row - b.row || a.col - b.col)
  for (const c of cands) {
    const d = findSupplyTrunkDeviceByIdInProject(project, c.id)
    if (d) return d
  }
  return null
}

/** First trunk after the shared segment for this main (projection, then grid fallback). */
function firstPostSharedSupplyTrunkForMain(
  project: ProjectWithOptionalV2Electrical,
  panel: Panel
): TrunkDevice | null {
  if (panel.isMain !== true) return null
  const installation = projectInstallation(project)
  if (!installation) return null
  const panels = projectPanels(project)
  const topology = ensureInstallationFeedTopology(installation, panels)
  const sharedIds = new Set((topology.sharedFeed.trunkDevices ?? []).map((d) => d.id))
  const proj = getPanelFeedProjection(installation, panels, panel)
  if (!proj) return null
  const sc = proj.sharedDeviceCount
  const fromMerged = proj.devices[sc]
  if (fromMerged && !sharedIds.has(fromMerged.id)) return fromMerged

  const fromRootFeed = proj.rootFeed?.trunkDevices?.[0]
  if (fromRootFeed && !sharedIds.has(fromRootFeed.id)) return fromRootFeed

  return firstSupplyTrunkOnPanelGridNotInShared(project, panel, sharedIds)
}

function findPanelOwningCircuitInTree(panels: Panel[], circuitId: string): Panel | null {
  for (const p of panels) {
    for (const pr of p.protections) {
      if (pr.circuits?.some((c) => c.id === circuitId)) return p
    }
    if (p.circuits.some((c) => c.id === circuitId)) return p
    const sub = findPanelOwningCircuitInTree(p.subPanels ?? [], circuitId)
    if (sub) return sub
  }
  return null
}

function allProtectionsInProject(
  project: ProjectWithOptionalV2Electrical
): Array<{ panel: Panel; pr: ProtectionDevice }> {
  return flattenPanelsDepthFirst(projectPanels(project)).flatMap((panel) =>
    (panel.protections ?? []).map((pr) => ({ panel, pr }))
  )
}

function findProtectionOwningPanel(
  project: ProjectWithOptionalV2Electrical,
  protectionId: string
): { panel: Panel; pr: ProtectionDevice } | null {
  const walk = (p: Panel): { panel: Panel; pr: ProtectionDevice } | null => {
    const pr = p.protections.find((x) => x.id === protectionId)
    if (pr) return { panel: p, pr }
    for (const s of p.subPanels ?? []) {
      const hit = walk(s)
      if (hit) return hit
    }
    return null
  }
  for (const root of projectPanels(project)) {
    const hit = walk(root)
    if (hit) return hit
  }
  return null
}

function getProtectionFedPanelIds(pr: ProtectionDevice): string[] {
  const ids = new Set<string>()
  if (pr.subPanelId) ids.add(pr.subPanelId)
  for (const c of pr.circuits ?? []) {
    for (const ep of c.endpoints ?? []) {
      if (ep.symbol === 'panel_distribution' && ep.panelId) ids.add(ep.panelId)
    }
  }
  return [...ids]
}

/**
 * Panel that owns the given grid module ref (relation / routing context).
 */
/** Parent-board MCB that owns `subPanelId` pointing at this panel (feeds the PANEL line). */
function findFeederProtectionForSubPanel(
  project: ProjectWithOptionalV2Electrical,
  subPanel: Panel
): ProtectionDevice | null {
  const search = (panels: Panel[]): ProtectionDevice | null => {
    for (const p of panels) {
      for (const pr of p.protections) {
        if (getProtectionFedPanelIds(pr).includes(subPanel.id)) return pr
      }
      const hit = search(p.subPanels ?? [])
      if (hit) return hit
    }
    return null
  }
  return search(projectPanels(project))
}

export function findPanelContainingModuleRef(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical | null
): Panel | null {
  if (!project) return null

  if (ref.kind === 'protection') {
    return findProtectionOwningPanel(project, ref.id)?.panel ?? null
  }

  if (ref.kind === 'trunkDevice' && ref.scope === 'supply') {
    const installation = projectInstallation(project)
    if (!installation) return null
    const panels = projectPanels(project)
    for (const p of flattenPanelsDepthFirst(panels)) {
      if (!p.isMain) continue
      const devices = getPanelFeedProjection(installation, panels, p)?.devices ?? []
      if (devices.some((d) => d.id === ref.id)) return p
    }
    return null
  }

  if (ref.kind === 'trunkDevice' && ref.scope === 'ground') {
    const panels = projectPanels(project)
    const list = projectInstallation(project)?.groundTrunkDevices ?? []
    if (!list.some((d) => d.id === ref.id)) return null
    return panels.find((p) => p.isMain) ?? panels[0] ?? null
  }

  if (ref.kind === 'trunkDevice' && ref.scope === 'circuit' && ref.circuitId) {
    const owner = findPanelOwningCircuitInTree(projectPanels(project), ref.circuitId)
    if (!owner) return null
    const circuit = findCircuitInPanel(owner, ref.circuitId)
    const list = orderedTrunkDevices(circuit)
    return list.some((d) => d.id === ref.id) ? owner : null
  }

  if (ref.kind === 'domotica') {
    return findPanelOwningCircuitInTree(projectPanels(project), ref.circuitId)
  }

  return null
}

/** A protection is "on the main bus" if no other protection in the panel claims its
 *  circuits via subCircuitIds (i.e. it has no parent protection in the hierarchy). */
function isMainBusProtection(pr: ProtectionDevice, panel: Panel): boolean {
  const myCircuitIds = pr.circuits?.map((c) => c.id) ?? []
  if (myCircuitIds.length === 0) return true
  for (const otherPr of panel.protections) {
    if (otherPr.id === pr.id) continue
    for (const c of otherPr.circuits ?? []) {
      if (c.subCircuitIds?.some((sid) => myCircuitIds.includes(sid))) {
        return false
      }
    }
  }
  return true
}

export interface RelationEdges {
  parentRefs: PanelGridModuleRef[]
  childRefs: PanelGridModuleRef[]
  /** Fed panels that have no module available as the relation-wire target. */
  childPanelIds: string[]
}

/**
 * Get parent and child module refs for the given ref, for drawing relation wires.
 * Only returns refs that correspond to modules (protections, trunk devices, domotica).
 */
export function getRelationEdges(
  ref: PanelGridModuleRef,
  panel: Panel,
  project: ProjectWithOptionalV2Electrical | null
): RelationEdges {
  const parentRefs: PanelGridModuleRef[] = []
  const childRefs: PanelGridModuleRef[] = []
  const childPanelIds: string[] = []
  if (!project) return { parentRefs, childRefs, childPanelIds }
  const panels = projectPanels(project)
  const installation = projectInstallation(project)
  const mainPanelSupplyDevices =
    panel.isMain && installation
      ? (getPanelFeedProjection(installation, panels, panel)?.devices ?? [])
      : []

  if (ref.kind === 'protection') {
    const allProjectProtections = allProtectionsInProject(project)
    const hit = findProtectionOwningPanel(project, ref.id)
    const pr = hit?.pr ?? null
    const protectionPanel = hit?.panel ?? panel
    const pushedChildPr = new Set<string>()
    const pushedChildCircuitTrunks = new Set<string>()
    if (pr?.circuits) {
      for (const circuit of pr.circuits) {
        const trunks = orderedTrunkDevices(circuit)
        const firstTrunkDevice = trunks[0]
        if (firstTrunkDevice) {
          const firstTrunkKey = `${firstTrunkDevice.id}:${circuit.id}`
          pushedChildCircuitTrunks.add(firstTrunkKey)
          childRefs.push({
            kind: 'trunkDevice',
            id: firstTrunkDevice.id,
            scope: 'circuit',
            circuitId: circuit.id,
          })
        }
        // Circuit-level branches start after the final trunk device. Only circuits without
        // trunks attach domotica and sub-protections directly to their protection.
        if (trunks.length === 0) {
          for (const ep of circuit.endpoints) {
            if (ep.symbol === 'domotica') {
              childRefs.push({ kind: 'domotica', endpointId: ep.id, circuitId: circuit.id })
            }
          }
          // Child protections: other protections whose circuits are referenced via subCircuitIds
          // (any panel in the tree — e.g. main MCB → sub-panel board)
          for (const subCId of circuit.subCircuitIds ?? []) {
            const hit = allProjectProtections.find(
              ({ pr: childPr }) =>
                childPr.id !== ref.id && childPr.circuits?.some((c) => c.id === subCId)
            )
            if (hit && !pushedChildPr.has(hit.pr.id)) {
              pushedChildPr.add(hit.pr.id)
              childRefs.push({ kind: 'protection', id: hit.pr.id })
            }
          }
        }
      }
    }
    // Feeder protection -> fed sub-panel main-bus protections (for MSPF/WSPF wiring)
    for (const fedPanelId of pr ? getProtectionFedPanelIds(pr) : []) {
      const fedPanel = findPanelById(panels, fedPanelId)
      if (!fedPanel) continue
      const incoming = getPanelIncomingMainBusFeedDevice(fedPanel)
      if (incoming) {
        const incomingKey = `${incoming.device.id}:${incoming.circuit.id}`
        if (!pushedChildCircuitTrunks.has(incomingKey)) {
          pushedChildCircuitTrunks.add(incomingKey)
          childRefs.push({
            kind: 'trunkDevice',
            id: incoming.device.id,
            scope: 'circuit',
            circuitId: incoming.circuit.id,
          })
        }
        continue
      }
      let hasModuleTarget = false
      for (const fedPr of fedPanel.protections) {
        if (!isMainBusProtection(fedPr, fedPanel)) continue
        if (fedPr.id === ref.id || pushedChildPr.has(fedPr.id)) continue
        pushedChildPr.add(fedPr.id)
        childRefs.push({ kind: 'protection', id: fedPr.id })
        hasModuleTarget = true
      }
      if (!hasModuleTarget) childPanelIds.push(fedPanel.id)
    }
    // Parent protection: another protection whose circuit's subCircuitIds includes one of our circuit IDs
    const myCircuitIds = new Set(pr?.circuits?.map((c) => c.id) ?? [])
    if (myCircuitIds.size > 0) {
      const pushedParentRefs = new Set<string>()
      for (const { pr: otherPr } of allProjectProtections) {
        if (otherPr.id === ref.id) continue
        for (const c of otherPr.circuits ?? []) {
          if (c.subCircuitIds?.some((sid) => myCircuitIds.has(sid))) {
            const parentTrunks = orderedTrunkDevices(c)
            const lastTrunk = parentTrunks[parentTrunks.length - 1]
            const parentRef: PanelGridModuleRef = lastTrunk
              ? { kind: 'trunkDevice', id: lastTrunk.id, scope: 'circuit', circuitId: c.id }
              : { kind: 'protection', id: otherPr.id }
            const parentKey = lastTrunk
              ? `trunk:${c.id}:${lastTrunk.id}`
              : `protection:${otherPr.id}`
            if (!pushedParentRefs.has(parentKey)) {
              pushedParentRefs.add(parentKey)
              parentRefs.push(parentRef)
            }
            break
          }
        }
      }
    }
    // Main-bus protections: incoming PANEL feed (another board) wins over utility supply;
    // sub-panels fall back to the upstream feeder MCB when the PANEL line has no trunks yet.
    if (pr && isMainBusProtection(pr, protectionPanel)) {
      const incoming = getPanelIncomingMainBusFeedDevice(protectionPanel)
      if (incoming) {
        parentRefs.push({
          kind: 'trunkDevice',
          id: incoming.device.id,
          scope: 'circuit',
          circuitId: incoming.circuit.id,
        })
      } else if (protectionPanel.isMain) {
        const devices = installation
          ? (getPanelFeedProjection(installation, panels, protectionPanel)?.devices ?? [])
          : []
        if (devices.length > 0) {
          const last = devices[devices.length - 1]!
          parentRefs.push({ kind: 'trunkDevice', id: last.id, scope: 'supply' })
        }
      } else {
        const feederPr = findFeederProtectionForSubPanel(project, protectionPanel)
        if (feederPr) {
          parentRefs.push({ kind: 'protection', id: feederPr.id })
        }
      }
    }
  }

  if (ref.kind === 'trunkDevice') {
    if (ref.scope === 'supply') {
      if (panel.isMain && installation) {
        const topology = ensureInstallationFeedTopology(installation, panels)
        const sharedDevices = topology.sharedFeed.trunkDevices ?? []
        const idxInShared = sharedDevices.findIndex((d) => d.id === ref.id)

        // Shared feed is global; do not derive position from one panel's merged list (order /
        // sync issues skipped the multi-root fanout when idx !== sharedCount - 1 there).
        if (idxInShared >= 0) {
          if (idxInShared > 0) {
            const prev = sharedDevices[idxInShared - 1]
            if (prev) parentRefs.push({ kind: 'trunkDevice', id: prev.id, scope: 'supply' })
          }
          if (idxInShared < sharedDevices.length - 1) {
            const next = sharedDevices[idxInShared + 1]
            if (next) childRefs.push({ kind: 'trunkDevice', id: next.id, scope: 'supply' })
          } else {
            // Last shared splits to each main: first post-shared trunk when present, otherwise
            // the supply lands on the DIN main bus (same as legacy "last supply → protections").
            const seenSupplyChildIds = new Set<string>()
            const seenProtectionChildIds = new Set<string>()
            for (const p of flattenPanelsDepthFirst(panels)) {
              if (!p.isMain) continue
              const firstAfterShared = firstPostSharedSupplyTrunkForMain(project, p)
              if (firstAfterShared) {
                if (seenSupplyChildIds.has(firstAfterShared.id)) continue
                seenSupplyChildIds.add(firstAfterShared.id)
                childRefs.push({ kind: 'trunkDevice', id: firstAfterShared.id, scope: 'supply' })
              } else {
                for (const pr of p.protections) {
                  if (!isMainBusProtection(pr, p)) continue
                  if (seenProtectionChildIds.has(pr.id)) continue
                  seenProtectionChildIds.add(pr.id)
                  childRefs.push({ kind: 'protection', id: pr.id })
                }
              }
            }
          }
        } else {
          const list = mainPanelSupplyDevices
          const idx = list.findIndex((d) => d.id === ref.id)
          if (idx > 0) {
            const prev = list[idx - 1]
            if (prev) parentRefs.push({ kind: 'trunkDevice', id: prev.id, scope: 'supply' })
          }
          if (idx >= 0 && idx < list.length - 1) {
            const next = list[idx + 1]
            if (next) childRefs.push({ kind: 'trunkDevice', id: next.id, scope: 'supply' })
          }
          // Last supply trunk device feeds the main bus → all main-bus-level protections
          if (idx === list.length - 1) {
            for (const pr of panel.protections) {
              if (isMainBusProtection(pr, panel)) {
                childRefs.push({ kind: 'protection', id: pr.id })
              }
            }
          }
        }
      }
    }
    if (ref.scope === 'ground') {
      const list = installation?.groundTrunkDevices ?? []
      const idx = list.findIndex((d) => d.id === ref.id)
      if (idx > 0) {
        const prev = list[idx - 1]
        if (prev) parentRefs.push({ kind: 'trunkDevice', id: prev.id, scope: 'ground' })
      }
      if (idx >= 0 && idx < list.length - 1) {
        const next = list[idx + 1]
        if (next) childRefs.push({ kind: 'trunkDevice', id: next.id, scope: 'ground' })
      }
    }
    if (ref.scope === 'circuit' && ref.circuitId) {
      // Circuit trunk devices must have exactly ONE logical parent:
      // - first device: parent is the circuit's protection (or nothing for direct panel.circuits)
      // - later devices: parent is the previous trunk device in the same circuit
      const circuit = findCircuitInPanel(panel, ref.circuitId)
      const list = orderedTrunkDevices(circuit)
      const idx = list.findIndex((d) => d.id === ref.id)

      if (idx > 0) {
        const prev = list[idx - 1]
        if (prev) {
          parentRefs.push({
            kind: 'trunkDevice',
            id: prev.id,
            scope: 'circuit',
            circuitId: ref.circuitId,
          })
        }
      } else {
        const protection = findProtectionForCircuit(panel, ref.circuitId)
        if (protection) {
          parentRefs.push({ kind: 'protection', id: protection.id })
        } else if (circuit?.code === 'PANEL') {
          const feederPr = findFeederProtectionForSubPanel(project, panel)
          if (feederPr) {
            parentRefs.push({ kind: 'protection', id: feederPr.id })
          }
        }
      }
      if (circuit && idx === list.length - 1) {
        for (const ep of circuit.endpoints) {
          if (ep.symbol === 'domotica') {
            childRefs.push({ kind: 'domotica', endpointId: ep.id, circuitId: circuit.id })
          }
        }
        const allProjectProtections = allProtectionsInProject(project)
        for (const subCircuitId of circuit.subCircuitIds ?? []) {
          const child = allProjectProtections.find(({ pr }) =>
            pr.circuits?.some((childCircuit) => childCircuit.id === subCircuitId)
          )
          if (child) childRefs.push({ kind: 'protection', id: child.pr.id })
        }
      }

      // Child: next trunk device in the chain (at most one)
      if (idx >= 0 && idx < list.length - 1) {
        const next = list[idx + 1]
        if (next) {
          childRefs.push({
            kind: 'trunkDevice',
            id: next.id,
            scope: 'circuit',
            circuitId: ref.circuitId,
          })
        }
      }

      // PANEL incoming circuit: resolved feed device feeds the DIN rail main bus (all main-bus protections)
      const panelFeed = getPanelIncomingMainBusFeedDevice(panel)
      if (
        circuit?.code === 'PANEL' &&
        panelFeed &&
        ref.id === panelFeed.device.id &&
        ref.circuitId === panelFeed.circuit.id
      ) {
        for (const p of panel.protections) {
          if (isMainBusProtection(p, panel)) {
            childRefs.push({ kind: 'protection', id: p.id })
          }
        }
      }
    }
  }

  if (ref.kind === 'domotica') {
    const circuit = findCircuitInPanel(panel, ref.circuitId)
    const circuitTrunks = orderedTrunkDevices(circuit)
    const lastTrunk = circuitTrunks[circuitTrunks.length - 1]
    if (lastTrunk) {
      parentRefs.push({
        kind: 'trunkDevice',
        id: lastTrunk.id,
        scope: 'circuit',
        circuitId: ref.circuitId,
      })
      return { parentRefs, childRefs, childPanelIds }
    }
    const protection = findProtectionForCircuit(panel, ref.circuitId)
    if (protection) {
      parentRefs.push({ kind: 'protection', id: protection.id })
    }
  }

  return { parentRefs, childRefs, childPanelIds }
}

function findProtectionByIdInPanel(panel: Panel, id: string): ProtectionDevice | null {
  const pr = panel.protections.find((p) => p.id === id)
  if (pr) return pr
  for (const sub of panel.subPanels ?? []) {
    const found = findProtectionByIdInPanel(sub, id)
    if (found) return found
  }
  return null
}

/**
 * Resolve a panel grid module ref to a target circuit ID for "assign to circuit" flow.
 * Returns null for supply/ground trunk devices (no circuit).
 */
export function getCircuitIdFromModuleRef(
  ref: PanelGridModuleRef,
  panel: Panel,
  project: ProjectWithOptionalV2Electrical | null
): string | null {
  if (!project) return null
  if (ref.kind === 'protection') {
    const pr = findProtectionByIdInPanel(panel, ref.id)
    const first = pr?.circuits?.[0]
    return first?.id ?? null
  }
  if (ref.kind === 'trunkDevice' && ref.scope === 'circuit' && ref.circuitId) return ref.circuitId
  if (ref.kind === 'domotica') return ref.circuitId
  return null
}
