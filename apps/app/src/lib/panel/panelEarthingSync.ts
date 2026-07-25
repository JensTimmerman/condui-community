import type { EarthingSystemType, Panel } from '@/types/schema'
import { findMainPanel } from '@/lib/panel/panelTree'

export function normalizeEarthingSystem(
  value: EarthingSystemType | undefined
): EarthingSystemType | undefined {
  return value ?? undefined
}

/**
 * A panel follows the main board earthing when unset or still equal to the main value.
 * Setting a different value on a secondary panel breaks sync until it matches main again.
 */
export function panelEarthingFollowsMain(
  panel: Panel,
  mainEarthing: EarthingSystemType | undefined
): boolean {
  const panelVal = normalizeEarthingSystem(panel.earthingSystem)
  if (panelVal === undefined) return true
  return panelVal === normalizeEarthingSystem(mainEarthing)
}

/** Whether a non-main panel should receive a cascade when the main earthing changes. */
export function shouldReceiveMainEarthingCascade(
  panel: Panel,
  mainPanelId: string,
  previousMainEarthing: EarthingSystemType | undefined
): boolean {
  if (panel.id === mainPanelId) return false
  const panelVal = normalizeEarthingSystem(panel.earthingSystem)
  if (panelVal === undefined) return true
  return panelVal === normalizeEarthingSystem(previousMainEarthing)
}

export function cascadeMainEarthingToPanels(
  panels: Panel[],
  mainPanel: Panel,
  newEarthing: EarthingSystemType | undefined,
  previousMainEarthing: EarthingSystemType | undefined
): void {
  const next = normalizeEarthingSystem(newEarthing)
  const visit = (list: Panel[]) => {
    for (const candidate of list) {
      if (shouldReceiveMainEarthingCascade(candidate, mainPanel.id, previousMainEarthing)) {
        if (next === undefined) {
          delete candidate.earthingSystem
        } else {
          candidate.earthingSystem = next
        }
      }
      visit(candidate.subPanels ?? [])
    }
  }
  visit(panels)
}

/** Earthing shown on diagrams and in properties when a panel follows the main board. */
export function resolveEffectiveEarthingSystem(
  panel: Panel,
  panels: Panel[]
): EarthingSystemType | undefined {
  const main = findMainPanel(panels)
  if (!main || panel.id === main.id) {
    return normalizeEarthingSystem(panel.earthingSystem)
  }
  if (panelEarthingFollowsMain(panel, main.earthingSystem)) {
    return normalizeEarthingSystem(main.earthingSystem)
  }
  return normalizeEarthingSystem(panel.earthingSystem)
}

/** Apply main panel earthing to a new sub-panel that has not been customized yet. */
export function inheritEarthingFromMainForNewPanel(panels: Panel[], panel: Panel): void {
  if (panel.isMain) return
  const main = findMainPanel(panels)
  if (!main || !panelEarthingFollowsMain(panel, main.earthingSystem)) return
  const mainEarthing = normalizeEarthingSystem(main.earthingSystem)
  if (mainEarthing === undefined) {
    delete panel.earthingSystem
  } else {
    panel.earthingSystem = mainEarthing
  }
}
