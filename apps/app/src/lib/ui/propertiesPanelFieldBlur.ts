/** Delay before blurring a properties text field after the pointer leaves the panel. */
export const PROPERTIES_FIELD_BLUR_DELAY_MS = 2_000

/** Longer delay when the user presses space (viewport hotkey or while a blur is pending). */
export const PROPERTIES_FIELD_BLUR_DELAY_AFTER_SPACE_MS = 5_000

export const PROPERTIES_PANEL_EXTEND_BLUR_EVENT = 'eendra:properties-panel-extend-blur'

export function dispatchExtendPropertiesPanelFieldBlur(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PROPERTIES_PANEL_EXTEND_BLUR_EVENT))
}
