import type {
  AcLinePhase,
  Circuit,
  Panel,
  PanelBusSection,
  ProtectionDevice,
} from '@/types/schema'
import { getMainBusOrder } from './mainBusOrder'

export const LEGACY_MAIN_BUS_SECTION_PREFIX = 'legacy-main-bus:'

/** Stable runtime identity for the implicit bus in projects without explicit sections. */
export function getLegacyMainBusSectionId(panel: Pick<Panel, 'id'>): string {
  return `${LEGACY_MAIN_BUS_SECTION_PREFIX}${panel.id}`
}

export function hasExplicitPanelBusSections(panel: Panel): boolean {
  return Array.isArray(panel.busSections) && panel.busSections.length > 0
}

export function getPrimaryPanelBusSectionId(panel: Panel): string {
  if (hasExplicitPanelBusSections(panel)) {
    const configured = panel.primaryBusSectionId
    if (configured && panel.busSections!.some((section) => section.id === configured)) {
      return configured
    }
    return panel.busSections![0]!.id
  }
  return getLegacyMainBusSectionId(panel)
}

/** Read explicit sections or project the legacy main bus without mutating the panel. */
export function getPanelBusSections(panel: Panel): PanelBusSection[] {
  if (hasExplicitPanelBusSections(panel)) return panel.busSections!
  return [
    {
      id: getLegacyMainBusSectionId(panel),
      label: '',
      role: 'normal',
      ...(panel.busbarPhases?.main ? { phaseOrder: panel.busbarPhases.main } : {}),
    },
  ]
}

export function findPanelBusSection(
  panel: Panel,
  busSectionId: string | undefined,
): PanelBusSection | undefined {
  const targetId = busSectionId ?? getPrimaryPanelBusSectionId(panel)
  return getPanelBusSections(panel).find((section) => section.id === targetId)
}

export function getProtectionBusSectionId(
  panel: Panel,
  protection: Pick<ProtectionDevice, 'busSectionId'>,
): string {
  return protection.busSectionId ?? getPrimaryPanelBusSectionId(panel)
}

export function getCircuitBusSectionId(
  panel: Panel,
  circuit: Pick<Circuit, 'busSectionId'>,
  parentProtection?: Pick<ProtectionDevice, 'busSectionId'>,
): string {
  return parentProtection
    ? getProtectionBusSectionId(panel, parentProtection)
    : circuit.busSectionId ?? getPrimaryPanelBusSectionId(panel)
}

/**
 * Resolve the bus section carried by the main-bus segment at an insertion slot.
 * Appending extends the last visible run; inserting at the start extends the
 * first run. This prevents a newly appended item from silently reverting to the
 * primary section when the bus currently ends in another feed section.
 */
export function getMainBusInsertionSectionId(
  panel: Panel,
  insertIndex: number | undefined,
  excludedItemIds: ReadonlySet<string> = new Set(),
): string | undefined {
  if (!hasExplicitPanelBusSections(panel)) return undefined
  const order = getMainBusOrder(panel).filter((item) => !excludedItemIds.has(item.id))
  if (order.length === 0) return getPrimaryPanelBusSectionId(panel)
  const index = Math.max(0, Math.min(insertIndex ?? order.length, order.length))
  const adjacent = index > 0 ? order[index - 1] : order[0]
  if (!adjacent) return getPrimaryPanelBusSectionId(panel)
  if (adjacent.type === 'protection') {
    const protection = panel.protections.find((candidate) => candidate.id === adjacent.id)
    return protection ? getProtectionBusSectionId(panel, protection) : undefined
  }
  const circuit = panel.circuits.find((candidate) => candidate.id === adjacent.id)
  return circuit ? getCircuitBusSectionId(panel, circuit) : undefined
}

export function getPanelBusSectionPhaseOrder(
  panel: Panel,
  busSectionId?: string,
): AcLinePhase[] | undefined {
  const section = findPanelBusSection(panel, busSectionId)
  if (section?.phaseOrder?.length) return section.phaseOrder
  if (getPrimaryPanelBusSectionId(panel) === (busSectionId ?? getPrimaryPanelBusSectionId(panel))) {
    return panel.busbarPhases?.main
  }
  return undefined
}

/**
 * Materialize an explicit split without changing electrical ownership or nesting.
 * Existing unassigned top-level items are attached to the new primary section.
 */
export function materializePanelBusSections(
  panel: Panel,
  sections: readonly [PanelBusSection, ...PanelBusSection[]],
  primaryBusSectionId: string = sections[0].id,
): Panel {
  if (!sections.some((section) => section.id === primaryBusSectionId)) {
    throw new Error(`Primary bus section ${primaryBusSectionId} is not part of panel ${panel.id}.`)
  }
  const primary = sections.find((section) => section.id === primaryBusSectionId)!
  const nextPrimary =
    primary.phaseOrder || !panel.busbarPhases?.main
      ? primary
      : { ...primary, phaseOrder: [...panel.busbarPhases.main] }
  const nextSections = sections.map((section) =>
    section.id === primaryBusSectionId ? nextPrimary : section,
  )
  return {
    ...panel,
    busSections: nextSections.map((section) => ({
      ...section,
      ...(section.phaseOrder ? { phaseOrder: [...section.phaseOrder] } : {}),
    })),
    primaryBusSectionId,
    protections: panel.protections.map((protection) => ({
      ...protection,
      busSectionId: protection.busSectionId ?? primaryBusSectionId,
    })),
    circuits: panel.circuits.map((circuit) => ({
      ...circuit,
      busSectionId: circuit.busSectionId ?? primaryBusSectionId,
    })),
  }
}
