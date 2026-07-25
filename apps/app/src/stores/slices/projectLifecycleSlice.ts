import { applyProjectMetadataUpdate, hydrateProjectForEditor, prepareProjectForPersistence, resetDisciplineSessionState } from './projectStoreElectricalHelpers'
import { appendUndoSnapshotInStore, clearStaleSelectionAfterProjectRestore, cloneProjectForHistory, collapseUndoGroupFromIndex, flushPendingProjectHistory, getProjectStoreApi, projectHistory } from './projectStoreHistory'
import type { Project, ProjectSliceCreator } from './projectStoreTypes'
import { saveProject } from '@/lib/db'
import { clearSessionActionLog, recordSessionAction } from '@/lib/diagnostics/sessionActionLog'
import { projectToStoredProjectV2 } from '@/lib/projectV2/migration'
import { viewportLayoutForPersistence } from '@/lib/viewport/viewportLayoutPersistence'
import { useUIStore } from '@/stores/uiStore'
import { logger } from '@/lib/logger'
import { supportsExtendedInstallationProfiles } from '@/lib/editionInstallationProfileCapabilities'
import { forceHouseholdInstallationProfile } from '@/lib/installationProfile'
import { getMutableElectricalInstallationForProject } from '@/lib/projectV2/electrical'

export const createProjectLifecycleSlice: ProjectSliceCreator = (set, get) => ({
    setProject: (project) =>
      set((state) => {
        const hydratedProject = hydrateProjectForEditor(project)
        if (!supportsExtendedInstallationProfiles(state.currentProjectStorageMode)) {
          forceHouseholdInstallationProfile(
            getMutableElectricalInstallationForProject(hydratedProject.project),
          )
        }
        state.currentProject = hydratedProject.project
        resetDisciplineSessionState(state)
        state.isDirty = hydratedProject.isDirty
        state.undoStack = []
        state.redoStack = []
        state.planFloorOverlayVisibleByBaseFloorId = {}
        state.planCanvasPlanImageOffsetByFloorId = {}
        clearSessionActionLog()
      }),

    setCurrentProjectStorageMode: (mode) =>
      set((state) => {
        state.currentProjectStorageMode = mode
        if (
          state.currentProject &&
          !supportsExtendedInstallationProfiles(mode) &&
          forceHouseholdInstallationProfile(
            getMutableElectricalInstallationForProject(state.currentProject),
          )
        ) {
          state.isDirty = true
        }
      }),

    touchProjectUpdatedAt: () =>
      set((state) => {
        if (!state.currentProject) return
        state.currentProject.project.updatedAt = new Date().toISOString()
      }),

    updateProject: (updates) =>
      set((state) => {
        if (state.currentProject) {
          applyProjectMetadataUpdate(state.currentProject, updates)
          state.currentProject.project.updatedAt = new Date().toISOString()
          state.isDirty = true
        }
      }),

    saveCurrentProject: async (options) => {
      const { currentProject, currentProjectStorageMode } = get()
      if (currentProject) {
        prepareProjectForPersistence(currentProject)
        const projectToSave: Project = {
          ...currentProject,
          project: {
            ...currentProject.project,
            lastViewportLayout: viewportLayoutForPersistence(useUIStore.getState().viewportLayout),
          },
        }
        await saveProject(projectToStoredProjectV2(projectToSave), {
          storageMode: currentProjectStorageMode,
          storageMetadata: options?.storageMetadata,
        })
        getProjectStoreApi().setState({ isDirty: false, lastSaved: new Date().toISOString() })
      }
    },

    undo: () => {
      flushPendingProjectHistory()
      const { currentProject, undoStack, redoStack } = get()
      if (!currentProject || undoStack.length === 0) {
        logger.info('[UNDO] no-op (empty history)')
        return
      }
      const currentSnapshot = cloneProjectForHistory(currentProject)
      logger.info('[UNDO] applying previous snapshot', {
        undoStackSize: undoStack.length,
        redoStackSize: redoStack.length,
        projectId: currentProject.project?.id,
        projectName: currentProject.project?.name,
      })
      projectHistory.skipNextSubscriberRun()
      projectHistory.runWithoutRecording(() => {
        set((state) => {
        if (!state.currentProject || state.undoStack.length === 0) return
        const previous = state.undoStack[state.undoStack.length - 1]
        if (!previous) return
        const newUndoStack = state.undoStack.slice(0, -1)
        state.currentProject = previous
        state.undoStack = newUndoStack
        state.redoStack = [...state.redoStack, currentSnapshot]
        state.isDirty = true
        })
      })
      clearStaleSelectionAfterProjectRestore()
      recordSessionAction('undo')
    },

    redo: () => {
      flushPendingProjectHistory()
      const { currentProject, undoStack, redoStack } = get()
      if (!currentProject || redoStack.length === 0) {
        logger.info('[REDO] no-op (empty history)')
        return
      }
      const currentSnapshot = cloneProjectForHistory(currentProject)
      logger.info('[REDO] applying next snapshot', {
        undoStackSize: undoStack.length,
        redoStackSize: redoStack.length,
        projectId: currentProject.project?.id,
        projectName: currentProject.project?.name,
      })
      projectHistory.skipNextSubscriberRun()
      projectHistory.runWithoutRecording(() => {
        set((state) => {
        if (!state.currentProject || state.redoStack.length === 0) return
        const next = state.redoStack[state.redoStack.length - 1]
        if (!next) return
        const newRedoStack = state.redoStack.slice(0, -1)
        state.currentProject = next
        state.redoStack = newRedoStack
        state.undoStack = [...state.undoStack, currentSnapshot]
        state.isDirty = true
        })
      })
      clearStaleSelectionAfterProjectRestore()
      recordSessionAction('redo')
    },

    withSingleUndoEntry: (fn, options) => {
      const projectBefore = get().currentProject
      if (!projectBefore) {
        return fn()
      }
      const snapshotBefore = cloneProjectForHistory(projectBefore)
      projectHistory.clearPending()
      let applied = false
      applied = projectHistory.runWithoutRecording(fn)
      const projectAfter = get().currentProject
      const projectChanged = projectAfter !== projectBefore
      if (applied || projectChanged) {
        appendUndoSnapshotInStore(set, snapshotBefore)
        if (options?.sessionLabel) {
          recordSessionAction(options.sessionLabel)
        }
      }
      return applied
    },

    collapseUndoGroupFromIndex: (startIndex) => {
      flushPendingProjectHistory()
      collapseUndoGroupFromIndex(startIndex)
    },

})
