import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Issue, ValidationProject } from '@/lib/validation/core/types'
import { getValidationSignature } from '@/lib/validation/validationTrigger'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import { logger } from '@/lib/logger'
import { useProjectStore } from '@/stores/projectStore'
import {
  validateProjectInWorker,
  validationWorkerSupported,
} from '@/lib/validation/validationWorkerClient'

type ValidatableProject = ValidationProject & {
  project: {
    id: string
  }
}

export type ValidationStatus = 'error' | 'warning' | 'ok'

type ValidationRunReason =
  | 'idle_signature_change'
  | 'manual_revalidate'
  | 'language_change'
  | 'unknown'

export interface ValidationState {
  issues: Issue[]
  status: ValidationStatus
  isLoading: boolean
  /** True when project changed since last completed validation. */
  isDirty: boolean
  /** Signature of the most recently completed validation run. */
  lastValidatedSignature: string | null
  /**
   * Signature that is currently in flight. Set by `validate` so signature
   * watchers know a validation is already running for this revision.
   */
  pendingSignature: string | null
  /** Latest observed signature (used to compute dirty state). */
  currentSignature: string | null
  lastValidatedProjectId: string | null
  lastProjectSnapshot: ValidatableProject | null

  // Actions
  setCurrentSignature: (signature: string) => void
  validate: (
    project: ValidatableProject,
    signature?: string,
    reason?: ValidationRunReason
  ) => Promise<void>
  /**
   * Records the canonical hydrated snapshot when a project is opened. The
   * mounted validation watcher performs the expensive run only after the
   * editor is idle and the user has stopped interacting.
   */
  markProjectOpened: () => void
  revalidate: () => void
  getStatus: () => ValidationStatus
  getErrorCount: () => number
  getWarningCount: () => number
}

/**
 * Compute validation status from issues
 */
function computeStatus(issues: Issue[]): ValidationStatus {
  const hasErrors = issues.some((i) => i.severity === 'error')
  if (hasErrors) return 'error'
  const hasWarnings = issues.some((i) => i.severity === 'warning')
  if (hasWarnings) return 'warning'
  return 'ok'
}

