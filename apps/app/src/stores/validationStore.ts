import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Issue } from '@/lib/validation/core/types'
import { validateProject } from '@/lib/validation/core/engine'
import { beAreiBook1_2025 } from '@/lib/validation/rules/be/be.areibook1.2025'
import { loadRulePack } from '@/lib/validation/core/rulepack-loader'
import { getValidationSignature } from '@/lib/validation/validationTrigger'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import { logger } from '@/lib/logger'

type ValidatableProject = Parameters<typeof validateProject>[0] & {
  project: {
    id: string
  }
}

export type ValidationStatus = 'error' | 'warning' | 'ok'

type ValidationRunReason =
  | 'idle_signature_change'
  | 'manual_revalidate'
  | 'language_change'
  | 'project_opened'
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
   * Signature that is currently scheduled or in flight. Set by
   * `markProjectOpened` (and `validate`) so that signature watchers
   * (e.g. ValidationStatusIcon) know a validation is already coming
   * for this signature and do not schedule a duplicate.
   */
  pendingSignature: string | null
  /** Latest observed signature (used to compute dirty state). */
  currentSignature: string | null
  lastValidatedProjectId: string | null
  lastProjectSnapshot: ValidatableProject | null

  // Actions
  setCurrentSignature: (signature: string) => void
  validate: (project: ValidatableProject, signature?: string, reason?: ValidationRunReason) => void
  /**
   * Single entry point used when a project has just been opened (and built
   * by the editor). Schedules exactly one validation on idle so the first
   * paint and canvas mount complete first. Other validation triggers
   * (signature watcher, language change) are expected to no-op while this
   * pending run is in flight, because they see `pendingSignature` matching
   * the current signature.
   */
  markProjectOpened: (project: ValidatableProject) => void
  revalidate: () => void
  getStatus: () => ValidationStatus
  getErrorCount: () => number
  getWarningCount: () => number
}

type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number }

function scheduleIdle(cb: () => void, timeoutMs = 500): () => void {
  if (typeof window === 'undefined') {
    const handle = setTimeout(cb, 0) as unknown as number
    return () => clearTimeout(handle)
  }
  const w = window as unknown as {
    requestIdleCallback?: (cb: (d: IdleDeadlineLike) => void, opts?: { timeout: number }) => number
    cancelIdleCallback?: (h: number) => void
  }
  if (typeof w.requestIdleCallback === 'function') {
    const handle = w.requestIdleCallback(() => cb(), { timeout: timeoutMs })
    return () => w.cancelIdleCallback?.(handle)
  }
  const handle = window.setTimeout(cb, 0)
  return () => window.clearTimeout(handle)
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

    validate: (
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
      })

      try {
        // Load rule packs (for now, just the sample pack)
        const pack = loadRulePack(beAreiBook1_2025)

        // Run validation
        const issues = validateProject(project, { packs: [pack] })
        const status = computeStatus(issues)

        set((state) => {
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
      } catch (error) {
        logger.error('[Validation Store] Validation error:', error)
        trackGoogleAnalyticsEvent('validation_run_error', { reason })
        set((state) => {
          state.issues = []
          state.status = 'ok'
          state.isLoading = false
          if (state.pendingSignature === sig) state.pendingSignature = null
          // Keep dirty state as-is (project is still unvalidated).
        })
      }
    },

    markProjectOpened: (project: ValidatableProject) => {
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

      // Claim this signature as pending so the signature watcher in
      // ValidationStatusIcon does not schedule a duplicate run.
      set((state) => {
        state.lastProjectSnapshot = project
        state.currentSignature = sig
        state.pendingSignature = sig
        state.isDirty = state.lastValidatedSignature !== sig
      })

      logger.info('[Validation] project opened — scheduling one validation', {
        projectId: project.project.id,
      })
      // Defer validation off the critical paint path. We want the project
      // to render and the canvases to mount first; the validation runs on
      // the next idle slot.
      scheduleIdle(() => {
        const snap = get().lastProjectSnapshot
        // If another project has been opened in the meantime, drop this run.
        if (!snap || snap.project.id !== project.project.id) return
        // If something else already validated this signature, skip (validate
        // itself is idempotent, but this avoids the log noise).
        if (get().lastValidatedSignature === sig) {
          set((state) => {
            if (state.pendingSignature === sig) state.pendingSignature = null
          })
          return
        }
        get().validate(snap, sig, 'project_opened')
      }, 750)
    },

    revalidate: () => {
      const snap = get().lastProjectSnapshot
      if (!snap) return
      get().validate(snap, undefined, 'manual_revalidate')
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
