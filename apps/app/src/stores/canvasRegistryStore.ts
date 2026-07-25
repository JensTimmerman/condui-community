/**
 * Canvas registry store
 * Allows canvases to register themselves so they can be accessed for export
 */

import { create } from 'zustand'
import type Konva from 'konva'

interface CanvasRegistry {
  eendraad: {
    getStage: () => Konva.Stage | null
    fitToView?: () => void
  } | null
  panel: {
    getStage: (panelId: string) => Konva.Stage | null
    fitToView?: (panelId: string) => void
  } | null
  sitplan: {
    getStage: (floorId: string) => Konva.Stage | null
    fitToView?: (floorId: string) => void
  } | null
}

interface CanvasRegistryState {
  registry: CanvasRegistry
  registerEendraad: (getStage: () => Konva.Stage | null, fitToView?: () => void) => void
  registerPanel: (getStage: (panelId: string) => Konva.Stage | null, fitToView?: (panelId: string) => void) => void
  registerSitplan: (getStage: (floorId: string) => Konva.Stage | null, fitToView?: (floorId: string) => void) => void
  unregisterEendraad: () => void
  unregisterPanel: () => void
  unregisterSitplan: () => void
}

export const useCanvasRegistryStore = create<CanvasRegistryState>((set) => ({
  registry: {
    eendraad: null,
    panel: null,
    sitplan: null,
  },
  
  registerEendraad: (getStage, fitToView) =>
    set((state) => ({
      registry: {
        ...state.registry,
        eendraad: { getStage, fitToView },
      },
    })),
  
  registerPanel: (getStage, fitToView) =>
    set((state) => ({
      registry: {
        ...state.registry,
        panel: { getStage, fitToView },
      },
    })),
  
  registerSitplan: (getStage, fitToView) =>
    set((state) => ({
      registry: {
        ...state.registry,
        sitplan: { getStage, fitToView },
      },
    })),
  
  unregisterEendraad: () =>
    set((state) => ({
      registry: {
        ...state.registry,
        eendraad: null,
      },
    })),
  
  unregisterPanel: () =>
    set((state) => ({
      registry: {
        ...state.registry,
        panel: null,
      },
    })),
  
  unregisterSitplan: () =>
    set((state) => ({
      registry: {
        ...state.registry,
        sitplan: null,
      },
    })),
}))
