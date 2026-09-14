import i18n from '@/i18n'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { getProjectElectricalInstallation } from '@/lib/projectV2/electrical'

/** Remove earthing from the installation (one-line diagram and situation plan). */
export function performDeleteEarthing(clearSelection = true): void {
  const store = useProjectStore.getState()
  if (!store.currentProject || !getProjectElectricalInstallation(store.currentProject)) return
  store.updateInstallation({ hasGround: false, earthingPlacements: [] })
  if (clearSelection) {
    useUIStore.getState().clearSelection()
  }
}

/** Ask for confirmation before removing earthing. Optional callback runs after removal. */
export function confirmDeleteEarthing(onConfirmed?: () => void): void {
  const { openDialog } = useDialogStore.getState()
  const t = i18n.t.bind(i18n)
  openDialog({
    type: 'confirm',
    title: t('earthing.deleteConfirmTitle', 'Remove earthing?'),
    variant: 'warning',
    confirmLabel: t('common.remove', 'Remove'),
    cancelLabel: t('common.cancel'),
    onConfirm: () => {
      performDeleteEarthing(!onConfirmed)
      onConfirmed?.()
    },
  })
}
