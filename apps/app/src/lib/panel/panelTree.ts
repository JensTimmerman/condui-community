import type { Circuit, Panel } from '@/types/schema'

export function* walkPanels(panels: readonly Panel[]): Generator<Panel> {
  for (const panel of panels) {
    yield panel
    yield* walkPanels(panel.subPanels ?? [])
  }
}

export function findPanelById(
  panels: readonly Panel[] | undefined,
  id: string | null | undefined
): Panel | undefined {
  if (!id) return undefined
  for (const panel of walkPanels(panels ?? [])) {
    if (panel.id === id) return panel
  }
  return undefined
}

export function findPanelByName(
  panels: readonly Panel[] | undefined,
  name: string | null | undefined
): Panel | undefined {
  if (!name) return undefined
  for (const panel of walkPanels(panels ?? [])) {
    if (panel.name === name) return panel
  }
  return undefined
}

export function collectCircuits(panel: Panel): Circuit[] {
  const seen = new Set<string>()
  const circuits: Circuit[] = []

  const add = (circuit: Circuit) => {
    if (circuit.code === 'PANEL' || seen.has(circuit.id)) return
    seen.add(circuit.id)
    circuits.push(circuit)
  }

  for (const circuit of panel.circuits ?? []) add(circuit)
  for (const protection of panel.protections ?? []) {
    for (const circuit of protection.circuits ?? []) add(circuit)
  }

  return circuits
}

/**
 * Last real circuit owned by this exact panel. Subpanel circuits are deliberately excluded:
 * a module placed on one panel must never be persisted against another panel's circuit.
 */
export function getLastAssignableCircuit(panel: Panel): Circuit | undefined {
  const circuits = collectCircuits(panel)
  return circuits[circuits.length - 1]
}

export function findMainPanel(panels: readonly Panel[] | undefined): Panel | undefined {
  const walked = [...walkPanels(panels ?? [])]
  return walked.find((panel) => panel.isMain) ?? walked[0]
}
