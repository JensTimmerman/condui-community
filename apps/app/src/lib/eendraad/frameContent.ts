import type { Circuit, Frame, FrameContentItem, FrameTrunkSpan, Panel, TrunkDevice } from '@/types/schema'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import {
  editOneWireFrames,
  type AnnotationProject,
  replaceOneWireFrames,
} from '@/lib/projectV2/annotations'

type FrameContentProject = ProjectWithOptionalV2Electrical & AnnotationProject

export type ResolvedFrameItemKind = 'endpoint' | 'protection' | 'trunkDevice' | 'ground' | 'panelSymbol'

export interface ResolvedFrameItem {
  id: string
  kind: ResolvedFrameItemKind
}

function findCircuitInPanel(panel: Panel, circuitId: string): Circuit | undefined {
  const direct = panel.circuits.find((c) => c.id === circuitId)
  if (direct) return direct
  for (const protection of panel.protections) {
    if (protection.circuits) {
      const c = protection.circuits.find((x) => x.id === circuitId)
      if (c) return c
    }
  }
  for (const subPanel of panel.subPanels) {
    const c = findCircuitInPanel(subPanel, circuitId)
    if (c) return c
  }
  return undefined
}

export function findCircuitInProject(project: ProjectWithOptionalV2Electrical, circuitId: string): Circuit | undefined {
  for (const panel of getProjectElectricalPanels(project)) {
    const c = findCircuitInPanel(panel, circuitId)
    if (c) return c
  }
  return undefined
}

function sortedTrunkDevices(circuit: Circuit) {
  return [...(circuit.trunkDevices ?? [])].sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
}

/** All circuit trunk devices whose trunkPosition lies in [minP, maxP] (inclusive), after normalizing min/max. */
export function expandTrunkSpan(circuit: Circuit, minP: number, maxP: number): ResolvedFrameItem[] {
  const lo = Math.min(minP, maxP)
  const hi = Math.max(minP, maxP)
  return sortedTrunkDevices(circuit)
    .filter((d) => {
      const p = d.trunkPosition ?? 0
      return p >= lo && p <= hi
    })
    .map((d) => ({ id: d.id, kind: 'trunkDevice' as const }))
}

/**
 * Resolved membership for a frame: legacy contentIds/contentType, optional contentItems,
 * and trunkSpans (dynamic inclusion of all circuit trunk devices between min/max positions per circuit).
 */
export function resolveFrameContentItems(
  frame: Frame,
  project: ProjectWithOptionalV2Electrical | null | undefined
): ResolvedFrameItem[] {
  if (!project) return []
  const seen = new Set<string>()
  const out: ResolvedFrameItem[] = []
  const push = (id: string, kind: ResolvedFrameItemKind) => {
    if (seen.has(id)) return
    seen.add(id)
    out.push({ id, kind })
  }

  const hasSpans = (frame.trunkSpans?.length ?? 0) > 0
  const hasItems = (frame.contentItems?.length ?? 0) > 0

  if (!hasSpans && !hasItems) {
    if (frame.contentType === 'ground') {
      for (const id of frame.contentIds) push(id, 'ground')
    } else if (frame.contentType === 'mixed' && frame.contentIds.length > 0) {
      // Defensive: treat unknown mixed legacy as endpoint ids (should not occur)
      for (const id of frame.contentIds) push(id, 'endpoint')
    } else {
      const k = frame.contentType as ResolvedFrameItemKind
      for (const id of frame.contentIds) push(id, k)
    }
    return out
  }

  for (const item of frame.contentItems ?? []) {
    push(item.id, item.kind)
  }

  for (const span of frame.trunkSpans ?? []) {
    const circuit = findCircuitInProject(project, span.circuitId)
    if (!circuit) continue
    for (const it of expandTrunkSpan(circuit, span.minTrunkPosition, span.maxTrunkPosition)) {
      push(it.id, it.kind)
    }
  }

  return out
}

export function syncFrameContentIds(
  frame: Frame,
  project: ProjectWithOptionalV2Electrical | null | undefined
): string[] {
  return resolveFrameContentItems(frame, project).map((x) => x.id)
}

