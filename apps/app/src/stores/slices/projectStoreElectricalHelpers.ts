import { normalizeInstallationNominalVoltage } from '@/constants/nominalVoltage'
import {
  ensureLinkedSubPanelsHaveOwnPanelEndpoint,
  healPromotedIncomingProtectionGridRefs,
  normalizeDomoticaProject,
  normalizeFloorPlanAssets,
  removePanelGridDuplicateRefsInProject,
  removePromotedIncomingProtectionsFromSubPanels,
  pruneStalePanelGridProtectionReferencesInProject,
} from '@/lib/eendraad/projectElectricalDomain'
import { dedupeAllPanelsProtectionsInProject } from '@/lib/eendraad/mainBusOrder'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { healSupplyTrunkMisplacedOnMainGrid } from '@/lib/panel/healSupplyTrunkGrid'
import { reconcileInvalidPanelFeedOrganizationsInProject } from '@/lib/panel/panelFeedOrganization'
import { healEarthingSitplanPlacements } from '@/lib/plan/earthingSitplanPlacement'
import { healEnergyConversionSitplanPlacements } from '@/lib/plan/energyConversionSitplanPlacement'
import { healJunctionBoxSitplanPlacements } from '@/lib/plan/junctionBoxSitplanPlacement'
import { healProjectFloorsElectricalLayers } from '@/lib/plan/floorLayers'
import { healPlanWiring } from '@/lib/plan/planWiring'
import { syncPanelAndSituationPlanDeviceVisibility } from '@/lib/plan/panelPlanPlacementVisibility'
import { healSharedPlanScale } from '@/lib/projectV2/buildingFloors'
import {
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
  editProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import { projectToStoredProjectV2 } from '@/lib/projectV2/migration'
import { hasLegacyV2ProjectBloat } from '@/lib/projectV2/sanitizeLegacyV2Project'
import { logOrphanReport } from '@/lib/validation/orphanDetection'
import { healSupplyTrunkProtectionBreakingCapacity } from '@/lib/protectionDefaults'
import { recordSessionAction } from '@/lib/diagnostics/sessionActionLog'
import {
  healSourceChangeoverFeedScope,
  initializeDirectConverterPanelBranches,
  reconcileDirectConverterCommonLoadPath,
} from '@/lib/supplyAssembly/editorIntegration'
import { shortProjectIdLabel } from '@/utils/project'
import { logger } from '@/lib/logger'
import { summarizeConverterDcPersistence } from '@/lib/supplyAssembly/persistenceDiagnostics'
import {
  collectSupplyDeviceReferenceIssues,
  linkSupplyAssemblyDeviceReferences,
} from '@/lib/supplyAssembly/deviceReferences'
import { type Project, type ProjectInput, type ProjectState } from './projectStoreTypes'
import { findPanelById, findPanelByName } from '@/lib/panel/panelTree'

export { findPanelById, findPanelByName }

export function hydrateProjectForEditor(project: ProjectInput): {
  project: Project
  isDirty: boolean
} {
  const sanitizedLegacyV2Bloat = hasLegacyV2ProjectBloat(project)
  const runtimeProject = projectToStoredProjectV2(project) as Project
  const healedSharedPlanScale = healSharedPlanScale(runtimeProject)
  const installation = selectProjectElectricalInstallation(runtimeProject)
  const panels = selectProjectElectricalPanels(runtimeProject)
  if (installation) {
    ensureInstallationFeedTopology(installation, panels)
  }
  const healedSourceChangeoverFeedScope = healSourceChangeoverFeedScope(runtimeProject)
  const linkedSupplyAssemblyDeviceReferences = linkSupplyAssemblyDeviceReferences(runtimeProject)
  const initializedDirectBranches = editProjectSupplyAssemblies(runtimeProject).reduce(
    (changed, assembly) => initializeDirectConverterPanelBranches(runtimeProject, assembly) || changed,
    false
  )
  const reconciledPanelFeedOrganizations =
    reconcileInvalidPanelFeedOrganizationsInProject(runtimeProject)
  const normalizedNominalVoltage = installation
    ? normalizeInstallationNominalVoltage(installation)
    : false
  const healedSupplyProtectionBreakingCapacity =
    healSupplyTrunkProtectionBreakingCapacity(runtimeProject)
  const reconciledDirectSupplyOutputs = panels.reduce(
    (changed, panel) => reconcileDirectConverterCommonLoadPath(runtimeProject, panel.id) || changed,
    initializedDirectBranches
  )
  const healedSupplyGrid = healSupplyTrunkMisplacedOnMainGrid(runtimeProject)
  const dedupedProtections = dedupeAllPanelsProtectionsInProject(runtimeProject)
  const removedPromotedIncomingProtections =
    removePromotedIncomingProtectionsFromSubPanels(runtimeProject)
  const healedPromotedIncomingGridRefs = healPromotedIncomingProtectionGridRefs(runtimeProject)
  const healedLinkedSubPanelSymbols = ensureLinkedSubPanelsHaveOwnPanelEndpoint(runtimeProject)
  const removedDuplicatePanelGridRefs = removePanelGridDuplicateRefsInProject(runtimeProject)
  const prunedStalePanelGridProtectionRefs =
    pruneStalePanelGridProtectionReferencesInProject(runtimeProject)
  normalizeDomoticaProject(runtimeProject)
  normalizeFloorPlanAssets(runtimeProject)
  healProjectFloorsElectricalLayers(runtimeProject)
  const healedEarthingSitplan = healEarthingSitplanPlacements(runtimeProject)
  // Repair impossible legacy state before the conversion-placement healer makes
  // unclaimed conversion devices visible on the situation plan.
  const synchronizedPanelPlanVisibilityBeforePlacementHealing =
    syncPanelAndSituationPlanDeviceVisibility(runtimeProject)
  const healedEnergyConversionSitplan = healEnergyConversionSitplanPlacements(runtimeProject)
  const healedJunctionBoxSitplan = healJunctionBoxSitplanPlacements(runtimeProject)
  const synchronizedPanelPlanVisibility = syncPanelAndSituationPlanDeviceVisibility(runtimeProject)
  const healedPlanWiring = healPlanWiring(runtimeProject)
  recordSessionAction(
    `Opened project in editor (${shortProjectIdLabel(runtimeProject.project.id)})`
  )
  logOrphanReport(runtimeProject)
  const dcPersistenceSummary = summarizeConverterDcPersistence(runtimeProject)
  if (dcPersistenceSummary) {
    logger.debug('[SUPPLY-PERSIST] hydrated converter DC topology', dcPersistenceSummary)
  }
  const supplyDeviceReferenceIssues = collectSupplyDeviceReferenceIssues(runtimeProject)
  if (supplyDeviceReferenceIssues.length > 0) {
    logger.warn('[SUPPLY-PERSIST] supply device reference issues', supplyDeviceReferenceIssues)
  }

  return {
    project: runtimeProject,
    isDirty:
      sanitizedLegacyV2Bloat ||
      healedSourceChangeoverFeedScope ||
      linkedSupplyAssemblyDeviceReferences ||
      reconciledDirectSupplyOutputs ||
      reconciledPanelFeedOrganizations ||
      normalizedNominalVoltage ||
      healedSupplyProtectionBreakingCapacity ||
      healedSupplyGrid ||
      dedupedProtections ||
      removedPromotedIncomingProtections ||
      healedPromotedIncomingGridRefs ||
      healedLinkedSubPanelSymbols ||
      removedDuplicatePanelGridRefs ||
      prunedStalePanelGridProtectionRefs ||
      healedSharedPlanScale ||
      healedEarthingSitplan ||
      synchronizedPanelPlanVisibilityBeforePlacementHealing ||
      healedEnergyConversionSitplan ||
      healedJunctionBoxSitplan ||
      synchronizedPanelPlanVisibility ||
      healedPlanWiring,
  }
}

export function resetDisciplineSessionState(state: ProjectState): void {
  state.lastWorkedCircuitId = null
}

export function applyProjectMetadataUpdate(
  project: Project,
  updates: Partial<Project['project']>
): void {
  Object.assign(project.project, updates)
}

export function prepareProjectForPersistence(project: Project): void {
  const installation = selectProjectElectricalInstallation(project)
  if (installation) {
    ensureInstallationFeedTopology(installation, selectProjectElectricalPanels(project))
  }
  linkSupplyAssemblyDeviceReferences(project)
  healPlanWiring(project)
}

export * from '@/lib/eendraad/projectElectricalDomain'
