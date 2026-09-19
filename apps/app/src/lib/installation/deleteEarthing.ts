import i18n from '@/i18n'
import { installationHasAnyEarthing, resolveEarthingDeleteScope } from '@/lib/eendraad/panelGround'
import { walkPanels } from '@/lib/panel/panelTree'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'

export function performDeleteEarthingLocations(options: {
  mode: 'all' | 'installation' | 'panel'
  panelId?: string
  clearSelection?: boolean
}): void {
  const store = useProjectStore.getState()
  const project = store.currentProject
  if (!project || !getProjectElectricalInstallation(project)) return

  if (options.mode === 'all') {
    store.updateInstallation({ hasGround: false, earthingPlacements: [] })
    for (const panel of walkPanels(getProjectElectricalPanels(project))) {
      if (panel.isMain === false && (panel.hasGround || (panel.groundTrunkDevices?.length ?? 0) > 0)) {
        store.updatePanel(panel.id, { hasGround: false, groundTrunkDevices: [] })
      }
    }
  } else if (options.mode === 'panel' && options.panelId) {
    store.updatePanel(options.panelId, { hasGround: false, groundTrunkDevices: [] })
    const next = store.currentProject
    if (
      next &&
      !installationHasAnyEarthing(
        getProjectElectricalPanels(next),
        getProjectElectricalInstallation(next)
      )
    ) {
      store.updateInstallation({ earthingPlacements: [] })
    }
  } else {
    store.updateInstallation({ hasGround: false })
    const next = store.currentProject
    if (
      next &&
      !installationHasAnyEarthing(
        getProjectElectricalPanels(next),
        getProjectElectricalInstallation(next)
      )
    ) {
      store.updateInstallation({ earthingPlacements: [] })
    }
  }

  if (options.clearSelection !== false) {
    useUIStore.getState().clearSelection()
  }
}

/** Remove every earth electrode stem and sitplan placements. */
export function performDeleteEarthing(clearSelection = true): void {
  performDeleteEarthingLocations({ mode: 'all', clearSelection })
}

type ConfirmDeleteEarthingArg =
  | (() => void)
  | { groundElementId?: string; onConfirmed?: () => void }

/** Ask for confirmation before removing earthing. Optional callback runs after removal. */
export function confirmDeleteEarthing(onConfirmedOrOptions?: ConfirmDeleteEarthingArg): void {
  const options =
    typeof onConfirmedOrOptions === 'function'
      ? { onConfirmed: onConfirmedOrOptions }
      : (onConfirmedOrOptions ?? {})
  const { openDialog } = useDialogStore.getState()
  const t = i18n.t.bind(i18n)
  openDialog({
    type: 'confirm',
    title: t('earthing.deleteConfirmTitle', 'Remove earthing?'),
    variant: 'warning',
    confirmLabel: t('common.remove', 'Remove'),
    cancelLabel: t('common.cancel'),
    onConfirm: () => {
      const store = useProjectStore.getState()
      const project = store.currentProject
      const scope = project
        ? resolveEarthingDeleteScope(options.groundElementId, getProjectElectricalPanels(project))
        : { mode: 'all' as const }
      performDeleteEarthingLocations({
        ...scope,
        clearSelection: !options.onConfirmed,
      })
      options.onConfirmed?.()
    },
  })
}