export interface PruneEendraadFramesOptions {
  /** Endpoint, protection, trunk device, or ground symbol ids removed from the project */
  removedMemberIds?: Iterable<string>
  /** Circuits removed (drops trunkSpans that reference them) */
  removedCircuitIds?: Iterable<string>
}

/** Ids to drop from frames when a circuit is deleted (endpoints, trunk devices, and the circuit itself for spans). */
export function collectCircuitFrameRemovalIds(circuit: Circuit): {
  memberIds: string[]
  circuitIds: string[]
} {
  const memberIds: string[] = []
  for (const ep of circuit.endpoints) memberIds.push(ep.id)
  for (const td of circuit.trunkDevices ?? []) memberIds.push(td.id)
  for (const branch of circuit.branches ?? []) {
    for (const td of branch.branchDevices ?? []) memberIds.push(td.id)
  }
  return { memberIds, circuitIds: [circuit.id] }
}

/**
 * Remove stale frame references after deletions. Drops frames that no longer contain any resolved members.
 */
export function pruneEendraadFrames(project: FrameContentProject, options: PruneEendraadFramesOptions): boolean {
  const memberIds = new Set(options.removedMemberIds ?? [])
  const circuitIds = new Set(options.removedCircuitIds ?? [])
  if (memberIds.size === 0 && circuitIds.size === 0) return false

  const frames = editOneWireFrames(project)
  if (!frames?.length) return false

  let changed = false
  const kept: Frame[] = []

  for (const frame of frames) {
    let frameChanged = false

    if (memberIds.size > 0 && frame.contentIds.length > 0) {
      const next = frame.contentIds.filter((id) => !memberIds.has(id))
      if (next.length !== frame.contentIds.length) {
        frame.contentIds = next
        frameChanged = true
      }
    }

    if (memberIds.size > 0 && frame.contentItems?.length) {
      const next = frame.contentItems.filter((item) => !memberIds.has(item.id))
      if (next.length !== frame.contentItems.length) {
        frame.contentItems = next.length > 0 ? next : undefined
        frameChanged = true
      }
    }

    if (circuitIds.size > 0 && frame.trunkSpans?.length) {
      const next = frame.trunkSpans.filter((span) => !circuitIds.has(span.circuitId))
      if (next.length !== frame.trunkSpans.length) {
        frame.trunkSpans = next.length > 0 ? next : undefined
        frameChanged = true
      }
    }

    if (frame.contentItems || frame.trunkSpans) {
      const synced = syncFrameContentIds(frame, project)
      if (
        synced.length !== frame.contentIds.length ||
        synced.some((id, i) => id !== frame.contentIds[i])
      ) {
        frame.contentIds = synced
        frameChanged = true
      }
    }

    if (resolveFrameContentItems(frame, project).length === 0) {
      changed = true
      continue
    }

    if (frameChanged) changed = true
    kept.push(frame)
  }

  if (kept.length !== frames.length) changed = true
  if (changed) {
    replaceOneWireFrames(project, kept.length > 0 ? kept : [])
  }
  return changed
}

type TrunkDeviceLookup = (deviceId: string) =>
  | { device: TrunkDevice; circuit: Circuit | null; isSupplyDevice?: boolean; isGroundDevice?: boolean }
  | undefined

export interface ClassifiedFrameSelection {
  protectionIds: string[]
  endpointIds: string[]
  trunkDeviceIds: string[]
  hasGround: boolean
}

/**
 * Build frame fields from a multi-selection. Uses trunkSpans for circuit trunk devices so new devices
 * inserted between the min/max trunk positions on each circuit are included automatically.
 */
