/**
 * Apply panel row count change: add/remove rows on the side opposite the feed.
 * When reducing rows, relocates modules in removed rows (adjacent row → first empty → overflow).
 */
import type { Panel, PanelGridSlot } from '@/types/schema'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { resolveModuleWidthCols } from './panelGridLayout'

const cellKey = (r: number, c: number) => `${r},${c}`

function buildOccupancy(slots: PanelGridSlot[], widthOf: (s: PanelGridSlot) => number): Set<string> {
  const used = new Set<string>()
  for (const s of slots) {
    const w = widthOf(s)
    for (let i = 0; i < w; i++) used.add(cellKey(s.row, s.col + i))
  }
  return used
}

function isFree(used: Set<string>, row: number, col: number, width: number): boolean {
  for (let i = 0; i < width; i++) {
    if (used.has(cellKey(row, col + i))) return false
  }
  return true
}

function findOnRow(used: Set<string>, row: number, startCol: number, width: number, cols: number): number | null {
  for (let c = startCol; c <= cols - width; c++) {
    if (isFree(used, row, c, width)) return c
  }
  return null
}

/** Rows in feed order: first row to fill (near feed), then next, ... */
function rowsInFeedOrder(newRows: number, feedFromTop: boolean): number[] {
  const out: number[] = []
  if (feedFromTop) {
    for (let r = 0; r < newRows; r++) out.push(r)
  } else {
    for (let r = newRows - 1; r >= 0; r--) out.push(r)
  }
  return out
}

export interface ApplyPanelRowChangeResult {
  slots: PanelGridSlot[]
}

/**
 * Compute new main-panel slots when row count changes from current to newRows.
 * - Add rows: opposite feed side; if feed from bottom, shift existing slot rows up.
 * - Remove rows: remove from opposite feed side; renumber kept slots; relocate evicted (adjacent row → first empty → overflow).
 */
export function applyPanelRowChange(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical | null,
  newRows: number
): ApplyPanelRowChangeResult {
  const grid = panel.gridView ?? { rows: 8, columns: 12, feedFromTop: false, slots: [] }
  const oldRows = grid.rows
  const cols = grid.columns ?? 12
  const feedFromTop = grid.feedFromTop ?? false
  const slots = grid.slots ?? []

  const widthOf = (s: PanelGridSlot) =>
    Math.min(cols, Math.max(1, resolveModuleWidthCols(s.module, project, s)))

  if (newRows === oldRows) {
    return { slots: [...slots] }
  }

  if (newRows > oldRows) {
    // Adding rows on the opposite side of the feed: no removal, only renumber when feed from bottom.
    if (feedFromTop) {
      // Add at bottom: no slot changes
      return { slots: [...slots] }
    }
    // Feed from bottom: add at top → shift all slot rows by (newRows - oldRows)
    const shift = newRows - oldRows
    const newSlots: PanelGridSlot[] = slots.map((s) => ({
      ...s,
      row: s.row + shift,
    }))
    return { slots: newSlots }
  }

  // Reducing rows: remove from opposite side of feed
  const removedCount = oldRows - newRows

  // Which row indices are kept (before renumbering)?
  // Feed from top: keep 0..newRows-1; removed = newRows..oldRows-1
  // Feed from bottom: keep (oldRows-newRows)..(oldRows-1); removed = 0..(oldRows-newRows-1)
  const keptSlots: PanelGridSlot[] = []
  const evicted: PanelGridSlot[] = []

  if (feedFromTop) {
    for (const s of slots) {
      if (s.row < newRows) {
        keptSlots.push({ ...s })
      } else {
        evicted.push({ ...s })
      }
    }
    // Kept rows stay 0..newRows-1; no renumbering
  } else {
    const firstKeptRow = removedCount
    for (const s of slots) {
      if (s.row >= firstKeptRow) {
        keptSlots.push({ ...s, row: s.row - removedCount })
      } else {
        evicted.push({ ...s })
      }
    }
  }

  if (evicted.length === 0) {
    return { slots: keptSlots }
  }

  // Adjacent row: the row next to the removed zone (last kept row when feed from top, first kept row when feed from bottom)
  const adjacentRow = feedFromTop ? newRows - 1 : 0
  const rowOrder = rowsInFeedOrder(newRows, feedFromTop)

  const used = buildOccupancy(keptSlots, widthOf)
  const newSlots = [...keptSlots]

  for (const s of evicted) {
    const w = widthOf(s)
    let placed = false

    // 1) Try adjacent row, same col (if fits)
    if (s.col + w <= cols && isFree(used, adjacentRow, s.col, w)) {
      newSlots.push({ ...s, row: adjacentRow, col: s.col })
      for (let i = 0; i < w; i++) used.add(cellKey(adjacentRow, s.col + i))
      placed = true
    }

    // 2) Try adjacent row, any col
    if (!placed) {
      const c = findOnRow(used, adjacentRow, 0, w, cols)
      if (c != null) {
        newSlots.push({ ...s, row: adjacentRow, col: c })
        for (let i = 0; i < w; i++) used.add(cellKey(adjacentRow, c + i))
        placed = true
      }
    }

    // 3) First empty row (in feed order) with a gap that fits
    if (!placed) {
      for (const r of rowOrder) {
        const c = findOnRow(used, r, 0, w, cols)
        if (c != null) {
          newSlots.push({ ...s, row: r, col: c })
          for (let i = 0; i < w; i++) used.add(cellKey(r, c + i))
          placed = true
          break
        }
      }
    }

    // 4) Emergency: assign (0, 0) so layout will displace and placeOverflow; do not mark used so layout handles collision
    if (!placed) {
      newSlots.push({ ...s, row: 0, col: 0 })
    }
  }

  return { slots: newSlots }
}
