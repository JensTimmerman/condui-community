import type { ProjectV2 } from '@/types/projectV2'
import type { Installation, Panel } from '@/types/schema'
import { normalizeInstallationNominalVoltage } from '@/constants/nominalVoltage'
import {
  ensureLinkedSubPanelsHaveOwnPanelEndpoint,
  healPromotedIncomingProtectionGridRefs,
  normalizeDomoticaProject,
  normalizeFloorPlanAssets,
  removePanelGridDuplicateRefsInProject,
  removePromotedIncomingProtectionsFromSubPanels,
} from '@/lib/eendraad/projectElectricalDomain'
import { dedupeAllPanelsProtectionsInProject } from '@/lib/eendraad/mainBusOrder'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { healSupplyTrunkMisplacedOnMainGrid } from '@/lib/panel/healSupplyTrunkGrid'
import { healEarthingSitplanPlacements } from '@/lib/plan/earthingSitplanPlacement'
import { healProjectFloorsElectricalLayers } from '@/lib/plan/floorLayers'
import { healPlanWiring } from '@/lib/plan/planWiring'
import {
  getMutableCompatibilityFloorsForProject,
  healSharedPlanScale,
} from '@/lib/projectV2/buildingFloors'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
} from '@/lib/projectV2/electrical'
import {
  projectToStoredProjectV2,
  stripLazyElementGraphForRuntime,
} from '@/lib/projectV2/migration'
import { hasLegacyV2ProjectBloat } from '@/lib/projectV2/sanitizeLegacyV2Project'
import { syncValidationFromCompatibility } from '@/lib/projectV2/validation'
import { logOrphanReport } from '@/lib/validation/orphanDetection'
import { healSupplyTrunkProtectionBreakingCapacity } from '@/lib/protectionDefaults'
import { recordSessionAction } from '@/lib/diagnostics/sessionActionLog'
import { shortProjectIdLabel } from '@/utils/project'
import { type Project, type ProjectInput, type ProjectState } from './projectStoreTypes'
import { findPanelById, findPanelByName } from '@/lib/panel/panelTree'

export { findPanelById, findPanelByName }

export function normalizeRuntimeProjectCompatibilityFields(project: ProjectV2): Project {
  const compatibilityProject = project as ProjectV2 & {
    installation?: Installation
    panels?: Panel[]
    floors?: unknown
  }
  const electrical = project.disciplines.electrical

  if (electrical) {
    if (Object.prototype.hasOwnProperty.call(compatibilityProject, 'installation') && compatibilityProject.installation) {
      electrical.installation = compatibilityProject.installation
    }
    if (Object.prototype.hasOwnProperty.call(compatibilityProject, 'panels') && compatibilityProject.panels) {
      electrical.panels = compatibilityProject.panels
    }
  }

  delete compatibilityProject.installation
  delete compatibilityProject.panels

  return project as Project
}

export function hydrateProjectForEditor(project: ProjectInput): {
  project: Project
  isDirty: boolean
} {
  const sanitizedLegacyV2Bloat = hasLegacyV2ProjectBloat(project)
  const runtimeProject = normalizeRuntimeProjectCompatibilityFields(projectToStoredProjectV2(project))
  getMutableCompatibilityFloorsForProject(runtimeProject)
  const healedSharedPlanScale = healSharedPlanScale(runtimeProject)
  const installation = getElectricalInstallationFromProject(runtimeProject)
  const panels = getElectricalPanelsFromProject(runtimeProject)
  if (installation) {
    ensureInstallationFeedTopology(installation, panels)
  }
  const normalizedNominalVoltage = installation
    ? normalizeInstallationNominalVoltage(installation)
    : false
  const healedSupplyProtectionBreakingCapacity =
    healSupplyTrunkProtectionBreakingCapacity(runtimeProject)
  const healedSupplyGrid = healSupplyTrunkMisplacedOnMainGrid(runtimeProject)
  const dedupedProtections = dedupeAllPanelsProtectionsInProject(runtimeProject)
  const removedPromotedIncomingProtections =
    removePromotedIncomingProtectionsFromSubPanels(runtimeProject)
  const healedPromotedIncomingGridRefs =
    healPromotedIncomingProtectionGridRefs(runtimeProject)
  const healedLinkedSubPanelSymbols = ensureLinkedSubPanelsHaveOwnPanelEndpoint(runtimeProject)
  const removedDuplicatePanelGridRefs = removePanelGridDuplicateRefsInProject(runtimeProject)
  normalizeDomoticaProject(runtimeProject)
  normalizeFloorPlanAssets(runtimeProject)
  healProjectFloorsElectricalLayers(runtimeProject)
  const healedEarthingSitplan = healEarthingSitplanPlacements(runtimeProject)
  const healedPlanWiring = healPlanWiring(runtimeProject)
  syncValidationFromCompatibility(runtimeProject)
  stripLazyElementGraphForRuntime(runtimeProject)
  recordSessionAction(
    `Opened project in editor (${shortProjectIdLabel(runtimeProject.project.id)})`
  )
  logOrphanReport(runtimeProject)

  return {
    project: runtimeProject,
    isDirty:
      sanitizedLegacyV2Bloat ||
      normalizedNominalVoltage ||
      healedSupplyProtectionBreakingCapacity ||
      healedSupplyGrid ||
      dedupedProtections ||
      removedPromotedIncomingProtections ||
      healedPromotedIncomingGridRefs ||
      healedLinkedSubPanelSymbols ||
      removedDuplicatePanelGridRefs ||
      healedSharedPlanScale ||
      healedEarthingSitplan ||
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
  const installation = getElectricalInstallationFromProject(project)
  if (installation) {
    ensureInstallationFeedTopology(installation, getElectricalPanelsFromProject(project))
  }
  healPlanWiring(project)
}


export * from '@/lib/eendraad/projectElectricalDomain'
