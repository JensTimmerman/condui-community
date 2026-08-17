/** Inputs, selects, and editors where we keep focus (spacebar / Tab must not hijack). */
export function isTextLikeFocusTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true
  }

  if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') {
    return true
  }

  return target.getAttribute('role') === 'textbox'
}

/**
 * Blur the focused element when the user moves the pointer over the canvas so
 * spacebar / Enter don't activate sidebar buttons (e.g. custom dropdowns).
 * Keeps focus in real text fields and rich-text editors.
 */
export function blurFocusStealingActiveElement(): void {
  const el = document.activeElement
  if (!el || !(el instanceof HTMLElement)) return

  if (isTextLikeFocusTarget(el)) return

  el.blur()
}

/**
 * A Konva stage renders to a non-focusable canvas, so clicking a symbol does not
 * move browser focus away from a property input by itself. Blur that stale
 * editor focus when an actual canvas interaction starts; otherwise Delete and
 * other canvas shortcuts keep being delivered to (and ignored for) the input.
 */
export function blurActiveElementForCanvasPointerDown(target: EventTarget | null): void {
  if (!(target instanceof Element) || target.tagName !== 'CANVAS') return

  const activeElement = document.activeElement
  if (!activeElement || !(activeElement instanceof HTMLElement) || activeElement === target) return

  activeElement.blur()
}
