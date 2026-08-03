/**
 * Compute (x, y, width, height) in canvas coordinates for each module in panel grid view.
 */
import type { Panel, PanelGridConfig, PanelGridModuleRef, ProtectionDevice } from '@/types/schema'
import { findTrunkDeviceInProject } from '@/utils/project'
import { clamp } from '@/lib/geometry'
import {
  DEFAULT_PANEL_GRID_COLUMNS,
  DEFAULT_PANEL_GRID_ROWS,
} from '@/lib/panel/panelGridDefaults'
import {
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

export const CELL_W = 20  // Width of a single module slot
export const CELL_H = 80  // Height of a row / module body
export const ROW_GAP = 16  // Vertical gap between rows
export const ROW_STRIDE = CELL_H + ROW_GAP  // Total vertical step per row

export function getSupplyPanelRows(panel: Panel | null | undefined): number {
  return Math.max(1, panel?.gridView?.supplyPanelRows ?? 1)
}

export function getSupplyPanelColumns(panel: Panel | null | undefined): number {
  return Math.max(
    1,
    panel?.gridView?.supplyPanelColumns ??
      panel?.gridView?.columns ??
      DEFAULT_PANEL_GRID_COLUMNS
  )
}

/** Snap a pixel position to the nearest row/col. Boundary falls in middle of the gap. */
export function snapToGrid(px: number, py: number): { col: number; row: number } {
  return {
    col: Math.round(px / CELL_W),
    row: Math.floor((py + ROW_GAP / 2) / ROW_STRIDE),
  }
}

function polesFromPolesConfig(config: string | undefined): number {
  if (!config) return 1
  if (config === '4P' || config === '3P+N') return 4
  if (config === '3P') return 3
  if (config === '2P' || config === '1P+N') return 2
  return 1
}

function findProtectionRecursive(panels: Panel[], id: string): ProtectionDevice | null {
  for (const p of panels) {
    const pr = p.protections.find((x) => x.id === id)
    if (pr) return pr
    const inSub = findProtectionRecursive(p.subPanels ?? [], id)
    if (inSub) return inSub
  }
  return null
}

export function panelGridModuleRefKey(ref: PanelGridModuleRef): string {
  if (ref.kind === 'protection') return `protection:${ref.id}`
  if (ref.kind === 'trunkDevice') return `trunkDevice:${ref.id}:${ref.scope}${ref.circuitId ?? ''}`
  return `domotica:${ref.endpointId}:${ref.circuitId}`
}

/** True when this protection module sits in the supply panel strip (not the main grid). */
export function isProtectionOnSupplyPanel(panel: Panel | null | undefined, protectionId: string): boolean {
  if (!panel?.gridView) return false
  const key = panelGridModuleRefKey({ kind: 'protection', id: protectionId })
  return panel.gridView.supplyPanelSlots?.some((s) => panelGridModuleRefKey(s.module) === key) ?? false
}

/** Get pole-based width in columns (1P=1, 2P=2, etc.) */
export function getModuleWidthInCols(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical | null
): number {
  if (!project) return 1
  if (ref.kind === 'protection') {
    const pr = findProtectionRecursive(getElectricalPanelsFromProject(project), ref.id)
    if (pr) return Math.max(1, pr.poles ?? polesFromPolesConfig(pr.polesConfig))
  }
  if (ref.kind === 'trunkDevice') {
    const device = findTrunkDeviceInProject(project, ref.id)
    if (device) {
      if (device.poles != null) return Math.max(1, device.poles)
      if (device.polesConfig) return Math.max(1, polesFromPolesConfig(device.polesConfig))
      if (device.energyMeterProps?.poles != null) return Math.max(1, device.energyMeterProps.poles)
      if (device.energyMeterProps?.polesConfig) return Math.max(1, polesFromPolesConfig(device.energyMeterProps.polesConfig))
      return 1
    }
  }
  if (ref.kind === 'domotica') return 2
  return 1
}

/** Effective grid width: manual slot width when flagged, else pole-based columns. */
export function resolveModuleWidthCols(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical | null,
  slot?: { moduleWidth?: number; moduleWidthManual?: boolean },
): number {
  const poleBased = getModuleWidthInCols(ref, project)
  if (slot?.moduleWidthManual === true) {
    return Math.max(1, slot.moduleWidth ?? poleBased)
  }
  return poleBased
}

export interface ModulePlacement {
  ref: PanelGridModuleRef
  x: number
  y: number
  width: number
  height: number
  row: number
  col: number
  isOverflow?: boolean
}

export function getPanelGridPlacements(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical | null,
  modules: Array<{
    ref: PanelGridModuleRef
    slot?: { row: number; col: number; moduleWidth?: number; moduleWidthManual?: boolean }
  }>
): ModulePlacement[] {
  const config: PanelGridConfig = panel.gridView ?? {
    rows: DEFAULT_PANEL_GRID_ROWS,
    columns: DEFAULT_PANEL_GRID_COLUMNS,
    feedFromTop: false,
    slots: [],
  }
  const rows = config.rows
  const cols = config.columns
  const feedFromTop = config.feedFromTop

  const placements: ModulePlacement[] = []
  const gridUsed = new Map<string, boolean>()
  const cellKey = (r: number, c: number) => `${r},${c}`
  const mark = (r: number, c: number, w: number) => {
    for (let i = 0; i < w; i++) gridUsed.set(cellKey(r, c + i), true)
  }
  const isRowColFree = (r: number, c: number, w: number) => {
    for (let i = 0; i < w; i++) if (gridUsed.get(cellKey(r, c + i))) return false
    return true
  }

  const place = (ref: PanelGridModuleRef, row: number, col: number, w: number, isOverflow = false) => {
    mark(row, col, w)
    placements.push({
      ref,
      x: col * CELL_W,
      y: row * ROW_STRIDE,
      width: w * CELL_W,
      height: CELL_H,
      row,
      col,
      ...(isOverflow ? { isOverflow: true } : {}),
    })
  }

  /** Find first free position on a given row starting from startCol. */
  const findOnRow = (row: number, startCol: number, w: number): number | null => {
    for (let c = startCol; c <= cols - w; c++) {
      if (isRowColFree(row, c, w)) return c
    }
    return null
  }

  /** Find first available spot anywhere in the grid, searching outward from preferredRow. */
  const findAnySpot = (w: number, preferredRow?: number, skipRow?: number): { row: number; col: number } | null => {
    if (preferredRow != null) {
      for (let d = 0; d < rows; d++) {
        for (const r of d === 0 ? [preferredRow] : [preferredRow + d, preferredRow - d]) {
          if (r >= 0 && r < rows && r !== skipRow) {
            const c = findOnRow(r, 0, w)
            if (c != null) return { row: r, col: c }
          }
        }
      }
      return null
    }
    const startRow = feedFromTop ? 0 : rows - 1
    const step = feedFromTop ? 1 : -1
    for (let r = startRow; r >= 0 && r < rows; r += step) {
      const c = findOnRow(r, 0, w)
      if (c != null) return { row: r, col: c }
    }
    return null
  }

  const overflowStartCol = cols + 1
  const placeOverflow = (ref: PanelGridModuleRef, w: number) => {
    for (let r = 0; r < rows; r++) {
      for (let c = overflowStartCol; c < overflowStartCol + cols; c++) {
        if (isRowColFree(r, c, w)) { place(ref, r, c, w, true); return }
      }
    }
    place(ref, 0, overflowStartCol, w, true)
  }

  const widthOf = (ref: PanelGridModuleRef, slot?: { moduleWidth?: number; moduleWidthManual?: boolean }) =>
    Math.min(cols, Math.max(1, resolveModuleWidthCols(ref, project, slot)))

  // Separate slotted vs unslotted modules
  interface SlottedModule { ref: PanelGridModuleRef; preferredRow: number; preferredCol: number; width: number }
  const slotted: SlottedModule[] = []
  const unslotted: Array<{ ref: PanelGridModuleRef; width: number }> = []

  for (const { ref, slot } of modules) {
    const w = widthOf(ref, slot)
    if (slot != null) {
      slotted.push({
        ref,
        preferredRow: clamp(slot.row, 0, rows - 1),
        preferredCol: clamp(slot.col, 0, cols - w),
        width: w,
      })
    } else {
      unslotted.push({ ref, width: w })
    }
  }

  // Group slotted modules by preferred row, sorted by preferred col
  const rowGroups = new Map<number, SlottedModule[]>()
  for (const m of slotted) {
    if (!rowGroups.has(m.preferredRow)) rowGroups.set(m.preferredRow, [])
    rowGroups.get(m.preferredRow)!.push(m)
  }
  for (const group of rowGroups.values()) {
    group.sort((a, b) => a.preferredCol - b.preferredCol)
  }

  // Phase 1: Place slotted modules at their preferred column.
  // Manual placement is authoritative: we do not shift neighbors to make room.
  // If a module collides or doesn't fit on its row, it gets displaced.
  const displaced: SlottedModule[] = []

  for (let r = 0; r < rows; r++) {
    const group = rowGroups.get(r)
    if (!group) continue
    for (const m of group) {
      // Keep exact manual column when possible.
      if (isRowColFree(r, m.preferredCol, m.width)) {
        place(m.ref, r, m.preferredCol, m.width)
      } else {
        displaced.push(m)
      }
    }
  }

  // Phase 2: Place displaced modules on the nearest available row.
  // If nothing fits in the grid, overflow outside.
  for (const m of displaced) {
    const spot = findAnySpot(m.width, m.preferredRow, m.preferredRow)
    if (spot) {
      place(m.ref, spot.row, spot.col, m.width)
    } else {
      placeOverflow(m.ref, m.width)
    }
  }

  // Phase 3: Auto-place unslotted modules (new modules without stored positions)
  for (const m of unslotted) {
    const spot = findAnySpot(m.width)
    if (spot) {
      place(m.ref, spot.row, spot.col, m.width)
    } else {
      placeOverflow(m.ref, m.width)
    }
  }

  return placements
}

/**
 * Find best (row, col) for a new module of widthCols next to a parent placement.
 * Prefer same row as parent, as close as possible; then closest row with space; null = no space (eject).
 */
export function getPlacementForNewChildNextToParent(
  placements: ModulePlacement[],
  parentPl: ModulePlacement,
  widthCols: number,
  rows: number,
  cols: number,
  feedFromTop: boolean
): { row: number; col: number } | null {
  const cellKey = (r: number, c: number) => `${r},${c}`
  const used = new Set<string>()
  for (const p of placements) {
    const w = Math.max(1, Math.round(p.width / CELL_W))
    for (let i = 0; i < w; i++) used.add(cellKey(p.row, p.col + i))
  }
  const isFree = (r: number, c: number, w: number) => {
    for (let i = 0; i < w; i++) if (used.has(cellKey(r, c + i))) return false
    return true
  }
  const findOnRow = (row: number, startCol: number): number | null => {
    for (let c = startCol; c <= cols - widthCols; c++) {
      if (isFree(row, c, widthCols)) return c
    }
    return null
  }
  const parentW = Math.max(1, Math.round(parentPl.width / CELL_W))
  // 1) Same row: try left of parent, then right of parent
  const tryColLeft = parentPl.col - widthCols
  if (tryColLeft >= 0 && isFree(parentPl.row, tryColLeft, widthCols)) return { row: parentPl.row, col: tryColLeft }
  const tryColRight = parentPl.col + parentW
  if (tryColRight + widthCols <= cols && isFree(parentPl.row, tryColRight, widthCols)) return { row: parentPl.row, col: tryColRight }
  const onSameRow = findOnRow(parentPl.row, 0)
  if (onSameRow != null) return { row: parentPl.row, col: onSameRow }
  // 2) Closest row in feed order
  const rowOrder = feedFromTop
    ? Array.from({ length: rows }, (_, i) => i)
    : Array.from({ length: rows }, (_, i) => rows - 1 - i)
  for (const r of rowOrder) {
    const c = findOnRow(r, 0)
    if (c != null) return { row: r, col: c }
  }
  return null
}

/** Placements for the supply panel only. */
export function getSupplyPanelPlacements(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical | null,
  supplyModules: Array<{
    ref: PanelGridModuleRef
    slot?: { row: number; col: number; moduleWidth?: number; moduleWidthManual?: boolean }
  }>
): ModulePlacement[] {
  const rows = getSupplyPanelRows(panel)
  const cols = getSupplyPanelColumns(panel)
  const placements: ModulePlacement[] = []
  const used = new Set<string>()
  const cellKey = (row: number, col: number) => `${row},${col}`
  const isFree = (row: number, col: number, width: number) => {
    for (let i = 0; i < width; i++) {
      if (used.has(cellKey(row, col + i))) return false
    }
    return true
  }
  const mark = (row: number, col: number, width: number) => {
    for (let i = 0; i < width; i++) used.add(cellKey(row, col + i))
  }
  const findSpot = (width: number, preferredRow?: number, preferredCol?: number) => {
    const tryRow = (row: number, startCol: number) => {
      for (let col = startCol; col <= cols - width; col++) {
        if (isFree(row, col, width)) return { row, col }
      }
      return null
    }
    if (preferredRow != null && preferredRow >= 0 && preferredRow < rows) {
      if (preferredCol != null) {
        const col = clamp(preferredCol, 0, cols - width)
        if (isFree(preferredRow, col, width)) return { row: preferredRow, col }
      }
      const sameRow = tryRow(preferredRow, 0)
      if (sameRow) return sameRow
    }
    for (let row = 0; row < rows; row++) {
      if (row === preferredRow) continue
      const spot = tryRow(row, 0)
      if (spot) return spot
    }
    return null
  }

  for (const { ref, slot } of supplyModules) {
    const w = Math.min(cols, Math.max(1, resolveModuleWidthCols(ref, project, slot)))
    const preferredRow = slot?.row != null ? clamp(slot.row, 0, rows - 1) : undefined
    const preferredCol = slot?.col
    const spot = findSpot(w, preferredRow, preferredCol)
    if (!spot) continue
    mark(spot.row, spot.col, w)
    placements.push({
      ref,
      x: spot.col * CELL_W,
      y: spot.row * ROW_STRIDE,
      width: w * CELL_W,
      height: CELL_H,
      row: spot.row,
      col: spot.col,
    })
  }
  return placements
}
