import { useEffect, useMemo, useRef, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useValidationStore, type ValidationState } from '@/stores/validationStore'
import { useUIStore } from '@/stores/uiStore'
import { diffValidationSignatures, getValidationSignature } from '@/lib/validation/validationTrigger'
import { AlertCircle, AlertTriangle, CheckCircle2, RotateCw } from 'lucide-react'
import type { ValidationStatus } from '@/stores/validationStore'
import { getOneWireSegmentsFromProject } from '@/lib/projectV2/annotations'
import { getElectricalPanelsFromProject } from '@/lib/projectV2/electrical'
import { logger } from '@/lib/logger'

type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number }
type RequestIdleCallbackHandle = number
type WindowWithIdleCallbacks = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout?: number }
  ) => RequestIdleCallbackHandle
  cancelIdleCallback?: (handle: RequestIdleCallbackHandle) => void
}

function requestIdle(cb: (deadline: IdleDeadlineLike) => void, timeoutMs: number): RequestIdleCallbackHandle {
  const ric = (window as WindowWithIdleCallbacks).requestIdleCallback
  if (ric) return ric(cb, { timeout: timeoutMs })
  // Fallback: schedule soon on the macrotask queue.
  return window.setTimeout(() => cb({ didTimeout: true, timeRemaining: () => 0 }), Math.min(250, timeoutMs))
}

function cancelIdle(handle: RequestIdleCallbackHandle) {
  const cic = (window as WindowWithIdleCallbacks).cancelIdleCallback
  if (cic) cic(handle)
  else clearTimeout(handle)
}

interface ValidationStateIconProps {
  className?: string
}

export function ValidationStateIcon({ className = 'w-5 h-5' }: ValidationStateIconProps) {
  const status = useValidationStore((state: ValidationState) => state.status)
  const isLoading = useValidationStore((state: ValidationState) => state.isLoading)
  const isDirty = useValidationStore((state: ValidationState) => state.isDirty)

  if (isDirty && !isLoading) {
    return <RotateCw className={`${className} text-gray-500 dark:text-gray-400`} />
  }
  switch (status) {
    case 'error':
      return <AlertCircle className={`${className} text-red-500`} />
    case 'warning':
      return <AlertTriangle className={`${className} text-yellow-500`} />
    case 'ok':
      return <CheckCircle2 className={`${className} text-green-500`} />
  }
}

