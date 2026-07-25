import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * Use on canvas overlay `<button>` elements. Prevents primary mouse button from
 * focusing the button so Space is not routed to Chrome’s button activation
 * (including key repeat). Keyboard users can still Tab to the control.
 */
export function preventCanvasToolbarMouseFocus(e: ReactPointerEvent<HTMLElement>) {
  if (e.pointerType === 'mouse' && e.button === 0) {
    e.preventDefault()
  }
}
