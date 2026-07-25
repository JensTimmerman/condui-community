import { useCallback, useEffect, useRef } from 'react'
import {
  PROPERTIES_FIELD_BLUR_DELAY_MS,
  PROPERTIES_FIELD_BLUR_DELAY_AFTER_SPACE_MS,
  PROPERTIES_PANEL_EXTEND_BLUR_EVENT,
} from '@/lib/ui/propertiesPanelFieldBlur'

function isPanelEditableField(el: HTMLElement): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el.isContentEditable
  )
}

/**
 * Defers blurring properties text fields when the pointer leaves the panel so
 * canvas interaction (e.g. spacebar viewport focus) does not instantly end editing.
 */
export function usePropertiesPanelFieldBlurOnLeave() {
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelRefRef = useRef<HTMLElement | null>(null)

  const clearScheduledBlur = useCallback(() => {
    if (blurTimeoutRef.current != null) {
      clearTimeout(blurTimeoutRef.current)
      blurTimeoutRef.current = null
    }
  }, [])

  const runBlurIfStillInPanel = useCallback(() => {
    blurTimeoutRef.current = null
    const panelEl = panelRefRef.current
    const activeEl = document.activeElement
    if (!panelEl || !(activeEl instanceof HTMLElement)) return
    if (!panelEl.contains(activeEl)) return
    if (!isPanelEditableField(activeEl)) return
    activeEl.blur()
  }, [])

  const scheduleBlur = useCallback(
    (delayMs: number, panelEl: HTMLElement) => {
      clearScheduledBlur()
      panelRefRef.current = panelEl
      blurTimeoutRef.current = setTimeout(runBlurIfStillInPanel, delayMs)
    },
    [clearScheduledBlur, runBlurIfStillInPanel]
  )

  const extendScheduledBlur = useCallback(() => {
    const panelEl = panelRefRef.current
    if (!panelEl || blurTimeoutRef.current == null) return
    scheduleBlur(PROPERTIES_FIELD_BLUR_DELAY_AFTER_SPACE_MS, panelEl)
  }, [scheduleBlur])

  const blurActiveFieldOnPanelLeave = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const activeEl = document.activeElement
      if (!(activeEl instanceof HTMLElement)) return
      if (!e.currentTarget.contains(activeEl)) return
      if (!isPanelEditableField(activeEl)) return
      scheduleBlur(PROPERTIES_FIELD_BLUR_DELAY_MS, e.currentTarget)
    },
    [scheduleBlur]
  )

  const cancelBlurOnPanelEnter = useCallback(() => {
    clearScheduledBlur()
  }, [clearScheduledBlur])

  useEffect(() => {
    const onExtend = () => extendScheduledBlur()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      extendScheduledBlur()
    }

    window.addEventListener(PROPERTIES_PANEL_EXTEND_BLUR_EVENT, onExtend)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener(PROPERTIES_PANEL_EXTEND_BLUR_EVENT, onExtend)
      window.removeEventListener('keydown', onKeyDown, true)
      clearScheduledBlur()
    }
  }, [extendScheduledBlur, clearScheduledBlur])

  return { blurActiveFieldOnPanelLeave, cancelBlurOnPanelEnter }
}
