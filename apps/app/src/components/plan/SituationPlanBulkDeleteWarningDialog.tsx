import type { TFunction } from 'i18next'
import { useDialogStore } from '@/stores/dialogStore'
import {
  trackSituationPlanBulkDeleteCancel,
  trackSituationPlanBulkDeleteDelete,
  trackSituationPlanBulkDeleteHide,
  trackSituationPlanBulkDeleteWarningShown,
} from '@/lib/analytics/situationPlanAnalytics'

const BULK_DELETE_WARNING_STORAGE_PREFIX = 'condui:situation-plan-bulk-delete-warning:'
export const SITUATION_PLAN_BULK_DELETE_WARNING_MIN_ITEMS = 3

function warningStorageKey(projectId: string): string {
  return `${BULK_DELETE_WARNING_STORAGE_PREFIX}${projectId}`
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function hasSeenSituationPlanBulkDeleteWarning(projectId: string): boolean {
  return getLocalStorage()?.getItem(warningStorageKey(projectId)) === '1'
}

export function markSituationPlanBulkDeleteWarningSeen(projectId: string): void {
  try {
    getLocalStorage()?.setItem(warningStorageKey(projectId), '1')
  } catch {
    // The safety action should still work when browser storage is unavailable.
  }
}

export function shouldShowSituationPlanBulkDeleteWarning(
  projectId: string | undefined,
  itemCount: number
): boolean {
  return (
    !!projectId &&
    itemCount >= SITUATION_PLAN_BULK_DELETE_WARNING_MIN_ITEMS &&
    !hasSeenSituationPlanBulkDeleteWarning(projectId)
  )
}

export interface SituationPlanBulkDeleteWarningOptions {
  projectId: string
  placementIds: string[]
  t: TFunction
  onDelete: () => void
  onHide: () => void
}

/** Open the first-use warning and return whether the destructive action was intercepted. */
export function openSituationPlanBulkDeleteWarning({
  projectId,
  placementIds,
  t,
  onDelete,
  onHide,
}: SituationPlanBulkDeleteWarningOptions): boolean {
  if (!shouldShowSituationPlanBulkDeleteWarning(projectId, placementIds.length)) return false

  const { openDialog, closeDialog } = useDialogStore.getState()
  const runOnce = (trackAction: () => void, action: () => void) => {
    markSituationPlanBulkDeleteWarningSeen(projectId)
    trackAction()
    action()
    closeDialog()
  }

  openDialog({
    type: 'custom',
    title: t('situationPlan.bulkDeleteWarning.title', {
      defaultValue: 'Delete symbols?',
    }),
    content: (
      <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
        <p>
          {t('situationPlan.bulkDeleteWarning.message', {
            defaultValue:
              'These symbols are also in the one-wire diagram. Delete removes them there too; Hide keeps them there.',
          })}
        </p>
      </div>
    ),
    buttons: [
      {
        label: t('common.cancel', { defaultValue: 'Cancel' }),
        variant: 'secondary',
        onClick: () => {
          trackSituationPlanBulkDeleteCancel()
          closeDialog()
        },
      },
      {
        label: t('situationPlan.bulkDeleteWarning.hide', { defaultValue: 'Hide' }),
        variant: 'primary',
        onClick: () => runOnce(trackSituationPlanBulkDeleteHide, onHide),
      },
      {
        label: t('common.delete', { defaultValue: 'Delete' }),
        variant: 'danger',
        onClick: () => runOnce(trackSituationPlanBulkDeleteDelete, onDelete),
      },
    ],
  })
  trackSituationPlanBulkDeleteWarningShown()
  return true
}
