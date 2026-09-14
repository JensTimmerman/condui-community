import type { Circuit, Panel, ProtectionDevice, WireSegment } from '@/types/schema'
import type { Selection } from '@/types/ui'
import type { LayoutNode, LayoutTree } from '@/lib/layout/layoutTree'
import { getMainBusOrder } from '@/lib/eendraad/mainBusOrder'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

/**
 * Returns the uppercase letter A–Z when `code` is exactly one alphabetic character; otherwise null.
 * Used for Shift+letter circuit focus (codes like "AA" do not match).
 */
export function singleLetterCircuitCode(code: string | null | undefined): string | null {
  const s = String(code ?? '').trim().toUpperCase()
  if (s.length !== 1 || s < 'A' || s > 'Z') return null
  return s
}

/** MCB/RCD directly to the left of a main-bus circuit in interleaved order, if any. */
function findMainBusProtectionForCircuit(panel: Panel, circuitId: string): ProtectionDevice | undefined {
  const order = getMainBusOrder(panel)
  const idx = order.findIndex((x) => x.type === 'circuit' && x.id === circuitId)
  if (idx <= 0) return undefined
  for (let i = idx - 1; i >= 0; i--) {
    const item = order[i]
    if (item?.type === 'protection') {
      return panel.protections.find((p) => p.id === item.id)
    }
  }
  return undefined
}

function walkPanelsDepthFirst(panel: Panel, visit: (p: Panel) => void): void {
  visit(panel)
  for (const sp of panel.subPanels ?? []) {
    walkPanelsDepthFirst(sp, visit)
  }
}

/**
 * All circuits whose code is a single letter matching `letter` (already A–Z), in stable depth-first panel order.
 */
export function listCircuitsWithSingleLetterCode(
  project: ProjectWithOptionalV2Electrical,
  letter: string,
): Circuit[] {
  const out: Circuit[] = []
  for (const root of getProjectElectricalPanels(project)) {
    walkPanelsDepthFirst(root, (panel) => {
      for (const c of panel.circuits) {
        if (c.code === 'PANEL') continue
        if (singleLetterCircuitCode(c.code) === letter) out.push(c)
      }
      for (const prot of panel.protections ?? []) {
        for (const c of prot.circuits ?? []) {
          if (singleLetterCircuitCode(c.code) === letter) out.push(c)
        }
      }
    })
  }
  return out
}

function collectCircuitTreeIds(circuitId: string, getCircuitById: (id: string) => Circuit | undefined, into: Set<string>): void {
  into.add(circuitId)
  const c = getCircuitById(circuitId)
  for (const sid of c?.subCircuitIds ?? []) {
    collectCircuitTreeIds(sid, getCircuitById, into)
  }
}

/**
 * Domain IDs on the layout tree (protection, endpoints, trunk devices, sub-panel symbol) for a circuit and its nested sub-circuits.
 */
export function collectCircuitFocusDomainIds(
  circuitId: string,
  getCircuitById: (id: string) => Circuit | undefined,
  getProtectionForCircuit: (id: string) => ProtectionDevice | undefined,
  findPanelForCircuit: (id: string) => Panel | undefined,
): Set<string> {
  const ids = new Set<string>()

  const visit = (cid: string) => {
    const c = getCircuitById(cid)
    if (!c) return

    let prot = getProtectionForCircuit(cid)
    if (!prot) {
      const panel = findPanelForCircuit(cid)
      if (panel) prot = findMainBusProtectionForCircuit(panel, cid)
    }
    if (prot) {
      ids.add(prot.id)
      if (prot.subPanelId) ids.add(prot.subPanelId)
    }

    for (const ep of c.endpoints) {
      ids.add(ep.id)
    }
    for (const td of c.trunkDevices ?? []) {
      ids.add(td.id)
    }

    for (const sid of c.subCircuitIds ?? []) {
      visit(sid)
    }
  }

  visit(circuitId)
  return ids
}

