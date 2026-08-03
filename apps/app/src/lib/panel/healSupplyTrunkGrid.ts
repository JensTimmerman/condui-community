/**
 * Shared supply-scope trunk modules must live in `gridView.supplyPanelSlots`, not main
 * `gridView.slots` (main panel only). Root-local supply devices are bus-side devices and
 * belong in the main panel body.
 */
import type { Panel, PanelGridModuleRef } from '@/types/schema'
import {
  getSupplyPanelColumns,
  getSupplyPanelRows,
  panelGridModuleRefKey,
  resolveModuleWidthCols,
} from '@/components/canvas/panel/panelGridLayout'
import { getPanelFeedProjection } from '@/lib/feedTopology'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import {
  DEFAULT_PANEL_GRID_COLUMNS,
  DEFAULT_PANEL_GRID_ROWS,
} from '@/lib/panel/panelGridDefaults'

function visitPanels(panels: Panel[], fn: (p: Panel) => void): void {
  for (const p of panels) {
    fn(p)
    visitPanels(p.subPanels ?? [], fn)
  }
}

function isSharedSupplyRef(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical,
  moduleRef: PanelGridModuleRef,
): boolean {
  if (!panel.isMain || moduleRef.kind !== 'trunkDevice' || moduleRef.scope !== 'supply') {
    return false
  }
  const installation = getElectricalInstallationFromProject(project)
  if (!installation) return false
  const projection = getPanelFeedProjection(installation, getElectricalPanelsFromProject(project), panel)
  const key = panelGridModuleRefKey(moduleRef)
  return (projection?.sharedFeed.trunkDevices ?? []).some(
    (device) => panelGridModuleRefKey({ kind: 'trunkDevice', id: device.id, scope: 'supply' }) === key,
  )
}

/**
 * Move one shared supply-scope trunk module from main grid slots into the supply strip if it still sits in `slots`.
 * Mirrors `ejectToSupplyPanel` placement rules. Returns true if state changed.
 */
export function ejectSupplyTrunkFromMainGridSlot(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical,
  moduleRef: PanelGridModuleRef,
): boolean {
  if (!panel.isMain || moduleRef.kind !== 'trunkDevice' || moduleRef.scope !== 'supply') return false
  if (!isSharedSupplyRef(panel, project, moduleRef)) return false
  if (!panel.gridView) {
    panel.gridView = {
      rows: DEFAULT_PANEL_GRID_ROWS,
      columns: DEFAULT_PANEL_GRID_COLUMNS,
      feedFromTop: false,
      slots: [],
    }
  }
  const key = panelGridModuleRefKey(moduleRef)
  const slots = panel.gridView.slots ?? []
  const removedSlot = slots.find((s) => panelGridModuleRefKey(s.module) === key)
  const newSlots = slots.filter((s) => panelGridModuleRefKey(s.module) !== key)
  if (!removedSlot || newSlots.length === slots.length) return false

  const supplySlots = [...(panel.gridView.supplyPanelSlots ?? [])]
  if (supplySlots.some((s) => panelGridModuleRefKey(s.module) === key)) {
    panel.gridView.slots = newSlots
    panel.gridView.supplyPanelSlots = supplySlots.length > 0 ? supplySlots : undefined
    return true
  }

  const rows = getSupplyPanelRows(panel)
  const cols = getSupplyPanelColumns(panel)
  const width = Math.max(
    1,
    Math.min(cols, resolveModuleWidthCols(moduleRef, project, removedSlot)),
  )
  let nextSpot: { row: number; col: number } | null = null
  for (let r = 0; r < rows && !nextSpot; r++) {
    for (let c = 0; c <= cols - width && !nextSpot; c++) {
      const collides = supplySlots.some((slot) => {
        if (slot.row !== r) return false
        const slotWidth = Math.max(
          1,
          Math.min(cols, resolveModuleWidthCols(slot.module, project, slot)),
        )
        return c < slot.col + slotWidth && slot.col < c + width
      })
      if (!collides) nextSpot = { row: r, col: c }
    }
  }
  if (!nextSpot) {
    return false
  }

  panel.gridView.slots = newSlots
  panel.gridView.supplyPanelSlots = [
    ...supplySlots,
    {
      row: nextSpot.row,
      col: nextSpot.col,
      ...(removedSlot.moduleWidthManual === true && removedSlot.moduleWidth != null
        ? { moduleWidth: removedSlot.moduleWidth, moduleWidthManual: true }
        : {}),
      module: moduleRef,
    },
  ]
  panel.gridView.supplyPanelVisible = true
  return true
}

/** Remove every shared supply-scope trunk slot from the main grid and place it on the supply strip (main panel). */
export function healSupplyTrunkMisplacedOnMainGridForPanel(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical,
): boolean {
  if (!panel.isMain || !panel.gridView?.slots?.length) return false
  let changed = false
  const misplaced = panel.gridView.slots.filter(
    (s) =>
      s.module.kind === 'trunkDevice' &&
      s.module.scope === 'supply' &&
      isSharedSupplyRef(panel, project, s.module),
  )
  for (const slot of misplaced) {
    if (slot.module.kind !== 'trunkDevice' || slot.module.scope !== 'supply') continue
    const ref: PanelGridModuleRef = { kind: 'trunkDevice', id: slot.module.id, scope: 'supply' }
    if (ejectSupplyTrunkFromMainGridSlot(panel, project, ref)) changed = true
  }
  return changed
}

/** Run {@link healSupplyTrunkMisplacedOnMainGridForPanel} on every panel tree node. */
export function healSupplyTrunkMisplacedOnMainGrid(project: ProjectWithOptionalV2Electrical): boolean {
  let changed = false
  visitPanels(getElectricalPanelsFromProject(project), (panel) => {
    if (healSupplyTrunkMisplacedOnMainGridForPanel(panel, project)) changed = true
  })
  return changed
}