export function buildFrameFieldsFromClassifiedSelection(
  classified: ClassifiedFrameSelection,
  getTrunkDeviceById: TrunkDeviceLookup,
  project: ProjectWithOptionalV2Electrical,
): Pick<Frame, 'contentType' | 'contentIds' | 'contentItems' | 'trunkSpans'> {
  const contentItems: FrameContentItem[] = []
  const spanByCircuit = new Map<string, { min: number; max: number }>()

  if (classified.hasGround) {
    contentItems.push({ id: 'ground', kind: 'ground' })
  }
  for (const id of classified.endpointIds) {
    contentItems.push({ id, kind: 'endpoint' })
  }
  for (const id of classified.protectionIds) {
    contentItems.push({ id, kind: 'protection' })
  }

  for (const id of classified.trunkDeviceIds) {
    const r = getTrunkDeviceById(id)
    if (!r) continue
    if (r.isSupplyDevice || r.isGroundDevice || !r.circuit) {
      contentItems.push({ id, kind: 'trunkDevice' })
      continue
    }
    const pos = r.device.trunkPosition ?? 0
    const cid = r.circuit.id
    const cur = spanByCircuit.get(cid)
    if (!cur) spanByCircuit.set(cid, { min: pos, max: pos })
    else {
      cur.min = Math.min(cur.min, pos)
      cur.max = Math.max(cur.max, pos)
    }
  }

  const trunkSpans: FrameTrunkSpan[] = [...spanByCircuit.entries()].map(([circuitId, { min, max }]) => ({
    circuitId,
    minTrunkPosition: min,
    maxTrunkPosition: max,
  }))

  const hasExplicit = contentItems.length > 0
  const hasSpans = trunkSpans.length > 0

  let contentType: Frame['contentType']
  if (hasExplicit && hasSpans) {
    contentType = 'mixed'
  } else if (hasSpans && !hasExplicit) {
    contentType = 'trunkDevice'
  } else if (hasExplicit && !hasSpans) {
    const kinds = new Set(contentItems.map((c) => c.kind))
    if (kinds.size === 1) {
      contentType = contentItems[0]!.kind
    } else {
      contentType = 'mixed'
    }
  } else {
    contentType = 'endpoint'
  }

  // Minimal legacy-compatible shape when a single kind and no dynamic spans
  if (!hasSpans && hasExplicit && contentType !== 'mixed') {
    const ids = contentItems.map((c) => c.id)
    return {
      contentType,
      contentIds: ids,
      contentItems: undefined,
      trunkSpans: undefined,
    }
  }

  const provisional: Frame = {
    id: '__tmp__',
    title: '',
    fontSize: 10,
    titlePosition: 'inside',
    panelId: '',
    contentType,
    contentIds: [],
    contentItems: hasExplicit ? contentItems : undefined,
    trunkSpans: hasSpans ? trunkSpans : undefined,
  }

  return {
    contentType,
    contentIds: syncFrameContentIds(provisional, project),
    contentItems: hasExplicit ? contentItems : undefined,
    trunkSpans: hasSpans ? trunkSpans : undefined,
  }
}

/** Minimal layout slice used to map eendraad elements to their panel. */
export interface EendraadLayoutForFramePanel {
  panels: Array<{
    panel: { id: string }
    elements: Array<{
      type: string
      endpointId?: string
      protectionId?: string
      trunkDeviceId?: string
    }>
    groundPosition?: unknown
  }>
}

/** Returns the common panel id for all frameable members, or undefined if ambiguous / not found. */
export function resolveEendraadFramePanelIdForSelection(
  layout: EendraadLayoutForFramePanel | null | undefined,
  classified: ClassifiedFrameSelection,
): string | undefined {
  if (!layout?.panels?.length) return undefined
  const panelIds = new Set<string>()
  if (classified.hasGround) {
    const pl = layout.panels.find((p) => p.groundPosition)
    if (pl) panelIds.add(pl.panel.id)
  }
  for (const id of classified.endpointIds) {
    const pl = layout.panels.find((p) => p.elements.some((e) => e.type === 'endpoint' && e.endpointId === id))
    if (pl) panelIds.add(pl.panel.id)
  }
  for (const id of classified.protectionIds) {
    const pl = layout.panels.find((p) =>
      p.elements.some((e) => (e.type === 'protection' || e.type === 'rcd') && e.protectionId === id),
    )
    if (pl) panelIds.add(pl.panel.id)
  }
  for (const id of classified.trunkDeviceIds) {
    const pl = layout.panels.find((p) => p.elements.some((e) => e.type === 'trunkDevice' && e.trunkDeviceId === id))
    if (pl) panelIds.add(pl.panel.id)
  }
  if (panelIds.size !== 1) return undefined
  return [...panelIds][0]!
}
