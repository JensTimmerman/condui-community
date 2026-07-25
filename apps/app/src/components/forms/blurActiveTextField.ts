export function blurActiveTextField(
  clickTarget?: EventTarget | null,
  scopeElement?: HTMLElement | null
) {
  if (typeof document === 'undefined') return

  if (clickTarget instanceof HTMLElement) {
    // Don't blur when interacting with any editable control.
    if (clickTarget.closest('input, textarea, [contenteditable="true"]')) return
  }

  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return
  if (scopeElement) {
    // Only react to clicks inside this subtree (e.g. canvas wrapper). The focused
    // field may live elsewhere (properties panel); it must still blur on canvas click.
    if (clickTarget instanceof Node && !scopeElement.contains(clickTarget)) return
  }
  const isTextField =
    active.tagName === 'INPUT' ||
    active.tagName === 'TEXTAREA' ||
    active.isContentEditable
  if (!isTextField) return

  active.blur()
}

