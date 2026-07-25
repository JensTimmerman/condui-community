import type { Panel, Circuit } from '@/types/schema'
import {
  collectCircuits as collectPanelCircuits,
  walkPanels,
} from '@/lib/panel/panelTree'

/** Flatten top-level panels and nested sub-panels (distribution boards) for pickers. */
export function flattenPanels(panelList: Panel[]): Panel[] {
  const out: Panel[] = []
  for (const p of panelList) {
    out.push(p)
    if (p.subPanels?.length) out.push(...flattenPanels(p.subPanels))
  }
  return out
}

/**
 * Deduplicate circuits by id, keeping first occurrence.
 * Prevents React "duplicate key" warnings when the same circuit appears in multiple places
 * (e.g. panel.circuits and protection.circuits, or across panels).
 */
export function deduplicateCircuitsById(circuits: Circuit[]): Circuit[] {
  const seen = new Set<string>()
  return circuits.filter((c) => {
    if (seen.has(c.id)) return false
    seen.add(c.id)
    return true
  })
}

/**
 * Recursively collect all circuits from a panel, including circuits from protections and sub-panels.
 * Deduplicates by id so the result is safe for React keys.
 */
export const collectCircuits = (panel: Panel): Circuit[] =>
  deduplicateCircuitsById(
    [...walkPanels([panel])].flatMap((currentPanel) => collectPanelCircuits(currentPanel))
  )

/**
 * Check if a panel has any content (circuits, protections, or sub-panels)
 */
export function panelHasContent(panel: Panel): boolean {
  // Check direct circuits (excluding PANEL dummy circuits)
  const hasDirectCircuits = panel.circuits.some(c => c.code !== 'PANEL')
  
  // Check protections
  const hasProtections = panel.protections.length > 0
  
  // Check sub-panels
  const hasSubPanels = panel.subPanels.length > 0
  
  // Check circuits under protections
  const hasCircuitsUnderProtections = panel.protections.some(p => p.circuits && p.circuits.length > 0)
  
  return hasDirectCircuits || hasProtections || hasSubPanels || hasCircuitsUnderProtections
}

/**
 * Check if a panel is the last main panel in the project
 */
export function isLastMainPanel(panels: Panel[], _panelId: string): boolean {
  // Count all main panels recursively
  const countMainPanels = (panelList: Panel[]): number => {
    let count = 0
    for (const p of panelList) {
      if (p.isMain) count++
      count += countMainPanels(p.subPanels)
    }
    return count
  }
  
  const totalMainPanels = countMainPanels(panels)
  return totalMainPanels === 1
}