export const useValidationStore = create<ValidationState>()(
  immer((set, get) => ({
    issues: [],
    status: 'ok',
    isLoading: false,
    isDirty: false,
    lastValidatedSignature: null,
    pendingSignature: null,
    currentSignature: null,
    lastValidatedProjectId: null,
    lastProjectSnapshot: null,

    setCurrentSignature: (signature: string) => {
      set((state) => {
        const wasDirty = state.isDirty
        state.currentSignature = signature
        state.isDirty = state.lastValidatedSignature !== signature
        if (!wasDirty && state.isDirty) {
          logger.info('[Validation] marked dirty (signature changed)')
        }
      })
    },

    validate: async (
      project: ValidatableProject,
      signature?: string,
      reason: ValidationRunReason = 'unknown'
    ) => {
      const sig = signature ?? getValidationSignature(project)

      // Idempotent: skip if we have already validated this exact signature.
      // This prevents duplicate work when multiple triggers race (e.g. the
      // project-opened idle run and the signature watcher both queue up).
      const before = get()
      const forceRun = reason === 'manual_revalidate' || reason === 'language_change'
      if (
        !forceRun &&
        before.lastValidatedSignature === sig &&
        before.lastValidatedProjectId === project.project.id
      ) {
        logger.info('[Validation] skip (signature already validated)', {
          reason,
          projectId: project.project.id,
        })
        if (before.pendingSignature === sig) {
          set((state) => {
            state.pendingSignature = null
          })
        }
        return
      }

      logger.info('[Validation] full run start', {
        reason,
        projectId: project.project.id,
        dirty: get().lastValidatedSignature !== sig,
      })

      set((state) => {
        state.isLoading = true
        state.pendingSignature = sig
        state.currentSignature = sig
        state.lastProjectSnapshot = project
        state.isDirty = state.lastValidatedSignature !== sig
      })

      const validationStartedAt = import.meta.env.VITE_E2E ? performance.now() : 0
      const finishValidation = (issues: Issue[]) => {
        if (import.meta.env.VITE_E2E) {
          performance.measure('eendra:validation', {
            start: validationStartedAt,
            end: performance.now(),
          })
        }
        const status = computeStatus(issues)

        set((state) => {
          if (state.currentSignature !== sig) {
            if (state.pendingSignature === sig) {
              state.pendingSignature = null
              state.isLoading = false
            }
            return
          }
          state.issues = issues
          state.status = status
          state.isLoading = false
          state.lastValidatedProjectId = project.project.id
          state.lastProjectSnapshot = project
          state.lastValidatedSignature = sig
          state.currentSignature = sig
          state.isDirty = false
          if (state.pendingSignature === sig) state.pendingSignature = null
        })

        logger.info('[Validation] full run done', {
          reason,
          status,
          errors: issues.filter((i) => i.severity === 'error').length,
          warnings: issues.filter((i) => i.severity === 'warning').length,
        })
      }
      const failValidation = (error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          set((state) => {
            if (state.pendingSignature === sig) {
              state.pendingSignature = null
              state.isLoading = false
            }
          })
          return
        }
        logger.error('[Validation Store] Validation error:', error)
        trackGoogleAnalyticsEvent('validation_run_error', { reason })
        set((state) => {
          state.issues = []
          state.status = 'ok'
          if (state.pendingSignature === sig) {
            state.pendingSignature = null
            state.isLoading = false
          }
          // Keep dirty state as-is (project is still unvalidated).
        })
      }

      try {
        if (validationWorkerSupported()) {
          finishValidation(await validateProjectInWorker(project))
          return
        }

        // Non-browser environments load the fallback only when invoked. Keeping
        // these imports out of the startup graph prevents the full validator and
        // rule pack from inflating the interactive editor bundle.
        const [{ validateProject }, { beAreiBook1_2025 }, { loadRulePack }] = await Promise.all([
          import('@/lib/validation/core/engine'),
          import('@/lib/validation/rules/be/be.areibook1.2025'),
          import('@/lib/validation/core/rulepack-loader'),
        ])
        const { setValidationLanguage } = await import('@/lib/validation/validationI18n')
        setValidationLanguage(
          typeof document === 'undefined'
            ? 'nl-BE'
            : document.documentElement?.lang || 'nl-BE'
        )
        const pack = loadRulePack(beAreiBook1_2025)
        finishValidation(validateProject(project, { packs: [pack] }))
      } catch (error) {
        failValidation(error)
      }
    },

    markProjectOpened: () => {
      // Project hydration can repair imported data (including situation-plan
      // visibility). Always validate that canonical editor snapshot; accepting
      // the caller's pre-hydration object here previously produced stale issues.
      const project = useProjectStore.getState().currentProject as ValidatableProject | null
      if (!project) return
      const sig = getValidationSignature(project)

      // If we already validated this exact project+signature, nothing to do.
      // (Happens when the same project is re-opened without edits.)
      const before = get()
      if (
        before.lastValidatedSignature === sig &&
        before.lastValidatedProjectId === project.project.id
      ) {
        logger.info('[Validation] project opened — already validated, skipping', {
          projectId: project.project.id,
        })
        set((state) => {
          state.lastProjectSnapshot = project
          state.currentSignature = sig
          state.isDirty = false
        })
        return
      }

      set((state) => {
        state.lastProjectSnapshot = project
        state.currentSignature = sig
        state.pendingSignature = null
        state.isDirty = state.lastValidatedSignature !== sig
      })

      logger.info('[Validation] project opened — waiting for editor inactivity', {
        projectId: project.project.id,
      })
    },

    revalidate: () => {
      const snap = get().lastProjectSnapshot
      if (!snap) return
      void get().validate(snap, undefined, 'manual_revalidate')
    },

    getStatus: () => {
      return get().status
    },

    getErrorCount: () => {
      return get().issues.filter((i) => i.severity === 'error').length
    },

    getWarningCount: () => {
      return get().issues.filter((i) => i.severity === 'warning').length
    },
  }))
)
