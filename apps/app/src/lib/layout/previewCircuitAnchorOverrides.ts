import { getBranchProtectionAnchorOffset } from './bottomUpBranchPass'
import {
  getPanelDiagramId,
  LAYOUT_CONSTANTS,
  type BottomUpCircuitLayout,
  type BottomUpLayoutResult,
} from './bottomUpLayout'

function circuitAnchorX(circuit: BottomUpCircuitLayout): number {
  return (
    circuit.x +
    getBranchProtectionAnchorOffset(circuit.leftReserve, {
      PROTECTION_WIDTH: LAYOUT_CONSTANTS.PROTECTION_WIDTH,
      SYMBOL_SIZE: LAYOUT_CONSTANTS.SYMBOL_SIZE,
    })
  )
}

/**
 * Keep existing top-level circuit trunks stationary while a hypothetical drop
 * is being previewed. The simulated envelope may grow around the target, but
 * it must not make every existing trunk appear as a displaced ghost before the
 * user commits the change.
 */
export function buildStablePreviewCircuitOverrides(
  currentLayout: BottomUpLayoutResult,
  previewLayout: BottomUpLayoutResult,
  baseOverrides: ReadonlyMap<string, { x: number; y: number }>,
  affectedPanelIds: readonly string[]
): Map<string, { x: number; y: number }> {
  const result = new Map(baseOverrides)
  const affectedPanels = new Set(affectedPanelIds)

  for (const previewPanel of previewLayout.panels) {
    if (previewPanel.frameRole === 'supply' || !affectedPanels.has(previewPanel.panel.id)) continue
    const currentPanel = currentLayout.panels.find(
      (candidate) =>
        candidate.frameRole !== 'supply' &&
        candidate.panel.id === previewPanel.panel.id &&
        getPanelDiagramId(candidate) === getPanelDiagramId(previewPanel)
    )
    if (!currentPanel) continue

    for (const previewCircuit of previewPanel.circuits) {
      if (
        previewCircuit.parentCircuit ||
        previewCircuit.circuit.supplySource?.kind === 'converter-backup'
      ) {
        continue
      }
      const currentCircuit = currentPanel.circuits.find(
        (candidate) =>
          candidate.circuit.id === previewCircuit.circuit.id && !candidate.parentCircuit
      )
      if (!currentCircuit) continue

      const currentAnchorFromBus = circuitAnchorX(currentCircuit) - currentPanel.mainBus.x
      const previewAnchorOffset = getBranchProtectionAnchorOffset(previewCircuit.leftReserve, {
        PROTECTION_WIDTH: LAYOUT_CONSTANTS.PROTECTION_WIDTH,
        SYMBOL_SIZE: LAYOUT_CONSTANTS.SYMBOL_SIZE,
      })
      const existing = result.get(`circuit-${previewCircuit.circuit.id}`)
      result.set(`circuit-${previewCircuit.circuit.id}`, {
        x: LAYOUT_CONSTANTS.LEFT_MARGIN + currentAnchorFromBus - previewAnchorOffset,
        y: existing?.y ?? previewCircuit.protectionY,
      })
    }
  }

  return result
}