function ValidationStatusIcon() {
  const { t } = useTranslation()
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const validationWindowOpen = useUIStore((state) => state.validationWindowOpen)
  const projectRef = useRef(currentProject)
  projectRef.current = currentProject
  const validate = useValidationStore((state: ValidationState) => state.validate)
  const status = useValidationStore((state: ValidationState) => state.status)
  const isLoading = useValidationStore((state: ValidationState) => state.isLoading)
  const isDirty = useValidationStore((state: ValidationState) => state.isDirty)
  const setCurrentSignature = useValidationStore((state: ValidationState) => state.setCurrentSignature)
  const errorCount = useValidationStore((state: ValidationState) => state.getErrorCount())
  const warningCount = useValidationStore((state: ValidationState) => state.getWarningCount())
  const toggleValidationWindow = useUIStore((state) => state.toggleValidationWindow)

  // Only re-run validation when validation-relevant data changes (panels, installation, project meta, wire segments).
  const signature = getValidationSignature(currentProject ?? null)
  const lastSignatureRef = useRef<string>('')

  const projectSizeScore = useMemo(() => {
    const p = currentProject
    if (!p) return 0
    const panels = getElectricalPanelsFromProject(p).length
    const wireSegments = getOneWireSegmentsFromProject(p).length
    // Rough heuristic: panels dominate electrical complexity; wire segments can be large.
    return panels * 50 + wireSegments
  }, [currentProject])

  const idleDelayMs = useMemo(() => {
    // When the validation window is open, prioritize fast feedback while editing.
    if (validationWindowOpen) {
      // Small projects: ~120ms, large: up to ~450ms
      if (projectSizeScore <= 500) return 120
      if (projectSizeScore <= 2000) return 200
      if (projectSizeScore <= 6000) return 320
      return 450
    }
    // Default mode: conservative scheduling to avoid heavy churn.
    // Small projects: ~900ms, large: up to ~2200ms
    if (projectSizeScore <= 500) return 900
    if (projectSizeScore <= 2000) return 1400
    if (projectSizeScore <= 6000) return 1800
    return 2200
  }, [projectSizeScore, validationWindowOpen])

  const inactivityMs = useMemo(() => {
    // While the validation window is open, shorten "settle" time for near-live feedback.
    if (validationWindowOpen) {
      return projectSizeScore <= 2000 ? 180 : 320
    }
    // Default mode: postpone heavy validation while actively interacting.
    return projectSizeScore <= 2000 ? 1200 : 1800
  }, [projectSizeScore, validationWindowOpen])

  const lastInteractionRef = useRef<number>(Date.now())
  const lastInteractionMarkRef = useRef<number>(0)
  const idleHandleRef = useRef<RequestIdleCallbackHandle | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const markInteraction = () => {
      const now = Date.now()
      if (now - lastInteractionMarkRef.current < 250) return
      lastInteractionMarkRef.current = now
      lastInteractionRef.current = now
    }

    // Capture common “active editing” signals (covers dragging, drawing, typing, zooming).
    const opts: AddEventListenerOptions = { capture: true, passive: true }
    window.addEventListener('pointerdown', markInteraction, opts)
    window.addEventListener('pointermove', markInteraction, opts)
    window.addEventListener('pointerup', markInteraction, opts)
    window.addEventListener('keydown', markInteraction, { capture: true })
    window.addEventListener('wheel', markInteraction, opts)

    return () => {
      window.removeEventListener('pointerdown', markInteraction, opts)
      window.removeEventListener('pointermove', markInteraction, opts)
      window.removeEventListener('pointerup', markInteraction, opts)
      window.removeEventListener('keydown', markInteraction, { capture: true })
      window.removeEventListener('wheel', markInteraction, opts)
    }
  }, [])

  useEffect(() => {
    if (!signature) return

    if (lastSignatureRef.current !== signature) {
      const prev = lastSignatureRef.current
      const diff = prev ? diffValidationSignatures(prev, signature, { maxPaths: 20, maxDepth: 6 }) : []
      logger.info('[Validation] signature changed', diff.length ? { changed: diff } : undefined)
      lastSignatureRef.current = signature
    }

    // Light stage: mark “dirty” immediately (icon can reflect this without running validation).
    setCurrentSignature(signature)

    // Cancel any pending heavy validation.
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (idleHandleRef.current !== null) {
      cancelIdle(idleHandleRef.current)
      idleHandleRef.current = null
    }

    // If the validation store has already validated this signature, or is
    // about to (e.g. the project-open flow scheduled it), there is nothing
    // for us to do here. This prevents the signature watcher from racing
    // the project-open validation when the project is first loaded.
    const validationState = useValidationStore.getState()
    if (
      validationState.lastValidatedSignature === signature ||
      validationState.pendingSignature === signature
    ) {
      return
    }

    const tryScheduleHeavyValidation = () => {
      const now = Date.now()
      const msSinceInteraction = now - lastInteractionRef.current
      const waitForInactivity = Math.max(0, inactivityMs - msSinceInteraction)

      timerRef.current = window.setTimeout(() => {
        const now2 = Date.now()
        const msSinceInteraction2 = now2 - lastInteractionRef.current
        if (msSinceInteraction2 < inactivityMs) {
          tryScheduleHeavyValidation()
          return
        }

        idleHandleRef.current = requestIdle(() => {
          const project = projectRef.current
          if (project) validate(project, signature, 'idle_signature_change')
        }, idleDelayMs)
      }, waitForInactivity)
    }

    tryScheduleHeavyValidation()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      if (idleHandleRef.current !== null) cancelIdle(idleHandleRef.current)
      idleHandleRef.current = null
    }
  }, [signature, validate, setCurrentSignature, inactivityMs, idleDelayMs])

  const handleClick = () => {
    toggleValidationWindow()
  }

  const blurTriggerButton = (event: MouseEvent<HTMLButtonElement>) => {
    // Chrome keeps button focus after click; drop it so Space keeps driving canvas shortcuts.
    event.currentTarget.blur()
  }

  const getIcon = () => {
    return <ValidationStateIcon className="w-5 h-5" />
  }

  const getTitle = (status: ValidationStatus) => {
    if (isLoading) return t('validation.checking', { defaultValue: 'Checking...' })
    if (isDirty) return t('validation.needsValidation', { defaultValue: 'Needs validation (waiting for idle)' })
    switch (status) {
      case 'error':
        return t('validation.errorsFound', { count: errorCount, defaultValue: `${errorCount} error(s) found` })
      case 'warning':
        return t('validation.warningsFound', { count: warningCount, defaultValue: `${warningCount} warning(s) found` })
      case 'ok':
        return t('validation.allClear', { defaultValue: 'All available checks passed' })
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseUp={blurTriggerButton}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors ${
        validationWindowOpen
          ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300'
          : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
      }`}
      title={getTitle(status)}
      disabled={isLoading}
      aria-pressed={validationWindowOpen}
    >
      {getIcon()}
      {(errorCount > 0 || warningCount > 0) && (
        <span
          className={`text-xs font-semibold ${
            validationWindowOpen
              ? 'text-sky-700 dark:text-sky-300'
              : 'text-gray-700 dark:text-gray-300'
          }`}
        >
          {errorCount > 0 ? errorCount : warningCount}
        </span>
      )}
    </button>
  )
}

export default ValidationStatusIcon
