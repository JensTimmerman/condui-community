export const CANVAS_OVERLAY_DISMISS_EVENT = 'eendra:canvas-overlay-dismiss'

export function dismissCanvasOverlays() {
  window.dispatchEvent(new Event(CANVAS_OVERLAY_DISMISS_EVENT))
}
