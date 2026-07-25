import type { Panel } from '@/types/schema'

/**
 * Helper function to count circuits directly in a panel (not including sub-panels)
 * Excludes the supply circuit feeding the panel itself
 */
export function countPanelCircuits(panel: Panel): number {
  let count = panel.circuits.length
  
  // Add circuits from protections
  for (const protection of panel.protections) {
    if (protection.circuits) {
      count += protection.circuits.length
    }
  }
  
  // Don't count circuits from sub-panels - only this panel's own circuits
  
  // Subtract 1 to exclude the supply circuit feeding this panel
  return Math.max(0, count - 1)
}
