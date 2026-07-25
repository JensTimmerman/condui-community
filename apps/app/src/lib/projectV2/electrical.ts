import type { Installation, Panel } from '@/types/schema'
import type { DisciplineModelsV2 } from '@/types/projectV2'

export type ProjectWithOptionalV2Electrical = {
  installation?: Installation
  panels?: Panel[]
  disciplines?: Partial<DisciplineModelsV2>
}

const EMPTY_PANELS: Panel[] = []

function hasCompatibilityPanelsField(document: ProjectWithOptionalV2Electrical): boolean {
  return Object.prototype.hasOwnProperty.call(document, 'panels')
}

export function getElectricalInstallationFromProject(
  document: ProjectWithOptionalV2Electrical
): Installation | undefined {
  return document.disciplines?.electrical?.installation ?? document.installation
}

export function getElectricalPanelsFromProject(
  document: ProjectWithOptionalV2Electrical
): Panel[] {
  return document.disciplines?.electrical?.panels ?? document.panels ?? EMPTY_PANELS
}

export function getMutableElectricalInstallationForProject(
  document: ProjectWithOptionalV2Electrical
): Installation | undefined {
  return document.disciplines?.electrical?.installation ?? document.installation
}

export function getMutableElectricalPanelsForProject(
  document: ProjectWithOptionalV2Electrical
): Panel[] {
  const electrical = document.disciplines?.electrical
  if (electrical) {
    if (!Array.isArray(electrical.panels)) electrical.panels = []
    return electrical.panels
  }
  if (hasCompatibilityPanelsField(document)) {
    if (!document.panels) document.panels = []
    return document.panels
  }
  document.panels = []
  return document.panels
}
