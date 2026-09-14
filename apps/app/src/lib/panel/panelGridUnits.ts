/** Fixed-point resolution used by panel-grid layout calculations. */
export const PANEL_GRID_UNITS_PER_MODULE = 12

/** Empty clearance between the panel frame and its overflow band. */
export const PANEL_GRID_OVERFLOW_GAP_MODULES = 3

export const MIN_PANEL_GRID_MODULE_WIDTH = 1 / PANEL_GRID_UNITS_PER_MODULE

/** Convert persisted/user-facing DIN-module measurements to exact layout units. */
export function panelModulesToGridUnits(modules: number): number {
  if (!Number.isFinite(modules)) return 0
  return Math.round(modules * PANEL_GRID_UNITS_PER_MODULE)
}

/** Convert internal fixed-point layout units back to DIN-module measurements. */
export function panelGridUnitsToModules(units: number): number {
  if (!Number.isFinite(units)) return 0
  return Math.round(units) / PANEL_GRID_UNITS_PER_MODULE
}

/** Normalize a module measurement to the supported 1/12-module grid. */
export function normalizePanelModuleMeasure(modules: number): number {
  return panelGridUnitsToModules(panelModulesToGridUnits(modules))
}

export function snapTerminalStripWidth(modules: number, maxModules: number): number {
  const rawUnits = panelModulesToGridUnits(modules)
  const maxUnits = Math.max(2, panelModulesToGridUnits(maxModules))
  const allowedBelowOne = [2, 3, 4, 6, 8, 10, 12]
  const allowed = [...allowedBelowOne]
  for (let units = 14; units <= Math.min(24, maxUnits); units += 2) allowed.push(units)
  for (let units = 30; units <= maxUnits; units += 6) allowed.push(units)
  const candidates = allowed.filter((units) => units <= maxUnits)
  const snapped = candidates.reduce(
    (best, units) => (Math.abs(units - rawUnits) < Math.abs(best - rawUnits) ? units : best),
    candidates[0] ?? 2
  )
  return panelGridUnitsToModules(snapped)
}