const LAYOUT_TYPES_FOR_FOCUS: Array<LayoutNode['type']> = ['endpoint', 'mcb', 'rcd', 'trunkDevice']

function visitLayoutForFocus(
  node: LayoutNode,
  domainIds: Set<string>,
  minMax: { minX: number; minY: number; maxX: number; maxY: number; found: boolean },
): void {
  if (
    node.domainId &&
    domainIds.has(node.domainId) &&
    LAYOUT_TYPES_FOR_FOCUS.includes(node.type)
  ) {
    const { x, y, width, height } = node.bounds
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      minMax.minX = Math.min(minMax.minX, x)
      minMax.minY = Math.min(minMax.minY, y)
      minMax.maxX = Math.max(minMax.maxX, x + width)
      minMax.maxY = Math.max(minMax.maxY, y + height)
      minMax.found = true
    }
  }
  for (const ch of node.children ?? []) {
    visitLayoutForFocus(ch, domainIds, minMax)
  }
}

/**
 * Bounding box in canvas coordinates for everything to show when focusing one circuit (wires + symbols).
 * Shared by eendraad fit-to-selection and future callers.
 */
export function computeEendraadCircuitFocusBounds(input: {
  rootCircuitId: string
  wireSegments: WireSegment[]
  layoutTree: LayoutTree | null
  getCircuitById: (id: string) => Circuit | undefined
  getProtectionForCircuit: (id: string) => ProtectionDevice | undefined
  findPanelForCircuit: (id: string) => Panel | undefined
}): { x: number; y: number; width: number; height: number } | null {
  const {
    rootCircuitId,
    wireSegments,
    layoutTree,
    getCircuitById,
    getProtectionForCircuit,
    findPanelForCircuit,
  } = input

  const circuitTreeIds = new Set<string>()
  collectCircuitTreeIds(rootCircuitId, getCircuitById, circuitTreeIds)

  const domainIds = collectCircuitFocusDomainIds(
    rootCircuitId,
    getCircuitById,
    getProtectionForCircuit,
    findPanelForCircuit,
  )

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false

  for (const ws of wireSegments) {
    if (!ws.circuitId || !circuitTreeIds.has(ws.circuitId)) continue
    for (const p of [ws.startPoint, ws.endPoint]) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
      found = true
    }
  }

  if (layoutTree) {
    const mm = { minX, minY, maxX, maxY, found }
    for (const panelNode of layoutTree.panels) {
      visitLayoutForFocus(panelNode, domainIds, mm)
    }
    minX = mm.minX
    minY = mm.minY
    maxX = mm.maxX
    maxY = mm.maxY
    found = found || mm.found
  }

  if (!found || !Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  const padding = 10
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  }
}

/**
 * Select a circuit on 1‑wire and trigger the same fit-to-view path as the toolbar / F key.
 */
export function applyEendraadCircuitFocus(input: {
  circuitId: string
  setSelection: (s: Selection) => void
  requestFitToView: (canvases: Array<'eendraad' | 'plan' | 'panel'>) => void
}): void {
  const { circuitId, setSelection, requestFitToView } = input
  setSelection({ type: 'circuit', ids: [circuitId] })
  requestFitToView(['eendraad'])
}

/**
 * Fit the one-wire canvas to a circuit’s bounds, then restore the previous selection (e.g. plan placement).
 * Uses two animation frames so fit runs after React applies circuit selection (EendraadCanvas fits on the next frame).
 */
export function requestEendraadCircuitFitThenRestoreSelection(input: {
  circuitId: string
  restoreSelection: Selection
  setSelection: (s: Selection) => void
  requestFitToView: (canvases: Array<'eendraad' | 'plan' | 'panel'>) => void
}): void {
  const { circuitId, restoreSelection, setSelection, requestFitToView } = input
  setSelection({ type: 'circuit', ids: [circuitId] })
  requestFitToView(['eendraad'])
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setSelection(restoreSelection)
    })
  })
}
