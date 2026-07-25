/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'

export interface PreviewElement {
  id: string
  type:
    | 'endpoint'
    | 'circuit'
    | 'protection'
    | 'wire'
    | 'trunkDevice'
    | 'placement'
    | 'panel'
    | 'wall'
    | 'wallPoint'
    | 'graphicElement'
}

export interface SelectionPreviewStore {
  getSnapshot: () => PreviewElement[]
  setSnapshot: (next: PreviewElement[]) => void
  getActiveSnapshot: () => boolean
  setActive: (active: boolean) => void
  subscribe: (listener: () => void) => () => void
}

const EMPTY_PREVIEW: PreviewElement[] = []

export function createSelectionPreviewStore(initial: PreviewElement[] = EMPTY_PREVIEW): SelectionPreviewStore {
  let snapshot = initial
  let active = false
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    setSnapshot: (next) => {
      if (Object.is(snapshot, next)) return
      snapshot = next
      listeners.forEach((listener) => listener())
    },
    getActiveSnapshot: () => active,
    setActive: (next) => {
      if (active === next) return
      active = next
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const fallbackSelectionPreviewStore = createSelectionPreviewStore()
const SelectionPreviewContext = createContext<SelectionPreviewStore>(fallbackSelectionPreviewStore)

export const useSelectionPreview = () => {
  const store = useContext(SelectionPreviewContext)
  return {
    previewSelectedElements: useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot,
    ),
    isMarqueeSelecting: useSyncExternalStore(
      store.subscribe,
      store.getActiveSnapshot,
      store.getActiveSnapshot,
    ),
  }
}

export function useIsMarqueeSelecting(): boolean {
  const store = useContext(SelectionPreviewContext)
  return useSyncExternalStore(store.subscribe, store.getActiveSnapshot, store.getActiveSnapshot)
}

export function useIsPreviewSelected(type: PreviewElement['type'], id: string): boolean {
  const store = useContext(SelectionPreviewContext)
  const getSnapshot = useCallback(
    () => store.getSnapshot().some((el) => el.type === type && el.id === id),
    [id, store, type],
  )
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

export function useAreAnyPreviewSelected(
  type: PreviewElement['type'],
  ids: readonly string[],
): boolean {
  const store = useContext(SelectionPreviewContext)
  const idSignature = [...ids].sort().join('\0')
  const getSnapshot = useCallback(() => {
    if (!idSignature) return false
    const candidateIds = new Set(idSignature.split('\0'))
    return store.getSnapshot().some((el) => el.type === type && candidateIds.has(el.id))
  }, [idSignature, store, type])
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

export const SelectionPreviewProvider = SelectionPreviewContext.Provider
