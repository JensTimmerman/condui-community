import type { Installation, Panel } from '@/types/schema'
import type { DisciplineModelsV2 } from '@/types/projectV2'
import type {
  AuxiliaryElectricalEnclosure,
  OffGridSupplyAssembly,
} from '@/types/supplyAssembly'

export type ProjectWithOptionalV2Electrical = {
  installation?: Installation
  panels?: Panel[]
  disciplines?: Partial<DisciplineModelsV2>
}

const EMPTY_PANELS: Panel[] = []
const EMPTY_SUPPLY_ASSEMBLIES: OffGridSupplyAssembly[] = []
const EMPTY_AUXILIARY_ENCLOSURES: AuxiliaryElectricalEnclosure[] = []

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

export function getSupplyAssembliesFromProject(
  document: ProjectWithOptionalV2Electrical
): OffGridSupplyAssembly[] {
  return document.disciplines?.electrical?.supplyAssemblies ?? EMPTY_SUPPLY_ASSEMBLIES
}

export function getAuxiliaryElectricalEnclosuresFromProject(
  document: ProjectWithOptionalV2Electrical
): AuxiliaryElectricalEnclosure[] {
  return document.disciplines?.electrical?.auxiliaryEnclosures ?? EMPTY_AUXILIARY_ENCLOSURES
}

export function getMutableSupplyAssembliesForProject(
  document: ProjectWithOptionalV2Electrical
): OffGridSupplyAssembly[] {
  const electrical = document.disciplines?.electrical
  if (!electrical) throw new Error('Electrical discipline is required to edit supply assemblies.')
  if (!Array.isArray(electrical.supplyAssemblies)) electrical.supplyAssemblies = []
  return electrical.supplyAssemblies
}

export function getMutableAuxiliaryElectricalEnclosuresForProject(
  document: ProjectWithOptionalV2Electrical
): AuxiliaryElectricalEnclosure[] {
  const electrical = document.disciplines?.electrical
  if (!electrical) {
    throw new Error('Electrical discipline is required to edit auxiliary enclosures.')
  }
  if (!Array.isArray(electrical.auxiliaryEnclosures)) electrical.auxiliaryEnclosures = []
  return electrical.auxiliaryEnclosures
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
