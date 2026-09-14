import type { Installation, Panel } from '@/types/schema'
import type { DisciplineModelsV2, ElectricalModelV2 } from '@/types/projectV2'
import type { AuxiliaryElectricalEnclosure, OffGridSupplyAssembly } from '@/types/supplyAssembly'

export type ProjectWithOptionalV2Electrical = {
  disciplines?: Partial<DisciplineModelsV2>
}

/** Canonical electrical discipline query. Legacy inputs must normalize before calling this API. */
export function getProjectElectrical(
  document: ProjectWithOptionalV2Electrical
): ElectricalModelV2 | undefined {
  return document.disciplines?.electrical
}

/** Canonical installation query for ordinary runtime consumers. */
export function getProjectElectricalInstallation(
  document: ProjectWithOptionalV2Electrical
): Installation | undefined {
  return getProjectElectrical(document)?.installation
}

/** Canonical panel-tree query for ordinary runtime consumers. */
export function getProjectElectricalPanels(document: ProjectWithOptionalV2Electrical): Panel[] {
  return getProjectElectrical(document)?.panels ?? []
}

/** Canonical mutable installation boundary for store/domain mutations. */
export function getEditableProjectElectricalInstallation(
  document: ProjectWithOptionalV2Electrical
): Installation | undefined {
  return getProjectElectrical(document)?.installation
}

/** Canonical mutable panel-tree boundary for store/domain mutations. */
export function getEditableProjectElectricalPanels(
  document: ProjectWithOptionalV2Electrical
): Panel[] {
  const electrical = getProjectElectrical(document)
  if (!electrical) throw new Error('Electrical discipline is required to edit panels.')
  return electrical.panels
}

/** @deprecated Ordinary runtime code uses getProjectElectricalInstallation. */
export const selectProjectElectricalInstallation = getProjectElectricalInstallation

/** @deprecated Ordinary runtime code uses getProjectElectricalPanels. */
export const selectProjectElectricalPanels = getProjectElectricalPanels

export function selectProjectSupplyAssemblies(
  document: ProjectWithOptionalV2Electrical
): OffGridSupplyAssembly[] {
  return document.disciplines?.electrical?.supplyAssemblies ?? []
}

export function selectProjectAuxiliaryElectricalEnclosures(
  document: ProjectWithOptionalV2Electrical
): AuxiliaryElectricalEnclosure[] {
  return document.disciplines?.electrical?.auxiliaryEnclosures ?? []
}

export function editProjectSupplyAssemblies(
  document: ProjectWithOptionalV2Electrical
): OffGridSupplyAssembly[] {
  const electrical = document.disciplines?.electrical
  if (!electrical) throw new Error('Electrical discipline is required to edit supply assemblies.')
  if (!Array.isArray(electrical.supplyAssemblies)) electrical.supplyAssemblies = []
  return electrical.supplyAssemblies
}

export function editProjectAuxiliaryElectricalEnclosures(
  document: ProjectWithOptionalV2Electrical
): AuxiliaryElectricalEnclosure[] {
  const electrical = document.disciplines?.electrical
  if (!electrical) {
    throw new Error('Electrical discipline is required to edit auxiliary enclosures.')
  }
  if (!Array.isArray(electrical.auxiliaryEnclosures)) electrical.auxiliaryEnclosures = []
  return electrical.auxiliaryEnclosures
}

/** @deprecated Ordinary runtime code uses getEditableProjectElectricalInstallation. */
export const editProjectElectricalInstallation = getEditableProjectElectricalInstallation

/** @deprecated Ordinary runtime code uses getEditableProjectElectricalPanels. */
export const editProjectElectricalPanels = getEditableProjectElectricalPanels
