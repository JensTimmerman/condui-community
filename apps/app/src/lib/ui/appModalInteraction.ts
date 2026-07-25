import { useDialogStore } from '@/stores/dialogStore'

export const APP_MODAL_BACKDROP_ATTR = 'data-app-modal-backdrop'

export function isAppDialogOpen(): boolean {
  return useDialogStore.getState().dialog != null
}

export function isInsideAppModal(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return (
    target.closest(`[${APP_MODAL_BACKDROP_ATTR}]`) != null ||
    target.closest('[data-testid="app-dialog-panel"]') != null ||
    target.closest('[data-canvas-context-menu="true"]') != null
  )
}
