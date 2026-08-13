import { useUIStore } from '@/stores/uiStore'

export const OPEN_EENDRAAD_NAMING_GUIDANCE_EVENT = 'condui:open-eendraad-naming-guidance'

export function openEendraadNamingGuidance(): void {
  const ui = useUIStore.getState()
  const oneWireVisible = ui.viewportLayout.panels.some((panel) => panel.canvas === 'eendraad')
  if (!oneWireVisible) ui.setPanelCanvas(0, 'eendraad')

  window.requestAnimationFrame(() => {
    window.dispatchEvent(new Event(OPEN_EENDRAAD_NAMING_GUIDANCE_EVENT))
  })
}
