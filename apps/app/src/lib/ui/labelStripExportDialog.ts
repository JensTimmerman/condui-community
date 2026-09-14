export const OPEN_LABEL_STRIP_EXPORT_EVENT = 'condui:open-label-strip-export'

export function openLabelStripExportDialog(): void {
  window.dispatchEvent(new Event(OPEN_LABEL_STRIP_EXPORT_EVENT))
}
